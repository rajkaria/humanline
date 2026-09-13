// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ProvenSource} from "./ProvenSource.sol";
import {SourceProof} from "./interfaces/ISourceProof.sol";
import {IHumanLinks} from "./interfaces/IHumanLinks.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";

/// @title HumanLinks
/// @notice Binds Ethereum wallets to a Humanline human, so a person's Ethereum history is theirs and
///         nobody else's, and a new wallet is never a new person.
/// @dev Two ways to prove the wallet's consent:
///
///      **Source transaction (Attestcoin).** The wallet sends itself a zero-value transaction on
///      Ethereum or Sepolia whose calldata is the link intent:
///        `LINK_MARKER ‖ abi.encode(human, creditcoinWallet, creditcoinChainId, address(this))`.
///      The proof goes through `ProvenSource` (BlockProver, finality, quorum, receipt status and the
///      signed chain id). Then: the transaction is a self-send, so the calldata cannot be anyone
///      else's contract call; the intent names this Creditcoin chain and this deployment, so it
///      cannot be replayed into another one; and the caller is the Creditcoin wallet the intent
///      names and is registered as the human it names. The proof's query id is consumed.
///
///      **Signature.** For a wallet that should not spend Ethereum gas, an EIP-712 `Link` signature
///      over the same facts, domain-bound to this chain and contract, with a deadline. No Attestcoin
///      involvement; it proves key control and nothing else, and is recorded as such.
///
///      Either way the caller must be the human's registered wallet, so a stranger cannot attach a
///      wallet to someone else's identity, and a wallet cannot be attached without its key. Links are
///      permanent and a human holds at most `MAX_LINKS`. No owner, no pause, no upgrade.
contract HumanLinks is ProvenSource, EIP712, IHumanLinks {
    /// @inheritdoc IHumanLinks
    uint256 public constant override MAX_LINKS = 8;
    /// @inheritdoc IHumanLinks
    bytes4 public constant override LINK_MARKER = bytes4(keccak256("humanlineLink(uint256,address,uint256,address)"));

    bytes32 private constant LINK_TYPEHASH =
        keccak256("Link(uint256 human,address creditcoinWallet,address wallet,uint256 deadline)");

    /// @dev Selector plus four words.
    uint256 private constant INTENT_LENGTH = 4 + 4 * 32;

    /// @inheritdoc IHumanLinks
    address public immutable override REGISTRY;

    mapping(address wallet => Link) private _links;
    mapping(uint256 human => address[]) private _walletsOf;

    /// @param registry The `HumanRegistry` whose humans may link wallets.
    constructor(address registry, uint64[] memory chainKeys, uint64[] memory chainIds, uint64 finalityDepth, uint32 minAttestors)
        ProvenSource(chainKeys, chainIds, finalityDepth, minAttestors)
        EIP712("Humanline HumanLinks", "1")
    {
        REGISTRY = registry;
    }

    // ---------------------------------------------------------------------------------------
    //                                          LINKING
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc IHumanLinks
    function linkBySourceTx(SourceProof calldata proof) external override {
        ProvenTx memory t = _proveTx(proof);
        _consume(t.queryId);

        address from = t.common.from;
        address to = t.common.toIsNull ? address(0) : t.common.to;
        if (to != from) revert NotSelfSend(from, to);

        (uint256 human, address creditcoinWallet, uint256 chainId, address target) = _readIntent(t.common.data);
        if (chainId != block.chainid || target != address(this)) revert WrongLinkTarget(chainId, target);
        if (creditcoinWallet != msg.sender) revert IntentForAnotherWallet(creditcoinWallet, msg.sender);
        uint256 callerHuman = _humanOf(msg.sender);
        if (human != callerHuman) revert IntentForAnotherHuman(human, callerHuman);

        _link(human, from, Method.SourceTx, t.chainKey, t.blockHeight, t.queryId);
    }

    /// @inheritdoc IHumanLinks
    function linkBySignature(address wallet, uint256 deadline, bytes calldata signature) external override {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        uint256 human = _humanOf(msg.sender);

        address recovered = ECDSA.recover(linkDigest(human, msg.sender, wallet, deadline), signature);
        if (recovered != wallet) revert BadSignature(recovered, wallet);

        _link(human, wallet, Method.Signature, 0, 0, bytes32(0));
    }

    // ---------------------------------------------------------------------------------------
    //                                           VIEWS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc IHumanLinks
    function humanOfWallet(address wallet) external view override returns (uint256) {
        return _links[wallet].human;
    }

    /// @inheritdoc IHumanLinks
    function linkOf(address wallet) external view override returns (Link memory) {
        return _links[wallet];
    }

    /// @inheritdoc IHumanLinks
    function linksOf(uint256 human) external view override returns (address[] memory) {
        return _walletsOf[human];
    }

    /// @inheritdoc IHumanLinks
    function linkCount(uint256 human) external view override returns (uint256) {
        return _walletsOf[human].length;
    }

    /// @inheritdoc IHumanLinks
    function linkIntent(uint256 human, address creditcoinWallet) external view override returns (bytes memory) {
        return abi.encodePacked(LINK_MARKER, abi.encode(human, creditcoinWallet, block.chainid, address(this)));
    }

    /// @inheritdoc IHumanLinks
    function linkDigest(uint256 human, address creditcoinWallet, address wallet, uint256 deadline)
        public
        view
        override
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(LINK_TYPEHASH, human, creditcoinWallet, wallet, deadline)));
    }

    // ---------------------------------------------------------------------------------------
    //                                         INTERNALS
    // ---------------------------------------------------------------------------------------

    function _link(uint256 human, address wallet, Method method, uint64 chainKey, uint64 blockHeight, bytes32 queryId)
        private
    {
        if (wallet == address(0)) revert ZeroWallet();
        uint256 existing = _links[wallet].human;
        if (existing != 0) revert WalletAlreadyLinked(wallet, existing);
        address[] storage wallets = _walletsOf[human];
        if (wallets.length >= MAX_LINKS) revert TooManyLinks(human);

        _links[wallet] = Link({
            human: human,
            chainKey: chainKey,
            blockHeight: blockHeight,
            linkedAt: uint64(block.timestamp),
            method: method
        });
        wallets.push(wallet);

        emit WalletLinked(human, wallet, method, chainKey, blockHeight, queryId);
    }

    function _readIntent(bytes memory data)
        private
        pure
        returns (uint256 human, address creditcoinWallet, uint256 chainId, address target)
    {
        if (data.length != INTENT_LENGTH || bytes4(data) != LINK_MARKER) revert NotALinkIntent();
        bytes memory body = new bytes(INTENT_LENGTH - 4);
        for (uint256 i; i < body.length; ++i) {
            body[i] = data[i + 4];
        }
        uint256 wallet;
        uint256 targetWord;
        (human, wallet, chainId, targetWord) = abi.decode(body, (uint256, uint256, uint256, uint256));
        // Reject dirty upper bits rather than silently truncating them.
        if (wallet > type(uint160).max || targetWord > type(uint160).max) revert NotALinkIntent();
        creditcoinWallet = address(uint160(wallet));
        target = address(uint160(targetWord));
    }

    function _humanOf(address wallet) private view returns (uint256 human) {
        human = IHumanRegistry(REGISTRY).humanOf(wallet);
        if (human == 0) revert NotHuman(wallet);
    }
}
