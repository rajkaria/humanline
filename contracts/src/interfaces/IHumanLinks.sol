// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceProof} from "./ISourceProof.sol";

/// @title IHumanLinks
/// @notice One human, many wallets, each wallet belonging to exactly one human, forever.
/// @dev A human (a World ID nullifier registered in `HumanRegistry`) links wallets from other chains
///      so their on-chain history can count and their payments can settle. A link needs consent on
///      both sides: the wallet's key (an Ethereum transaction or a signature) and the human's
///      Creditcoin wallet (the caller). A linked wallet can never be unlinked or moved to another
///      human, so one wallet's history can never be counted twice.
interface IHumanLinks {
    enum Method {
        None,
        /// An Attestcoin-proved Ethereum transaction from the wallet carrying the link intent.
        SourceTx,
        /// An EIP-712 signature by the wallet's key, verified on Creditcoin.
        Signature
    }

    struct Link {
        uint256 human;
        uint64 chainKey;
        uint64 blockHeight;
        uint64 linkedAt;
        Method method;
    }

    event WalletLinked(
        uint256 indexed human,
        address indexed wallet,
        Method method,
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 queryId
    );

    /// @notice The caller is not a registered human.
    error NotHuman(address caller);
    /// @notice A link transaction must be sent by the wallet to itself.
    error NotSelfSend(address from, address to);
    /// @notice The calldata is not a Humanline link intent.
    error NotALinkIntent();
    /// @notice The intent names another Creditcoin chain or another HumanLinks deployment.
    error WrongLinkTarget(uint256 chainId, address target);
    /// @notice The intent names a different human than the caller's.
    error IntentForAnotherHuman(uint256 intended, uint256 caller);
    /// @notice The intent names a different Creditcoin wallet than the caller.
    error IntentForAnotherWallet(address intended, address caller);
    /// @notice The wallet is already linked (to this or another human).
    error WalletAlreadyLinked(address wallet, uint256 human);
    /// @notice The human already holds `MAX_LINKS` links.
    error TooManyLinks(uint256 human);
    /// @notice The signed link has expired.
    error SignatureExpired(uint256 deadline);
    /// @notice The signature was not made by `wallet`.
    error BadSignature(address recovered, address wallet);
    /// @notice The zero address cannot be linked.
    error ZeroWallet();

    /// @notice Link the sender of a proved Ethereum transaction to the caller's human.
    function linkBySourceTx(SourceProof calldata proof) external;

    /// @notice Link `wallet` to the caller's human with the wallet's EIP-712 signature.
    function linkBySignature(address wallet, uint256 deadline, bytes calldata signature) external;

    function humanOfWallet(address wallet) external view returns (uint256);
    function linkOf(address wallet) external view returns (Link memory);
    function linksOf(uint256 human) external view returns (address[] memory);
    function linkCount(uint256 human) external view returns (uint256);

    /// @notice The exact calldata a wallet sends to itself to link to `human` via `creditcoinWallet`.
    function linkIntent(uint256 human, address creditcoinWallet) external view returns (bytes memory);
    /// @notice The EIP-712 digest `wallet` signs for `linkBySignature`.
    function linkDigest(uint256 human, address creditcoinWallet, address wallet, uint256 deadline)
        external
        view
        returns (bytes32);

    function REGISTRY() external view returns (address);
    function MAX_LINKS() external view returns (uint256);
    function LINK_MARKER() external view returns (bytes4);
}
