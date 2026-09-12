// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Stand-in for the Creditcoin block-prover precompile (`0x0FD2`), which is a native
///         Substrate precompile and therefore does not exist inside Foundry's EVM.
/// @dev Etched over `0x0FD2` with `vm.etch`, so it must be storage-free: every answer is derived
///      from the arguments. `calculateTxIndex` reproduces the precompile's own rule - the
///      transaction index is the little-endian bit string of the sibling `isLeft` flags - which is
///      checked against both real fixtures (mainnet 173, sepolia 58) in `AttestedWorldID.t.sol`.
contract MockNativeQueryVerifier is INativeQueryVerifier {
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external override returns (bool) {
        emit TransactionVerified(chainKey, height, _txIndex(merkleProof));
        return _accepts();
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata
    ) external override returns (bool) {
        for (uint256 i; i < heights.length; ++i) {
            emit TransactionVerified(chainKey, heights[i], _txIndex(merkleProofs[i]));
        }
        return _accepts();
    }

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        override
        returns (bool)
    {
        return _accepts();
    }

    function verify(uint64, uint64[] calldata, bytes[] calldata, MerkleProof[] calldata, ContinuityProof calldata)
        external
        view
        override
        returns (bool)
    {
        return _accepts();
    }

    function calculateTxIndex(MerkleProof calldata merkleProof) external pure override returns (uint64) {
        return _txIndex(merkleProof);
    }

    /// @dev Overridden by `RejectingNativeQueryVerifier` to model a precompile that says "no".
    function _accepts() internal view virtual returns (bool) {
        return true;
    }

    function _txIndex(MerkleProof calldata merkleProof) private pure returns (uint64 index) {
        uint256 n = merkleProof.siblings.length;
        for (uint256 i; i < n; ++i) {
            if (merkleProof.siblings[i].isLeft) index |= uint64(1) << uint64(i);
        }
    }
}

/// @notice Same shape, but the precompile rejects the proof.
contract RejectingNativeQueryVerifier is MockNativeQueryVerifier {
    function _accepts() internal view virtual override returns (bool) {
        return false;
    }
}
