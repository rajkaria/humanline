// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IAttestorStash
/// @notice Minimal, independently written interface for the Creditcoin AttestorStash precompile at
///         `0x0000000000000000000000000000000000000fd4`. Humanline only needs the bonded-attestor
///         count, which it uses as a quorum floor before accepting a relayed root.
/// @dev Selector confirmed against `precompiles/metadata/sol/attestor_stash.sol` in
///      gluwa/creditcoin3: getAttestorsCount(uint64) -> 0x8de0db2f
interface IAttestorStash {
    /// @notice Number of registered (bonded) attestors for a source chain.
    function getAttestorsCount(uint64 chainKey) external view returns (uint32 count);
}

/// @notice Canonical address of the AttestorStash precompile on Creditcoin 3.
library AttestorStashLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fd4;

    function get() internal pure returns (IAttestorStash) {
        return IAttestorStash(PRECOMPILE);
    }
}
