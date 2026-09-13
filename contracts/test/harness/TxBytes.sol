// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Surgical edits to a real prover `txBytes` blob.
/// @dev The negative tests want a transaction that is byte-for-byte the real mainnet one except
///      for the single field under test (receipt status, callee, calldata, log set). Re-encoding
///      only the affected chunk keeps everything else authentic, including the 100 real identity
///      commitments and the real EIP-1559 signature chunk.
///      Encoding (see `EvmV1Decoder`): `abi.encode(uint8 txType, bytes[] chunks)`, where
///      `chunks[0]` is the common tx fields and the last chunk is the receipt.
library TxBytes {
    function split(bytes memory encodedTx) internal pure returns (uint8 txType, bytes[] memory chunks) {
        (txType, chunks) = abi.decode(encodedTx, (uint8, bytes[]));
    }

    function receiptIndex(uint8 txType) internal pure returns (uint256) {
        return txType <= 2 ? 2 : 3;
    }

    function common(bytes memory encodedTx)
        internal
        pure
        returns (uint64 nonce, uint64 gasLimit, address from, bool toIsNull, address to, uint256 value, bytes memory data)
    {
        (, bytes[] memory chunks) = split(encodedTx);
        return abi.decode(chunks[0], (uint64, uint64, address, bool, address, uint256, bytes));
    }

    function receipt(bytes memory encodedTx)
        internal
        pure
        returns (uint8 status, uint64 gasUsed, EvmV1Decoder.LogEntryTuple[] memory logs, bytes memory bloom)
    {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        return abi.decode(
            chunks[receiptIndex(txType)], (uint8, uint64, EvmV1Decoder.LogEntryTuple[], bytes)
        );
    }

    function withStatus(bytes memory encodedTx, uint8 newStatus) internal pure returns (bytes memory) {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (, uint64 gasUsed, EvmV1Decoder.LogEntryTuple[] memory logs, bytes memory bloom) = receipt(encodedTx);
        chunks[receiptIndex(txType)] = abi.encode(newStatus, gasUsed, logs, bloom);
        return abi.encode(txType, chunks);
    }

    function withLogs(bytes memory encodedTx, EvmV1Decoder.LogEntryTuple[] memory newLogs)
        internal
        pure
        returns (bytes memory)
    {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (uint8 status, uint64 gasUsed,, bytes memory bloom) = receipt(encodedTx);
        chunks[receiptIndex(txType)] = abi.encode(status, gasUsed, newLogs, bloom);
        return abi.encode(txType, chunks);
    }

    function withTo(bytes memory encodedTx, address newTo) internal pure returns (bytes memory) {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (uint64 nonce, uint64 gasLimit, address from,,, uint256 value, bytes memory data) = common(encodedTx);
        chunks[0] = abi.encode(nonce, gasLimit, from, false, newTo, value, data);
        return abi.encode(txType, chunks);
    }

    function withToNull(bytes memory encodedTx) internal pure returns (bytes memory) {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (uint64 nonce, uint64 gasLimit, address from,,, uint256 value, bytes memory data) = common(encodedTx);
        chunks[0] = abi.encode(nonce, gasLimit, from, true, address(0), value, data);
        return abi.encode(txType, chunks);
    }

    function withData(bytes memory encodedTx, bytes memory newData) internal pure returns (bytes memory) {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (uint64 nonce, uint64 gasLimit, address from, bool toIsNull, address to, uint256 value,) =
            common(encodedTx);
        chunks[0] = abi.encode(nonce, gasLimit, from, toIsNull, to, value, newData);
        return abi.encode(txType, chunks);
    }

    /// @notice Replace sender, callee and calldata; nonce, gas, value, signature chunk and receipt stay real.
    function withCommon(bytes memory encodedTx, address from, address to, bytes memory data)
        internal
        pure
        returns (bytes memory)
    {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        (uint64 nonce, uint64 gasLimit,,,, uint256 value,) = common(encodedTx);
        chunks[0] = abi.encode(nonce, gasLimit, from, false, to, value, data);
        return abi.encode(txType, chunks);
    }

    /// @notice Rewrite the chain id inside a type-2 transaction's type-specific chunk.
    function withType2ChainId(bytes memory encodedTx, uint64 chainId) internal pure returns (bytes memory) {
        (uint8 txType, bytes[] memory chunks) = split(encodedTx);
        require(txType == 2, "TxBytes: not type 2");
        (
            ,
            uint128 maxPriorityFeePerGas,
            uint128 maxFeePerGas,
            EvmV1Decoder.AccessListEntryBytes32[] memory accessList,
            uint8 yParity,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
            chunks[1], (uint64, uint128, uint128, EvmV1Decoder.AccessListEntryBytes32[], uint8, bytes32, bytes32)
        );
        chunks[1] = abi.encode(chainId, maxPriorityFeePerGas, maxFeePerGas, accessList, yParity, r, s);
        return abi.encode(txType, chunks);
    }

    /// @notice Replace one log of the receipt.
    function withLogAt(bytes memory encodedTx, uint256 index, EvmV1Decoder.LogEntryTuple memory log)
        internal
        pure
        returns (bytes memory)
    {
        (,, EvmV1Decoder.LogEntryTuple[] memory logs,) = receipt(encodedTx);
        logs[index] = log;
        return withLogs(encodedTx, logs);
    }

    /// @notice A copy of one receipt log.
    function logAt(bytes memory encodedTx, uint256 index) internal pure returns (EvmV1Decoder.LogEntryTuple memory) {
        (,, EvmV1Decoder.LogEntryTuple[] memory logs,) = receipt(encodedTx);
        return logs[index];
    }

    /// @notice Rewrite a `registerIdentities` call in place: new pre/post root and commitment count,
    ///         everything else (the eight proof words, the start index) untouched.
    function retargetRegister(bytes memory data, uint256 preRoot, uint256 postRoot, uint32 humansAdded)
        internal
        pure
        returns (bytes memory out)
    {
        uint256[8] memory proof;
        for (uint256 i; i < 8; ++i) {
            proof[i] = uint256(word(data, 4 + i * 32));
        }
        uint32 startIndex = uint32(uint256(word(data, 4 + 9 * 32)));
        uint256[] memory commitments = new uint256[](humansAdded);
        for (uint256 i; i < humansAdded; ++i) {
            commitments[i] = uint256(keccak256(abi.encode(postRoot, i)));
        }
        out = abi.encodePacked(
            bytes4(0x2217b211), abi.encode(proof, preRoot, startIndex, commitments, postRoot)
        );
    }

    /// @notice A `deleteIdentities(uint256[8],bytes,uint256,uint256)` call body.
    function buildDelete(uint256 preRoot, uint256 postRoot) internal pure returns (bytes memory) {
        uint256[8] memory proof;
        bytes memory packedIndices = hex"0000000100000002";
        return abi.encodePacked(bytes4(0xea10fbbe), abi.encode(proof, packedIndices, preRoot, postRoot));
    }

    function word(bytes memory data, uint256 at) internal pure returns (bytes32 out) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            out := mload(add(add(data, 0x20), at))
        }
    }
}
