// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One attestor's registration (`exists == false` when unknown). `status`: 0 Active, 1 Idle, 2 Waiting.
struct AttestorInfo {
    bool exists;
    uint8 status;
    bytes32 stash;
    bool hasBlsKey;
}

/// @title IAttestorStash
/// @notice Minimal, independently written interface for the Creditcoin AttestorStash precompile at
///         `0x0000000000000000000000000000000000000fd4`. Humanline reads two numbers from it: the
///         bonded-attestor count, as a quorum floor before accepting a relayed root, and the minimum
///         bond, which together with that count is the capital a colluding quorum would put at
///         stake. `CreditLine` caps outstanding credit against it.
/// @dev Signatures confirmed against `precompiles/metadata/sol/attestor_stash.sol` in gluwa/creditcoin3:
///        getAttestorsCount(uint64)          -> 0x8de0db2f
///        getMinBondRequirement(uint64)      returns uint128, wei of CTC
///        getAttestor(uint64,bytes32)        returns AttestorInfo
///        isActiveAttestor(uint64,bytes32)   returns bool
///      The attestor set cannot be enumerated from the precompile and it exposes no slashing data;
///      Humanline therefore treats `count × minBond` as a floor on bonded capital, not a proven loss.
interface IAttestorStash {
    /// @notice Number of registered (bonded) attestors for a source chain.
    function getAttestorsCount(uint64 chainKey) external view returns (uint32 count);

    /// @notice Minimum bond, in wei of CTC, an attestor must hold for this source chain.
    function getMinBondRequirement(uint64 chainKey) external view returns (uint128 minBond);

    /// @notice Registration details for one attestor id.
    function getAttestor(uint64 chainKey, bytes32 attestorId) external view returns (AttestorInfo memory info);

    /// @notice Whether an attestor id is currently in the active set.
    function isActiveAttestor(uint64 chainKey, bytes32 attestorId) external view returns (bool active);
}

/// @notice Canonical address of the AttestorStash precompile on Creditcoin 3.
library AttestorStashLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fd4;

    function get() internal pure returns (IAttestorStash) {
        return IAttestorStash(PRECOMPILE);
    }
}
