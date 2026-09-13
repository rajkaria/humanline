// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {ProvenSource} from "./ProvenSource.sol";
import {SourceProof} from "./interfaces/ISourceProof.sol";
import {ICreditLine} from "./interfaces/ICreditLine.sol";
import {IHumanLinks} from "./interfaces/IHumanLinks.sol";

/// @title EthRepay
/// @notice Repay a Creditcoin credit line from Ethereum: send the stablecoin to Humanline's
///         repayment address there, prove the `Transfer` through Attestcoin, and the line is repaid
///         here.
/// @dev The proof must show a successful transaction on a configured chain whose receipt holds a
///      `Transfer(from, REPAY_ADDRESS, value)` log emitted by that chain's configured stablecoin, with
///      `from` a wallet linked to a human. The log is consumed once. The amount is rescaled to the
///      pool asset's decimals and applied through `CreditLine.repayFor` from this contract's reserve,
///      up to what the human owes; anything above that is recorded as `overpaidOf` for refund.
///
///      The reserve is the honest seam. Dollars that land at `REPAY_ADDRESS` on Ethereum are the
///      treasury's; this contract pays the Creditcoin pool out of a pool-asset float the treasury
///      keeps topped up. A proof can never be credited twice or credited to the wrong human, but if
///      the float is empty a valid proof waits (the call reverts `ReserveShort` and consumes nothing)
///      until it is refilled. No owner, no pause, no withdrawal: float only leaves as repayments.
contract EthRepay is ProvenSource {
    using SafeERC20 for IERC20;

    /// @dev keccak256("Transfer(address,address,uint256)")
    bytes32 internal constant TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    /// @notice A stablecoin accepted on one source chain.
    struct Stablecoin {
        uint64 chainKey;
        uint64 chainId;
        address token;
        uint8 decimals;
    }

    address public immutable LINKS;
    address public immutable CREDIT_LINE;
    /// @notice The pool asset (hUSD on testnet).
    address public immutable ASSET;
    uint8 public immutable ASSET_DECIMALS;
    /// @notice Where repayments are sent on every source chain.
    address public immutable REPAY_ADDRESS;

    mapping(uint64 chainKey => address token) public stablecoinOf;
    mapping(uint64 chainKey => uint8) public stablecoinDecimalsOf;

    /// @notice Pool-asset units a human sent beyond what they owed, owed back to them by the treasury.
    mapping(uint256 human => uint256) public overpaidOf;
    /// @notice Pool-asset units applied to credit lines so far.
    uint256 public totalApplied;

    uint256 private _locked = 1;

    event RepaymentCredited(
        uint256 indexed human,
        address indexed wallet,
        bytes32 indexed paymentId,
        uint64 chainKey,
        uint64 blockHeight,
        uint256 sourceAmount,
        uint256 applied,
        uint256 overpaid
    );

    error NotAStablecoinTransfer(uint64 chainKey, address emitter);
    error NotToRepayAddress(address to);
    error WalletNotLinked(address wallet);
    error ReserveShort(uint256 needed, uint256 available);
    error ZeroTransfer();
    error BadParameters();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        address links,
        address creditLine,
        address repayAddress,
        Stablecoin[] memory stablecoins,
        uint64 finalityDepth,
        uint32 minAttestors,
        uint8 assetDecimals
    ) ProvenSource(_keysOf(stablecoins), _idsOf(stablecoins), finalityDepth, minAttestors) {
        if (links == address(0) || creditLine == address(0) || repayAddress == address(0)) revert BadParameters();
        LINKS = links;
        CREDIT_LINE = creditLine;
        ASSET = ICreditLine(creditLine).ASSET();
        ASSET_DECIMALS = assetDecimals;
        REPAY_ADDRESS = repayAddress;
        for (uint256 i; i < stablecoins.length; ++i) {
            Stablecoin memory s = stablecoins[i];
            if (s.token == address(0) || s.decimals > 36) revert BadParameters();
            stablecoinOf[s.chainKey] = s.token;
            stablecoinDecimalsOf[s.chainKey] = s.decimals;
        }
    }

    /// @notice Credit a proved Ethereum-side stablecoin payment to the payer's human.
    /// @param logIndex Index of the `Transfer` log within the transaction's receipt.
    /// @return applied Pool-asset units applied to the credit line.
    function creditRepayment(SourceProof calldata proof, uint256 logIndex)
        external
        nonReentrant
        returns (uint256 applied)
    {
        ProvenTx memory t = _proveTx(proof);
        EvmV1Decoder.LogEntry memory log = _logAt(t.receipt, logIndex);
        if (log.address_ != stablecoinOf[t.chainKey] || log.topics.length != 3 || log.topics[0] != TRANSFER_TOPIC) {
            revert NotAStablecoinTransfer(t.chainKey, log.address_);
        }
        address from = address(uint160(uint256(log.topics[1])));
        address to = address(uint160(uint256(log.topics[2])));
        if (to != REPAY_ADDRESS) revert NotToRepayAddress(to);
        uint256 sourceAmount = abi.decode(log.data, (uint256));

        uint256 human = IHumanLinks(LINKS).humanOfWallet(from);
        if (human == 0) revert WalletNotLinked(from);

        uint256 amount = _rescale(sourceAmount, stablecoinDecimalsOf[t.chainKey]);
        if (amount == 0) revert ZeroTransfer();

        bytes32 paymentId = logIdOf(t.queryId, logIndex);
        _consume(paymentId);

        uint256 owed = ICreditLine(CREDIT_LINE).lineOf(human).principal;
        applied = amount < owed ? amount : owed;
        uint256 overpaid = amount - applied;
        if (overpaid != 0) overpaidOf[human] += overpaid;

        if (applied != 0) {
            uint256 float = IERC20(ASSET).balanceOf(address(this));
            if (float < applied) revert ReserveShort(applied, float);
            totalApplied += applied;
            IERC20(ASSET).forceApprove(CREDIT_LINE, applied);
            ICreditLine(CREDIT_LINE).repayFor(human, applied);
        }

        emit RepaymentCredited(human, from, paymentId, t.chainKey, t.blockHeight, sourceAmount, applied, overpaid);
    }

    /// @notice Pool-asset float available to apply proved repayments.
    function reserve() external view returns (uint256) {
        return IERC20(ASSET).balanceOf(address(this));
    }

    function _rescale(uint256 amount, uint8 fromDecimals) private view returns (uint256) {
        if (fromDecimals >= ASSET_DECIMALS) return amount / (10 ** (fromDecimals - ASSET_DECIMALS));
        return amount * (10 ** (ASSET_DECIMALS - fromDecimals));
    }

    function _keysOf(Stablecoin[] memory s) private pure returns (uint64[] memory keys) {
        keys = new uint64[](s.length);
        for (uint256 i; i < s.length; ++i) {
            keys[i] = s[i].chainKey;
        }
    }

    function _idsOf(Stablecoin[] memory s) private pure returns (uint64[] memory ids) {
        ids = new uint64[](s.length);
        for (uint256 i; i < s.length; ++i) {
            ids[i] = s[i].chainId;
        }
    }
}
