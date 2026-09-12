// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWorldID} from "worldid/IWorldID.sol";

/// @notice A World ID verifier stand-in that records what it was asked to verify.
/// @dev Groth16 verification itself is covered end to end by `AttestedWorldID.t.sol` against the
///      real vendored Semaphore verifier. What the registry tests need instead is visibility: that
///      the signal hash really is the caller's wallet, that the external nullifier really is the
///      production one, and that a rejected proof stops the registration.
contract MockWorldID is IWorldID {
    bool public accepts = true;

    uint256 public lastRoot;
    uint256 public lastSignalHash;
    uint256 public lastNullifierHash;
    uint256 public lastExternalNullifierHash;
    uint256 public calls;

    error ProofRejected();

    function setAccepts(bool value) external {
        accepts = value;
    }

    function verifyProof(
        uint256 root,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata
    ) external override {
        if (!accepts) revert ProofRejected();
        lastRoot = root;
        lastSignalHash = signalHash;
        lastNullifierHash = nullifierHash;
        lastExternalNullifierHash = externalNullifierHash;
        ++calls;
    }

    function verifyCompressedProof(uint256, uint256, uint256, uint256, uint256[4] calldata)
        external
        view
        override
    {
        if (!accepts) revert ProofRejected();
    }
}
