// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWorldID} from "worldid/IWorldID.sol";

import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {ByteHasher} from "./libraries/ByteHasher.sol";

/// @title HumanRegistry
/// @notice Turns a World ID proof into a durable on-chain fact: this wallet belongs to a human, and
///         that human holds at most one wallet at a time.
/// @dev The nullifier hash is the identity. It is stable for a given (app, action) pair and reveals
///      nothing about the person. Re-registering from a new wallet moves the binding, which is how
///      a human recovers from a lost key without minting a second identity.
///      No owner, no pause, no upgrade: the World ID verifier and the external nullifier are fixed
///      at construction.
contract HumanRegistry is IHumanRegistry {
    using ByteHasher for bytes;

    /// @inheritdoc IHumanRegistry
    address public immutable override WORLD_ID;
    /// @inheritdoc IHumanRegistry
    uint256 public immutable override EXTERNAL_NULLIFIER_HASH;
    /// @inheritdoc IHumanRegistry
    string public override APP_ID;
    /// @inheritdoc IHumanRegistry
    string public override ACTION;

    /// @inheritdoc IHumanRegistry
    mapping(address => uint256) public override humanOf;
    /// @inheritdoc IHumanRegistry
    mapping(uint256 => address) public override walletOf;
    /// @inheritdoc IHumanRegistry
    mapping(uint256 => uint64) public override registeredAt;
    /// @inheritdoc IHumanRegistry
    uint256 public override humanCount;

    /// @param worldId The World ID verifier (Humanline's `AttestedWorldID` on Creditcoin).
    /// @param appId The World Developer Portal app id, e.g. `app_87b2...`.
    /// @param action The action string proofs are scoped to, e.g. `humanline-register`.
    constructor(address worldId, string memory appId, string memory action) {
        WORLD_ID = worldId;
        APP_ID = appId;
        ACTION = action;
        EXTERNAL_NULLIFIER_HASH =
            abi.encodePacked(abi.encodePacked(appId).hashToField(), action).hashToField();
    }

    /// @inheritdoc IHumanRegistry
    /// @dev The signal is the caller's own address, so a proof cannot be lifted out of the mempool
    ///      and replayed from someone else's wallet.
    function register(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external override {
        if (nullifierHash == 0) revert ZeroNullifier();

        uint256 boundHuman = humanOf[msg.sender];
        if (boundHuman != 0 && boundHuman != nullifierHash) {
            revert WalletAlreadyHuman(msg.sender, boundHuman);
        }

        address boundWallet = walletOf[nullifierHash];
        if (boundWallet == msg.sender) revert SameWallet();

        IWorldID(WORLD_ID).verifyProof(
            root, abi.encodePacked(msg.sender).hashToField(), nullifierHash, EXTERNAL_NULLIFIER_HASH, proof
        );

        walletOf[nullifierHash] = msg.sender;
        humanOf[msg.sender] = nullifierHash;

        if (boundWallet == address(0)) {
            registeredAt[nullifierHash] = uint64(block.timestamp);
            unchecked {
                ++humanCount;
            }
            emit HumanRegistered(nullifierHash, msg.sender, root);
        } else {
            delete humanOf[boundWallet];
            emit HumanRebound(nullifierHash, boundWallet, msg.sender);
        }
    }

    /// @inheritdoc IHumanRegistry
    function isHuman(address wallet) external view override returns (bool) {
        return humanOf[wallet] != 0;
    }

    /// @notice The World ID signal hash a given wallet must prove against. Exposed for the web app
    ///         and the worker so they never have to re-derive the rule.
    function signalHashOf(address wallet) external pure returns (uint256) {
        return abi.encodePacked(wallet).hashToField();
    }
}
