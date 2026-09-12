// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {WorldIDBridge} from "worldid/WorldIDBridge.sol";

import {IAttestedWorldID} from "./interfaces/IAttestedWorldID.sol";
import {IChainInfo, ChainInfoLib, HeightHashResult} from "./interfaces/IChainInfo.sol";
import {AttestorStashLib} from "./interfaces/IAttestorStash.sol";

/// @title AttestedWorldID
/// @notice A World ID root mirror on Creditcoin whose only trusted input is an Attestcoin proof of
///         a source-chain World ID identity-manager transaction. Anyone may relay; there is no
///         owner, no pause and no upgrade path.
/// @dev Attestcoin's block-prover precompile proves *inclusion and continuity* of a source-chain
///      transaction. Everything that makes the relayed root meaningful is checked here:
///      source chain, receipt status, callee, log emitter, calldata/log agreement, root chaining,
///      finality depth, attestor quorum, and one-time processing per query id.
contract AttestedWorldID is ASCBase, WorldIDBridge, IAttestedWorldID {
    /// @dev World ID's identity tree depth on mainnet and the staging tree alike.
    uint8 internal constant TREE_DEPTH = 30;

    /// @dev keccak256("TreeChanged(uint256,uint8,uint256)")
    bytes32 internal constant TREE_CHANGED_TOPIC =
        0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04;

    /// @dev registerIdentities(uint256[8],uint256,uint32,uint256[],uint256)
    bytes4 internal constant REGISTER_IDENTITIES = 0x2217b211;

    /// @dev deleteIdentities(uint256[8],bytes,uint256,uint256)
    bytes4 internal constant DELETE_IDENTITIES = 0xea10fbbe;

    /// @inheritdoc IAttestedWorldID
    uint256 public constant override MAX_BATCH = 10;

    /// @inheritdoc IAttestedWorldID
    uint64 public immutable override SOURCE_CHAIN_KEY;
    /// @inheritdoc IAttestedWorldID
    address public immutable override IDENTITY_MANAGER;
    /// @inheritdoc IAttestedWorldID
    uint64 public immutable override FINALITY_DEPTH;
    /// @inheritdoc IAttestedWorldID
    uint32 public immutable override MIN_ATTESTORS;

    /// @inheritdoc IAttestedWorldID
    uint256 public override rootCount;
    /// @inheritdoc IAttestedWorldID
    uint256 public override humansAddedTotal;

    constructor(uint64 sourceChainKey, address identityManager, uint64 finalityDepth, uint32 minAttestors)
        ASCBase()
        WorldIDBridge(TREE_DEPTH)
    {
        SOURCE_CHAIN_KEY = sourceChainKey;
        IDENTITY_MANAGER = identityManager;
        FINALITY_DEPTH = finalityDepth;
        MIN_ATTESTORS = minAttestors;
    }

    // ---------------------------------------------------------------------------------------
    //                                    RELAY ENTRYPOINTS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc IAttestedWorldID
    function executeBatch(
        uint64 chainKey,
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external override {
        uint256 n = blockHeights.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        if (encodedTransactions.length != n || merkleProofs.length != n) revert BatchLengthMismatch();

        for (uint256 i = 1; i < n; ++i) {
            if (blockHeights[i] < blockHeights[i - 1]) revert BatchOutOfOrder();
        }

        bool verified = VERIFIER.verifyAndEmit(
            chainKey, blockHeights, encodedTransactions, merkleProofs, sharedContinuityProof
        );
        if (!verified) revert BatchProofRejected();

        for (uint256 i; i < n; ++i) {
            uint64 txIndex = VERIFIER.calculateTxIndex(merkleProofs[i]);
            bytes32 queryId = _queryId(chainKey, blockHeights[i], txIndex);
            if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);
            processedQueries[queryId] = true;
            _relay(
                Relay({
                    chainKey: chainKey,
                    blockHeight: blockHeights[i],
                    txIndex: txIndex,
                    queryId: queryId
                }),
                encodedTransactions[i]
            );
        }
    }

    /// @dev Reached from `ASCBase.execute` once inclusion, continuity and one-time processing pass.
    ///      `ASCBase` does not forward the chain key, block height or transaction index, and its
    ///      `execute` is neither virtual nor able to carry extra context, so they are recovered
    ///      from this call's own calldata (the frame is still the original `execute` frame).
    function _processAndEmitEvent(uint8, bytes32 queryId, bytes memory encodedTransaction)
        internal
        override
    {
        if (msg.sig != ASCBase.execute.selector) revert UnsupportedEntrypoint(msg.sig);
        (uint64 chainKey, uint64 blockHeight, uint64 txIndex) = _executeContext();
        _relay(
            Relay({chainKey: chainKey, blockHeight: blockHeight, txIndex: txIndex, queryId: queryId}),
            encodedTransaction
        );
    }

    // ---------------------------------------------------------------------------------------
    //                                     SPEC 5.1 PIPELINE
    // ---------------------------------------------------------------------------------------

    /// @dev Per-relay context. Carried as one memory pointer so the pipeline stays well inside
    ///      the legacy code generator's stack budget (this contract does not use via-IR).
    struct Relay {
        uint64 chainKey;
        uint64 blockHeight;
        uint64 txIndex;
        bytes32 queryId;
    }

    /// @dev Everything step 4-6 extracts from one proved source transaction.
    struct TreeUpdate {
        uint256 preRoot;
        uint256 postRoot;
        uint8 kind;
        uint32 humansAdded;
    }

    /// @dev SPEC 5.1 steps 1-9, in order.
    function _relay(Relay memory context, bytes memory encodedTransaction) private {
        // 1. The proof must be for the chain this relay mirrors.
        if (context.chainKey != SOURCE_CHAIN_KEY) {
            revert WrongSourceChain(context.chainKey, SOURCE_CHAIN_KEY);
        }

        // 2-6. Read the tree update out of the proved bytes, checking every claim on the way.
        TreeUpdate memory update = _readTreeUpdate(encodedTransaction);

        // 7-9. Chain the root, clear the finality and quorum guards, then record it.
        _applyTreeUpdate(context.blockHeight, update);

        emit RootRelayed(
            context.queryId,
            context.blockHeight,
            update.postRoot,
            update.preRoot,
            update.kind,
            update.humansAdded,
            context.txIndex,
            msg.sender
        );
    }

    /// @dev SPEC 5.1 steps 2-6.
    function _readTreeUpdate(bytes memory encodedTransaction)
        private
        view
        returns (TreeUpdate memory update)
    {
        // 2. The source transaction must have succeeded.
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTxReverted();

        // 3. It must have called the World ID identity manager.
        bytes memory sourceCalldata = _requireIdentityManagerCall(encodedTransaction);

        // 4 + 5. Exactly one genuine TreeChanged log; decoys from other emitters are skipped.
        _readTreeChange(receipt, update);

        // 6. Calldata must agree with the log, and must be a tree-changing selector.
        update.humansAdded = _crossCheckCalldata(sourceCalldata, update.preRoot, update.postRoot);
    }

    /// @dev Step 3. Returns the source transaction's calldata for the step-6 cross-check.
    function _requireIdentityManagerCall(bytes memory encodedTransaction)
        private
        view
        returns (bytes memory)
    {
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        address callee = common.toIsNull ? address(0) : common.to;
        if (callee != IDENTITY_MANAGER) revert NotIdentityManager(callee);
        return common.data;
    }

    /// @dev SPEC 5.1 steps 7-9.
    function _applyTreeUpdate(uint64 blockHeight, TreeUpdate memory update) private {
        // 7. Root chaining. The first relay bootstraps history and may start anywhere: every root
        //    in the World tree is genuine, so bootstrap only decides where local history begins.
        bool bootstrap = rootCount == 0;
        bool advance;
        if (bootstrap) {
            advance = true;
        } else if (update.preRoot == _latestRoot) {
            advance = true;
        } else if (rootHistory[update.preRoot] != 0) {
            advance = false; // side-fill of a historical gap: record, but do not move the tip
        } else {
            revert UnknownPreRoot(update.preRoot);
        }

        // 8. Finality and quorum, straight from the Creditcoin precompiles.
        {
            uint64 attestedTip = _attestedTip();
            if (attestedTip < blockHeight + FINALITY_DEPTH) revert NotFinal(attestedTip, blockHeight);
            uint32 attestors = _attestorCount();
            if (attestors < MIN_ATTESTORS) revert ThinQuorum(attestors, MIN_ATTESTORS);
        }

        // 9. Record the root(s) through Worldcoin's own bookkeeping.
        uint256 recorded = 1;
        if (bootstrap && update.preRoot != 0 && update.preRoot != update.postRoot) {
            _receiveRoot(update.preRoot);
            recorded = 2;
        }
        if (advance) {
            _receiveRoot(update.postRoot);
        } else {
            uint256 tip = _latestRoot;
            _receiveRoot(update.postRoot);
            _latestRoot = tip;
        }

        rootCount += recorded;
        humansAddedTotal += update.humansAdded;
    }

    /// @dev Step 4 + 5. Keeps only `TreeChanged` logs emitted by the identity manager itself, so a
    ///      decoy event from any other contract in the same transaction is ignored rather than
    ///      fatal. Requires exactly one survivor.
    function _readTreeChange(EvmV1Decoder.ReceiptFields memory receipt, TreeUpdate memory update)
        private
        view
    {
        EvmV1Decoder.LogEntry[] memory candidates =
            EvmV1Decoder.getLogsByEventSignature(receipt, TREE_CHANGED_TOPIC);

        uint256 found;
        uint256 index;
        for (uint256 i; i < candidates.length; ++i) {
            if (candidates[i].address_ == IDENTITY_MANAGER && candidates[i].topics.length == 4) {
                unchecked {
                    ++found;
                }
                index = i;
            }
        }
        if (found == 0) revert NoTreeChange();
        if (found > 1) revert AmbiguousTreeChange(found);

        update.preRoot = uint256(candidates[index].topics[1]);
        update.kind = uint8(uint256(candidates[index].topics[2]));
        update.postRoot = uint256(candidates[index].topics[3]);
    }

    /// @dev Step 6. Word layout after the 4-byte selector:
    ///      registerIdentities(uint256[8] insertionProof, uint256 preRoot, uint32 startIndex,
    ///                         uint256[] identityCommitments, uint256 postRoot)
    ///        w0..w7 proof | w8 preRoot | w9 startIndex | w10 offset(identityCommitments) |
    ///        w11 postRoot | length word at the offset = humansAdded
    ///      deleteIdentities(uint256[8] deletionProof, bytes packedDeletionIndices,
    ///                       uint256 preRoot, uint256 postRoot)
    ///        w0..w7 proof | w8 offset(packedDeletionIndices) | w9 preRoot | w10 postRoot
    function _crossCheckCalldata(bytes memory data, uint256 preRoot, uint256 postRoot)
        private
        pure
        returns (uint32 humansAdded)
    {
        if (data.length < 4) revert CalldataLogMismatch();
        bytes4 selector = bytes4(_word(data, 0));

        uint256 calldataPreRoot;
        uint256 calldataPostRoot;

        if (selector == REGISTER_IDENTITIES) {
            if (data.length < 4 + 12 * 32) revert CalldataLogMismatch();
            calldataPreRoot = uint256(_word(data, 4 + 8 * 32));
            calldataPostRoot = uint256(_word(data, 4 + 11 * 32));

            uint256 tail = uint256(_word(data, 4 + 10 * 32));
            if (tail > type(uint32).max) revert CalldataLogMismatch();
            uint256 lengthWordAt = 4 + tail;
            if (lengthWordAt + 32 > data.length) revert CalldataLogMismatch();
            uint256 count = uint256(_word(data, lengthWordAt));
            if (count > type(uint32).max) revert CalldataLogMismatch();
            humansAdded = uint32(count);
        } else if (selector == DELETE_IDENTITIES) {
            if (data.length < 4 + 11 * 32) revert CalldataLogMismatch();
            calldataPreRoot = uint256(_word(data, 4 + 9 * 32));
            calldataPostRoot = uint256(_word(data, 4 + 10 * 32));
            // A deletion inserts nobody.
        } else {
            revert CalldataLogMismatch();
        }

        if (calldataPreRoot != preRoot || calldataPostRoot != postRoot) revert CalldataLogMismatch();
    }

    // ---------------------------------------------------------------------------------------
    //                                    PRECOMPILE GUARDS
    // ---------------------------------------------------------------------------------------

    /// @notice Highest source-chain height Creditcoin's attestors currently stand behind.
    /// @dev `internal virtual` purely so unit tests can run without the precompiles; the fork
    ///      tests exercise the real `0x0FD3`.
    function _attestedTip() internal view virtual returns (uint64 tip) {
        IChainInfo chainInfo = ChainInfoLib.get();
        HeightHashResult memory attestation = chainInfo.get_latest_attestation_height_and_hash(SOURCE_CHAIN_KEY);
        if (attestation.exists) tip = attestation.height;
        HeightHashResult memory checkpoint = chainInfo.get_latest_checkpoint_height_and_hash(SOURCE_CHAIN_KEY);
        if (checkpoint.exists && checkpoint.height > tip) tip = checkpoint.height;
    }

    /// @notice Bonded attestor count for the source chain.
    /// @dev `internal virtual` for the same reason as `_attestedTip`; fork tests hit `0x0FD4`.
    function _attestorCount() internal view virtual returns (uint32) {
        return AttestorStashLib.get().getAttestorsCount(SOURCE_CHAIN_KEY);
    }

    // ---------------------------------------------------------------------------------------
    //                                          VIEWS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc IAttestedWorldID
    function isValidRoot(uint256 root) public view override returns (bool) {
        if (root == 0) return false;
        if (root == _latestRoot) return true;
        uint128 timestamp = rootHistory[root];
        if (timestamp == 0) return false;
        return block.timestamp - timestamp <= ROOT_HISTORY_EXPIRY;
    }

    /// @inheritdoc IAttestedWorldID
    function latestRoot() public view override(WorldIDBridge, IAttestedWorldID) returns (uint256) {
        return WorldIDBridge.latestRoot();
    }

    /// @notice There is no owner, so the one-week root history expiry can never be changed.
    /// @dev `WorldIDBridge` declares this abstract and expects an owner-gated implementation.
    ///      Humanline has no admin key, so the only honest implementation is a revert.
    function setRootHistoryExpiry(uint256) public pure override {
        revert RootHistoryExpiryImmutable();
    }

    // ---------------------------------------------------------------------------------------
    //                                         INTERNALS
    // ---------------------------------------------------------------------------------------

    /// @dev Recovers `(chainKey, blockHeight, txIndex)` for the in-flight `ASCBase.execute` call.
    ///      Head words after the 4-byte selector of
    ///      `execute(uint8,uint64,uint64,bytes,bytes32,MerkleProofEntry[],bytes32,bytes32[])`:
    ///        w0 action | w1 chainKey | w2 blockHeight | w3 offset(encodedTransaction)
    ///        w4 merkleRoot | w5 offset(siblings) | w6 lowerEndpointDigest | w7 offset(continuityRoots)
    function _executeContext() private view returns (uint64 chainKey, uint64 blockHeight, uint64 txIndex) {
        chainKey = uint64(uint256(_calldataWord(4 + 32)));
        blockHeight = uint64(uint256(_calldataWord(4 + 64)));

        bytes32 merkleRoot = _calldataWord(4 + 128);
        uint256 siblingsAt = 4 + uint256(_calldataWord(4 + 160));
        uint256 n = uint256(_calldataWord(siblingsAt));

        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](n);
        for (uint256 i; i < n; ++i) {
            uint256 at = siblingsAt + 32 + i * 64;
            siblings[i] = INativeQueryVerifier.MerkleProofEntry({
                hash: _calldataWord(at),
                isLeft: uint256(_calldataWord(at + 32)) != 0
            });
        }

        // The precompile stays the single source of truth for the transaction index.
        txIndex = VERIFIER.calculateTxIndex(
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings})
        );
    }

    /// @dev Byte-identical to `ASCBase._computeQueryId`, but taking an already-known `txIndex`.
    function _queryId(uint64 chainKey, uint64 blockHeight, uint256 txIndex)
        private
        pure
        returns (bytes32 queryId)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }

    function _calldataWord(uint256 at) private pure returns (bytes32 word) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            word := calldataload(at)
        }
    }

    function _word(bytes memory data, uint256 at) private pure returns (bytes32 word) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            word := mload(add(add(data, 0x20), at))
        }
    }
}
