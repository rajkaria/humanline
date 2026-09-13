// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IHumanRegistry
/// @notice One human, one wallet. A World ID nullifier proves personhood once per app+action; the
///         registry binds that nullifier to a wallet and lets the human move wallets later.
interface IHumanRegistry {
    /// @notice A nullifier was seen for the first time and bound to `wallet`.
    event HumanRegistered(uint256 indexed nullifierHash, address indexed wallet, uint256 root);
    /// @notice The same human proved again from a new wallet; the old wallet is unbound.
    event HumanRebound(uint256 indexed nullifierHash, address indexed oldWallet, address indexed newWallet);

    /// @notice This wallet is already bound to a different human.
    error WalletAlreadyHuman(address wallet, uint256 nullifierHash);
    /// @notice The nullifier is already bound to this exact wallet; nothing to do.
    error SameWallet();
    /// @notice A World ID proof can never carry a zero nullifier.
    error ZeroNullifier();

    /// @notice Prove personhood for `msg.sender` and bind (or re-bind) the wallet.
    function register(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external;

    function isHuman(address wallet) external view returns (bool);
    function humanOf(address wallet) external view returns (uint256);
    function walletOf(uint256 nullifierHash) external view returns (address);
    function registeredAt(uint256 nullifierHash) external view returns (uint64);
    function humanCount() external view returns (uint256);

    function WORLD_ID() external view returns (address);
    function EXTERNAL_NULLIFIER_HASH() external view returns (uint256);
    function APP_ID() external view returns (string memory);
    function ACTION() external view returns (string memory);
}
