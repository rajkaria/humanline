// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AttestedWorldID} from "../../src/AttestedWorldID.sol";

/// @notice `AttestedWorldID` with the two precompile-backed guards stubbed.
/// @dev Unit tests run in a bare Foundry EVM, where Creditcoin's ChainInfo (`0x0FD3`) and
///      AttestorStash (`0x0FD4`) native precompiles do not exist. The production contract keeps
///      those reads behind `internal virtual` hooks for exactly this reason; the fork tests read
///      the real precompiles over RPC.
contract AttestedWorldIDHarness is AttestedWorldID {
    uint64 public attestedTip;
    uint32 public attestorCount;

    constructor(
        uint64 sourceChainKey,
        address identityManager,
        uint64 finalityDepth,
        uint32 minAttestors,
        uint64 sourceBlockTime
    ) AttestedWorldID(sourceChainKey, identityManager, finalityDepth, minAttestors, sourceBlockTime) {
        attestorCount = type(uint32).max;
    }

    function setAttestedTip(uint64 tip) external {
        attestedTip = tip;
    }

    function setAttestorCount(uint32 count) external {
        attestorCount = count;
    }

    function _attestedTip() internal view override returns (uint64) {
        return attestedTip;
    }

    function _attestorCount() internal view override returns (uint32) {
        return attestorCount;
    }
}
