// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {SourceProof} from "./interfaces/ISourceProof.sol";
import {ChainInfoLib, ChainInfoResult, HeightHashResult, IChainInfo} from "./interfaces/IChainInfo.sol";
import {AttestorStashLib} from "./interfaces/IAttestorStash.sol";

/// @title ProvenSource
/// @notice Shared plumbing for every Humanline contract that acts on a proved Ethereum transaction
///         other than a World ID root update: wallet links, Aave credit history and Ethereum-side
///         repayments.
/// @dev One call to `_proveTx` does everything that does not depend on what the transaction means:
///        1. the chain key is one this contract was configured for, and ChainInfo `0x0FD3` confirmed
///           at deployment that it maps to the EVM chain id the deployer claimed;
///        2. BlockProver `0x0FD2` `verifyAndEmit` accepts inclusion and continuity;
///        3. the block sits `FINALITY_DEPTH` below the attested tip (ChainInfo `0x0FD3`);
///        4. at least `MIN_ATTESTORS` attestors are bonded for that chain (AttestorStash `0x0FD4`);
///        5. the receipt status is success;
///        6. the transaction was *signed for* that chain id, read from the type-specific chunk, so a
///           signature valid on another chain can never stand in for this one.
///      Callers then read calldata or logs and consume a replay key of their own choosing.
abstract contract ProvenSource {
    /// @notice The Attestcoin block prover.
    INativeQueryVerifier public immutable VERIFIER;
    /// @notice Attested source blocks that must sit above a proved block.
    uint64 public immutable FINALITY_DEPTH;
    /// @notice Minimum bonded attestors for the proved chain.
    uint32 public immutable MIN_ATTESTORS;

    /// @notice EVM chain id for each accepted chain key; zero means the key is not accepted.
    mapping(uint64 chainKey => uint64 chainId) public chainIdOf;
    /// @notice Replay keys already used (a query id, or a query id plus log index).
    mapping(bytes32 id => bool) public consumed;

    /// @notice Everything `_proveTx` hands back about a transaction it accepted.
    struct ProvenTx {
        bytes32 queryId;
        uint64 chainKey;
        uint64 blockHeight;
        uint64 txIndex;
        EvmV1Decoder.CommonTxFields common;
        EvmV1Decoder.ReceiptFields receipt;
    }

    error BadSourceConfig();
    error WrongSourceChain(uint64 chainKey, uint64 recordedChainId, uint64 claimedChainId);
    error UnsupportedSourceChain(uint64 chainKey);
    error ProofRejected();
    error NotFinal(uint64 attestedTip, uint64 blockHeight);
    error ThinQuorum(uint32 attestors, uint32 required);
    error SourceTxReverted();
    error WrongTxChainId(uint64 signedFor, uint64 expected);
    error UnprotectedLegacyTx();
    error UnsupportedTxType(uint8 txType);
    error LogIndexOutOfRange(uint256 logIndex, uint256 logCount);
    error AlreadyConsumed(bytes32 id);

    /// @param chainKeys Accepted Attestcoin chain keys.
    /// @param chainIds The EVM chain id each key must map to in ChainInfo.
    /// @param finalityDepth See `FINALITY_DEPTH`.
    /// @param minAttestors See `MIN_ATTESTORS`.
    constructor(uint64[] memory chainKeys, uint64[] memory chainIds, uint64 finalityDepth, uint32 minAttestors) {
        if (chainKeys.length == 0 || chainKeys.length != chainIds.length) revert BadSourceConfig();
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        FINALITY_DEPTH = finalityDepth;
        MIN_ATTESTORS = minAttestors;
        for (uint256 i; i < chainKeys.length; ++i) {
            (bool exists, uint64 recorded) = _chainInfoChainId(chainKeys[i]);
            if (!exists || chainIds[i] == 0 || recorded != chainIds[i]) {
                revert WrongSourceChain(chainKeys[i], recorded, chainIds[i]);
            }
            chainIdOf[chainKeys[i]] = chainIds[i];
        }
    }

    // ---------------------------------------------------------------------------------------
    //                                         PROVING
    // ---------------------------------------------------------------------------------------

    /// @dev Steps 1-6 of the contract-level note. Does not consume a replay key.
    function _proveTx(SourceProof calldata proof) internal returns (ProvenTx memory t) {
        uint64 expectedChainId = chainIdOf[proof.chainKey];
        if (expectedChainId == 0) revert UnsupportedSourceChain(proof.chainKey);

        bool verified = VERIFIER.verifyAndEmit(
            proof.chainKey, proof.blockHeight, proof.encodedTransaction, proof.merkleProof, proof.continuityProof
        );
        if (!verified) revert ProofRejected();

        uint64 tip = _attestedTip(proof.chainKey);
        if (tip < proof.blockHeight + FINALITY_DEPTH) revert NotFinal(tip, proof.blockHeight);
        uint32 attestors = _attestorCount(proof.chainKey);
        if (attestors < MIN_ATTESTORS) revert ThinQuorum(attestors, MIN_ATTESTORS);

        t.chainKey = proof.chainKey;
        t.blockHeight = proof.blockHeight;
        t.txIndex = VERIFIER.calculateTxIndex(proof.merkleProof);
        t.queryId = queryIdOf(proof.chainKey, proof.blockHeight, t.txIndex);

        bytes memory encoded = proof.encodedTransaction;
        t.receipt = EvmV1Decoder.decodeReceiptFields(encoded);
        if (t.receipt.receiptStatus != 1) revert SourceTxReverted();

        uint64 signedFor = txChainId(encoded);
        if (signedFor != expectedChainId) revert WrongTxChainId(signedFor, expectedChainId);

        t.common = EvmV1Decoder.decodeCommonTxFields(encoded);
    }

    /// @dev Marks a replay key used, or reverts if it already was.
    function _consume(bytes32 id) internal {
        if (consumed[id]) revert AlreadyConsumed(id);
        consumed[id] = true;
    }

    /// @dev The log at `logIndex` within the transaction's own receipt (not the block-wide index).
    function _logAt(EvmV1Decoder.ReceiptFields memory receipt, uint256 logIndex)
        internal
        pure
        returns (EvmV1Decoder.LogEntry memory)
    {
        uint256 count = receipt.receiptLogs.length;
        if (logIndex >= count) revert LogIndexOutOfRange(logIndex, count);
        return receipt.receiptLogs[logIndex];
    }

    // ---------------------------------------------------------------------------------------
    //                                       PURE HELPERS
    // ---------------------------------------------------------------------------------------

    /// @notice `ASCBase`'s query id: `keccak256(chainKey ‖ blockHeight << 192 ‖ txIndex)`, 72 bytes.
    function queryIdOf(uint64 chainKey, uint64 blockHeight, uint256 txIndex) public pure returns (bytes32 id) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            id := keccak256(ptr, 72)
        }
    }

    /// @notice Replay key for one log of one proved transaction.
    function logIdOf(bytes32 queryId, uint256 logIndex) public pure returns (bytes32) {
        return keccak256(abi.encode(queryId, logIndex));
    }

    /// @notice The EVM chain id a proved transaction was signed for.
    /// @dev Type 2 goes through `EvmV1Decoder.decodeTransactionType2`. `@gluwa/asc-contracts` 0.2.1
    ///      ships no decoder for types 1, 3 and 4, but in each of them `chainId` is the first static
    ///      field of the type-specific chunk, so it is the chunk's first word. A legacy transaction
    ///      carries it in `v` (EIP-155); one signed without EIP-155 is valid on every chain and is
    ///      refused outright.
    function txChainId(bytes memory encodedTx) public pure returns (uint64) {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTx);
        if (txType == 2) return EvmV1Decoder.decodeTransactionType2(encodedTx).type2.chainId;

        (, bytes[] memory chunks) = abi.decode(encodedTx, (uint8, bytes[]));
        if (chunks.length < 3 || chunks[1].length < 32) revert UnsupportedTxType(txType);

        if (txType == 0) {
            (, uint256 v,,) = abi.decode(chunks[1], (uint128, uint256, bytes32, bytes32));
            if (v < 35) revert UnprotectedLegacyTx();
            uint256 id = (v - 35) / 2;
            if (id > type(uint64).max) revert UnsupportedTxType(txType);
            return uint64(id);
        }
        if (txType == 1 || txType == 3 || txType == 4) {
            uint256 id = uint256(bytes32(chunks[1]));
            if (id > type(uint64).max) revert UnsupportedTxType(txType);
            return uint64(id);
        }
        revert UnsupportedTxType(txType);
    }

    // ---------------------------------------------------------------------------------------
    //                                  PRECOMPILE READS (virtual)
    // ---------------------------------------------------------------------------------------

    /// @notice Highest source height the attestors stand behind (attestation or checkpoint).
    /// @dev `internal virtual` only so unit tests can run without the native precompiles.
    function _attestedTip(uint64 chainKey) internal view virtual returns (uint64 tip) {
        IChainInfo chainInfo = ChainInfoLib.get();
        HeightHashResult memory attestation = chainInfo.get_latest_attestation_height_and_hash(chainKey);
        if (attestation.exists) tip = attestation.height;
        HeightHashResult memory checkpoint = chainInfo.get_latest_checkpoint_height_and_hash(chainKey);
        if (checkpoint.exists && checkpoint.height > tip) tip = checkpoint.height;
    }

    /// @notice Bonded attestors for a chain key, from AttestorStash `0x0FD4`.
    function _attestorCount(uint64 chainKey) internal view virtual returns (uint32) {
        return AttestorStashLib.get().getAttestorsCount(chainKey);
    }

    /// @notice The EVM chain id ChainInfo `0x0FD3` records for a chain key.
    function _chainInfoChainId(uint64 chainKey) internal view virtual returns (bool exists, uint64 chainId) {
        ChainInfoResult memory result = ChainInfoLib.get().get_chain_by_key(chainKey);
        return (result.exists, result.info.chainId);
    }
}
