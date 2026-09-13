// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {ProvenSource} from "./ProvenSource.sol";
import {SourceProof} from "./interfaces/ISourceProof.sol";
import {ICreditHistory} from "./interfaces/ICreditHistory.sol";
import {IHumanLinks} from "./interfaces/IHumanLinks.sol";

/// @title CreditHistory
/// @notice Imports a human's Aave V3 repayment record from their linked Ethereum wallets.
/// @dev The Attestcoin Loan Flow template (`ASCLoanManager`) proves `LoanFunded` and `LoanRepaid`
///      events from a lending contract. This is the same pattern pointed at the largest real one,
///      Aave V3, with the rules a lender needs before a repayment may raise an unsecured limit:
///
///        - Borrow first. A `Repay` only counts against a `Borrow` already proved here, from the
///          same wallet, on the same chain, in the same reserve, and credit is capped at that
///          borrow's amount. A flash loan emits no `Borrow`; a borrow cannot back more repayment
///          than it created.
///        - Minimum duration. The repayment's block must sit `MIN_GAP_BLOCKS` after the borrow's.
///          Proofs carry no timestamps, so time is measured in source blocks. Borrow-and-repay in
///          one transaction, or one block, never counts.
///        - Own debt, own money. `Borrow.onBehalfOf` must equal `Borrow.user`, `Repay.repayer` must
///          equal `Repay.user`, and repaying with aTokens (netting a deposit) is refused.
///        - Linked wallets only. The wallet must be linked in `HumanLinks`, and links are permanent
///          and unique, so one wallet's history counts for exactly one human, once.
///        - Once per log. Each `(chainKey, height, txIndex, logIndex)` is consumed.
///        - Emitter and reserve. Only the configured Aave pool's logs, and only configured
///          dollar-stable reserves, valued at 1 USD per token.
///        - Bounded. The boost is `BOOST_BPS` of verified repaid dollars, capped at `MAX_BOOST`.
///
///      What this cannot stop: a person with capital who borrows, waits, and repays to build a
///      record. That costs real interest and gas for a boost bounded by `MAX_BOOST`, and the line it
///      raises is still keyed to one human who cannot walk away from a default. On Sepolia the
///      reserves are faucet tokens, so testnet history is a demonstration, not a signal.
contract CreditHistory is ProvenSource, ICreditHistory {
    /// @dev keccak256("Borrow(address,address,address,uint256,uint8,uint256,uint16)")
    bytes32 internal constant BORROW_TOPIC = 0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0;
    /// @dev keccak256("Repay(address,address,address,uint256,bool)")
    bytes32 internal constant REPAY_TOPIC = 0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051;

    uint256 private constant BPS = 10_000;
    uint8 private constant USD_DECIMALS = 6;

    /// @inheritdoc ICreditHistory
    address public immutable override LINKS;
    /// @inheritdoc ICreditHistory
    uint64 public immutable override MIN_GAP_BLOCKS;
    /// @inheritdoc ICreditHistory
    uint256 public immutable override BOOST_BPS;
    /// @inheritdoc ICreditHistory
    uint256 public immutable override MAX_BOOST;

    /// @notice The Aave V3 pool that counts on each chain key.
    mapping(uint64 chainKey => address pool) public poolOf;
    /// @dev Token decimals plus one; zero means the reserve does not count.
    mapping(uint64 chainKey => mapping(address token => uint8)) private _decimalsPlusOne;

    mapping(bytes32 borrowId => BorrowRecord) private _borrows;
    mapping(uint256 human => uint256) private _repaidUsd;
    mapping(uint256 human => uint32) private _repayments;

    constructor(
        address links,
        AavePool[] memory pools,
        Reserve[] memory reserves,
        uint64 finalityDepth,
        uint32 minAttestors,
        uint64 minGapBlocks,
        uint256 boostBps,
        uint256 maxBoost
    ) ProvenSource(_keysOf(pools), _idsOf(pools), finalityDepth, minAttestors) {
        if (links == address(0) || boostBps > BPS || minGapBlocks == 0) revert BadParameters();
        LINKS = links;
        MIN_GAP_BLOCKS = minGapBlocks;
        BOOST_BPS = boostBps;
        MAX_BOOST = maxBoost;
        for (uint256 i; i < pools.length; ++i) {
            if (pools[i].pool == address(0)) revert BadParameters();
            poolOf[pools[i].chainKey] = pools[i].pool;
        }
        for (uint256 i; i < reserves.length; ++i) {
            Reserve memory r = reserves[i];
            if (poolOf[r.chainKey] == address(0) || r.token == address(0) || r.decimals > 36) revert BadParameters();
            _decimalsPlusOne[r.chainKey][r.token] = r.decimals + 1;
        }
    }

    // ---------------------------------------------------------------------------------------
    //                                          PROVING
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditHistory
    /// @dev Aave V3 `Borrow(address indexed reserve, address user, address indexed onBehalfOf,
    ///      uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)`.
    function proveBorrow(SourceProof calldata proof, uint256 logIndex) external override returns (bytes32 borrowId) {
        ProvenTx memory t = _proveTx(proof);
        EvmV1Decoder.LogEntry memory log = _aaveLog(t, logIndex);
        if (log.topics.length != 4 || log.topics[0] != BORROW_TOPIC) revert NotABorrowLog();

        address reserve = _topicAddress(log.topics[1]);
        address onBehalfOf = _topicAddress(log.topics[2]);
        _requireReserve(t.chainKey, reserve);
        (address user, uint256 amount,,) = abi.decode(log.data, (address, uint256, uint8, uint256));
        if (user != onBehalfOf) revert BorrowedForSomeoneElse(user, onBehalfOf);

        uint256 human = _linkedHuman(onBehalfOf);

        borrowId = logIdOf(t.queryId, logIndex);
        _consume(borrowId);
        _borrows[borrowId] = BorrowRecord({
            human: human,
            wallet: onBehalfOf,
            reserve: reserve,
            chainKey: t.chainKey,
            blockHeight: t.blockHeight,
            amount: amount,
            remaining: amount
        });

        emit BorrowProven(human, onBehalfOf, borrowId, t.chainKey, t.blockHeight, reserve, amount);
    }

    /// @inheritdoc ICreditHistory
    /// @dev Aave V3 `Repay(address indexed reserve, address indexed user, address indexed repayer,
    ///      uint256 amount, bool useATokens)`.
    function proveRepay(SourceProof calldata proof, uint256 logIndex, bytes32 borrowId)
        external
        override
        returns (uint256 creditedUsd)
    {
        ProvenTx memory t = _proveTx(proof);
        EvmV1Decoder.LogEntry memory log = _aaveLog(t, logIndex);
        if (log.topics.length != 4 || log.topics[0] != REPAY_TOPIC) revert NotARepayLog();

        address reserve = _topicAddress(log.topics[1]);
        address user = _topicAddress(log.topics[2]);
        address repayer = _topicAddress(log.topics[3]);
        (uint256 amount, bool useATokens) = abi.decode(log.data, (uint256, bool));
        if (repayer != user) revert RepaidBySomeoneElse(user, repayer);
        if (useATokens) revert RepaidWithATokens();

        BorrowRecord storage b = _borrows[borrowId];
        if (b.human == 0) revert UnknownBorrow(borrowId);
        if (b.wallet != user || b.reserve != reserve || b.chainKey != t.chainKey) revert BorrowMismatch(borrowId);
        uint64 earliest = b.blockHeight + MIN_GAP_BLOCKS;
        if (t.blockHeight < earliest) revert TooSoon(t.blockHeight, earliest);
        if (b.remaining == 0) revert BorrowFullyRepaid(borrowId);

        bytes32 repayId = logIdOf(t.queryId, logIndex);
        _consume(repayId);

        uint256 credited = amount < b.remaining ? amount : b.remaining;
        b.remaining -= credited;

        uint256 human = b.human;
        creditedUsd = _toUsd(credited, _decimalsPlusOne[t.chainKey][reserve] - 1);
        uint256 total = _repaidUsd[human] + creditedUsd;
        _repaidUsd[human] = total;
        _repayments[human] += 1;

        emit RepaymentProven(human, user, borrowId, repayId, amount, creditedUsd, total, boostOf(human));
    }

    // ---------------------------------------------------------------------------------------
    //                                           VIEWS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditHistory
    function boostOf(uint256 human) public view override returns (uint256) {
        uint256 boost = (_repaidUsd[human] * BOOST_BPS) / BPS;
        return boost < MAX_BOOST ? boost : MAX_BOOST;
    }

    /// @inheritdoc ICreditHistory
    function repaidUsdOf(uint256 human) external view override returns (uint256) {
        return _repaidUsd[human];
    }

    /// @inheritdoc ICreditHistory
    function repaymentsOf(uint256 human) external view override returns (uint32) {
        return _repayments[human];
    }

    /// @inheritdoc ICreditHistory
    function borrowOf(bytes32 borrowId) external view override returns (BorrowRecord memory) {
        return _borrows[borrowId];
    }

    /// @notice Decimals of a reserve that counts; reverts for one that does not.
    function reserveDecimals(uint64 chainKey, address token) external view returns (uint8) {
        uint8 d = _decimalsPlusOne[chainKey][token];
        if (d == 0) revert UnsupportedReserve(chainKey, token);
        return d - 1;
    }

    // ---------------------------------------------------------------------------------------
    //                                         INTERNALS
    // ---------------------------------------------------------------------------------------

    function _aaveLog(ProvenTx memory t, uint256 logIndex) private view returns (EvmV1Decoder.LogEntry memory log) {
        log = _logAt(t.receipt, logIndex);
        if (log.address_ != poolOf[t.chainKey]) revert UnsupportedPool(t.chainKey, log.address_);
    }

    function _requireReserve(uint64 chainKey, address reserve) private view {
        if (_decimalsPlusOne[chainKey][reserve] == 0) revert UnsupportedReserve(chainKey, reserve);
    }

    function _linkedHuman(address wallet) private view returns (uint256 human) {
        human = IHumanLinks(LINKS).humanOfWallet(wallet);
        if (human == 0) revert WalletNotLinked(wallet);
    }

    function _toUsd(uint256 amount, uint8 decimals) private pure returns (uint256) {
        if (decimals >= USD_DECIMALS) return amount / (10 ** (decimals - USD_DECIMALS));
        return amount * (10 ** (USD_DECIMALS - decimals));
    }

    function _topicAddress(bytes32 topic) private pure returns (address) {
        return address(uint160(uint256(topic)));
    }

    function _keysOf(AavePool[] memory pools) private pure returns (uint64[] memory keys) {
        keys = new uint64[](pools.length);
        for (uint256 i; i < pools.length; ++i) {
            keys[i] = pools[i].chainKey;
        }
    }

    function _idsOf(AavePool[] memory pools) private pure returns (uint64[] memory ids) {
        ids = new uint64[](pools.length);
        for (uint256 i; i < pools.length; ++i) {
            ids[i] = pools[i].chainId;
        }
    }
}
