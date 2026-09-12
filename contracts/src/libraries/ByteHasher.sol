// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ByteHasher
/// @notice World ID's field-hashing rule: keccak256 shifted right by 8 bits so the result always
///         fits the BN254 scalar field that the Semaphore circuit works over.
library ByteHasher {
    /// @dev `hashToField(b) = uint256(keccak256(b)) >> 8`
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
}
