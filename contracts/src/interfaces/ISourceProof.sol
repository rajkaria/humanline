// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice One Attestcoin proof of one source-chain transaction, exactly as the CC3 proof builder's
///         `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` returns it.
/// @param chainKey Attestcoin chain key (testnet: 1 = Sepolia, 3 = Ethereum).
/// @param blockHeight `headerNumber` of the block holding the transaction.
/// @param encodedTransaction `txBytes`: EvmV1 `abi.encode(uint8 txType, bytes[] chunks)`.
/// @param merkleProof Transaction inclusion in the block.
/// @param continuityProof Chain continuity from that block to an attested checkpoint.
struct SourceProof {
    uint64 chainKey;
    uint64 blockHeight;
    bytes encodedTransaction;
    INativeQueryVerifier.MerkleProof merkleProof;
    INativeQueryVerifier.ContinuityProof continuityProof;
}
