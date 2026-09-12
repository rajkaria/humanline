// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {TxBytes} from "./harness/TxBytes.sol";
import {AttestedWorldIDHarness} from "./harness/AttestedWorldIDHarness.sol";
import {MockNativeQueryVerifier, RejectingNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";

import {IAttestedWorldID} from "../src/interfaces/IAttestedWorldID.sol";

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {WorldIDBridge} from "worldid/WorldIDBridge.sol";
import {SemaphoreVerifier} from "worldid/SemaphoreVerifier.sol";

/// @notice Unit tests for the root relay, driven by the two real Attestcoin proof fixtures.
/// @dev The Creditcoin precompiles are native, so they do not exist inside Foundry's EVM:
///      `0x0FD2` is replaced with a storage-free mock whose transaction-index rule is pinned to
///      both real fixtures in `FixtureSanity.t.sol`, and `0x0FD3` / `0x0FD4` are stubbed through
///      the production contract's own `internal virtual` guard hooks.
contract AttestedWorldIDTest is Fixtures {
    uint64 internal constant FINALITY_DEPTH = 32;
    uint32 internal constant MIN_ATTESTORS = 3;
    uint8 internal constant ACTION_ROOT_UPDATE = 0;

    AttestedWorldIDHarness internal relay;
    ProofFixture internal mainnet;

    address internal relayer = address(0xBEEF);

    function setUp() public virtual {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        relay = new AttestedWorldIDHarness(3, MAINNET_IDENTITY_MANAGER, FINALITY_DEPTH, MIN_ATTESTORS);
        mainnet = loadFixture(MAINNET_FIXTURE);
        vm.warp(1_760_000_000);
    }

    // -----------------------------------------------------------------------------------
    //                                    HAPPY PATHS
    // -----------------------------------------------------------------------------------

    function test_RelaysTheRealMainnetRoot() public {
        (uint256 preRoot, uint8 kind, uint256 postRoot) = _treeChangeFromLogs(mainnet.txBytes);
        uint32 humansAdded = _humansAddedFromCalldata(mainnet.txBytes);
        assertEq(humansAdded, 100, "the real tx inserts 100 identity commitments");
        assertEq(kind, 0, "insertion");

        bytes32 expectedQueryId = queryIdOf(mainnet.chainKey, mainnet.headerNumber, mainnet.txIndex);

        vm.expectEmit(true, true, true, true, address(relay));
        emit IAttestedWorldID.RootRelayed(
            expectedQueryId,
            mainnet.headerNumber,
            postRoot,
            preRoot,
            kind,
            humansAdded,
            mainnet.txIndex,
            relayer
        );

        vm.prank(relayer);
        _execute(mainnet);

        assertEq(relay.latestRoot(), postRoot, "latestRoot");
        assertEq(relay.rootCount(), 2, "bootstrap records preRoot and postRoot");
        assertTrue(relay.rootHistory(preRoot) != 0, "preRoot recorded");
        assertEq(relay.rootHistory(postRoot), uint128(block.timestamp), "postRoot timestamped");
        assertEq(relay.humansAddedTotal(), humansAdded, "humansAddedTotal");
        assertTrue(relay.isValidRoot(preRoot), "preRoot valid");
        assertTrue(relay.isValidRoot(postRoot), "postRoot valid");
        assertTrue(relay.processedQueries(expectedQueryId), "query recorded");
    }

    function test_RelaysTheRealSepoliaRoot() public {
        AttestedWorldIDHarness sepoliaRelay =
            new AttestedWorldIDHarness(1, SEPOLIA_IDENTITY_MANAGER, FINALITY_DEPTH, MIN_ATTESTORS);
        ProofFixture memory sepolia = loadFixture(SEPOLIA_FIXTURE);

        (uint256 preRoot, uint8 kind, uint256 postRoot) = _treeChangeFromLogs(sepolia.txBytes);
        uint32 humansAdded = _humansAddedFromCalldata(sepolia.txBytes);

        vm.expectEmit(true, true, true, true, address(sepoliaRelay));
        emit IAttestedWorldID.RootRelayed(
            queryIdOf(sepolia.chainKey, sepolia.headerNumber, sepolia.txIndex),
            sepolia.headerNumber,
            postRoot,
            preRoot,
            kind,
            humansAdded,
            sepolia.txIndex,
            address(this)
        );

        _executeOn(sepoliaRelay, sepolia);
        assertEq(sepoliaRelay.latestRoot(), postRoot, "latestRoot");
        assertEq(sepoliaRelay.humansAddedTotal(), humansAdded, "humansAddedTotal");
    }

    function test_AdvancesTheTipOnAChainedRoot() public {
        (, , uint256 bootRoot) = _bootstrap();
        uint256 nextRoot = uint256(keccak256("next"));

        bytes memory chained = _registerTx(bootRoot, nextRoot, 7, MAINNET_IDENTITY_MANAGER);
        _executeWith(chained, mainnet.headerNumber + 1, 9);

        assertEq(relay.latestRoot(), nextRoot, "tip advanced");
        assertEq(relay.rootCount(), 3, "one more root");
        assertEq(relay.humansAddedTotal(), 107, "100 + 7");
    }

    function test_SideFillRecordsHistoryWithoutMovingTheTip() public {
        (uint256 preRoot, , uint256 bootRoot) = _bootstrap();
        uint256 forgottenRoot = uint256(keccak256("side-fill"));

        // A tx that moved the source tree from the bootstrapped preRoot to some other root: a real
        // historical update we relayed out of order. It belongs in history, but must not rewind us.
        bytes memory sideFill = _registerTx(preRoot, forgottenRoot, 5, MAINNET_IDENTITY_MANAGER);
        _executeWith(sideFill, mainnet.headerNumber + 1, 9);

        assertEq(relay.latestRoot(), bootRoot, "tip unchanged");
        assertTrue(relay.rootHistory(forgottenRoot) != 0, "side-filled root recorded");
        assertTrue(relay.isValidRoot(forgottenRoot), "side-filled root usable");
        assertEq(relay.rootCount(), 3, "counted");
    }

    function test_AcceptsDeleteIdentities() public {
        (, , uint256 bootRoot) = _bootstrap();
        uint256 afterDeletion = uint256(keccak256("after-deletion"));

        bytes memory deletion = TxBytes.withLogs(
            TxBytes.withData(mainnet.txBytes, TxBytes.buildDelete(bootRoot, afterDeletion)),
            _treeChangedLogs(MAINNET_IDENTITY_MANAGER, bootRoot, 1, afterDeletion)
        );

        _executeWith(deletion, mainnet.headerNumber + 1, 9);
        assertEq(relay.latestRoot(), afterDeletion, "deletion advances the tip");
        assertEq(relay.humansAddedTotal(), 100, "a deletion inserts nobody");
    }

    /// @dev Deadswitch's decoy-log finding: another contract in the same transaction emitting the
    ///      same topic must be skipped, not treated as the update and not treated as fatal.
    function test_IgnoresDecoyTreeChangedFromAnotherEmitter() public {
        (uint256 preRoot, uint8 kind, uint256 postRoot) = _treeChangeFromLogs(mainnet.txBytes);

        EvmV1Decoder.LogEntryTuple[] memory decoyed = new EvmV1Decoder.LogEntryTuple[](2);
        decoyed[0] = _treeChangedLog(address(0xDEAD), uint256(keccak256("evil-pre")), 0, uint256(keccak256("evil-post")));
        decoyed[1] = _realTreeChangedLog(mainnet.txBytes);

        vm.expectEmit(true, true, true, true, address(relay));
        emit IAttestedWorldID.RootRelayed(
            queryIdOf(mainnet.chainKey, mainnet.headerNumber, mainnet.txIndex),
            mainnet.headerNumber,
            postRoot,
            preRoot,
            kind,
            _humansAddedFromCalldata(mainnet.txBytes),
            mainnet.txIndex,
            address(this)
        );
        _execute(_withFixtureLogs(decoyed));
        assertEq(relay.latestRoot(), postRoot, "the genuine log won");
    }

    // -----------------------------------------------------------------------------------
    //                              SPEC 5.1 GUARDS, STEP BY STEP
    // -----------------------------------------------------------------------------------

    function test_RevertsOnWrongSourceChain() public {
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.WrongSourceChain.selector, uint64(1), uint64(3)));
        relay.execute(
            ACTION_ROOT_UPDATE,
            1,
            mainnet.headerNumber,
            mainnet.txBytes,
            mainnet.merkleRoot,
            mainnet.siblings,
            mainnet.lowerEndpointDigest,
            mainnet.continuityRoots
        );
    }

    function test_RevertsWhenTheSourceTxReverted() public {
        vm.expectRevert(IAttestedWorldID.SourceTxReverted.selector);
        _execute(TxBytes.withStatus(mainnet.txBytes, 0));
    }

    function test_RevertsWhenTheCalleeIsNotTheIdentityManager() public {
        address impostor = address(0xBAD0);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.NotIdentityManager.selector, impostor));
        _execute(TxBytes.withTo(mainnet.txBytes, impostor));
    }

    function test_RevertsWhenTheTransactionIsAContractCreation() public {
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.NotIdentityManager.selector, address(0)));
        _execute(TxBytes.withToNull(mainnet.txBytes));
    }

    function test_RevertsWhenThereIsNoTreeChange() public {
        EvmV1Decoder.LogEntryTuple[] memory onlyDecoy = new EvmV1Decoder.LogEntryTuple[](1);
        onlyDecoy[0] = _treeChangedLog(address(0xDEAD), 1, 0, 2);
        vm.expectRevert(IAttestedWorldID.NoTreeChange.selector);
        _execute(_withFixtureLogs(onlyDecoy));
    }

    function test_RevertsWhenThereAreNoLogsAtAll() public {
        vm.expectRevert(IAttestedWorldID.NoTreeChange.selector);
        _execute(_withFixtureLogs(new EvmV1Decoder.LogEntryTuple[](0)));
    }

    function test_RevertsOnTwoGenuineTreeChangedLogs() public {
        EvmV1Decoder.LogEntryTuple[] memory doubled = new EvmV1Decoder.LogEntryTuple[](2);
        doubled[0] = _realTreeChangedLog(mainnet.txBytes);
        doubled[1] = _treeChangedLog(MAINNET_IDENTITY_MANAGER, 111, 0, 222);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.AmbiguousTreeChange.selector, uint256(2)));
        _execute(_withFixtureLogs(doubled));
    }

    function test_RevertsOnAnUnknownSelector() public {
        bytes memory foreign = abi.encodePacked(bytes4(0xdeadbeef), new bytes(12 * 32));
        vm.expectRevert(IAttestedWorldID.CalldataLogMismatch.selector);
        _execute(TxBytes.withData(mainnet.txBytes, foreign));
    }

    function test_RevertsOnTruncatedCalldata() public {
        vm.expectRevert(IAttestedWorldID.CalldataLogMismatch.selector);
        _execute(TxBytes.withData(mainnet.txBytes, hex"2217b211"));
    }

    function test_RevertsWhenCalldataRootsDisagreeWithTheLog() public {
        bytes memory lying = TxBytes.retargetRegister(
            _calldataOf(mainnet.txBytes), uint256(keccak256("lie-pre")), uint256(keccak256("lie-post")), 3
        );
        vm.expectRevert(IAttestedWorldID.CalldataLogMismatch.selector);
        _execute(TxBytes.withData(mainnet.txBytes, lying));
    }

    function test_RevertsOnAnUnknownPreRootAfterBootstrap() public {
        _bootstrap();
        uint256 orphanPre = uint256(keccak256("orphan"));
        bytes memory orphan = _registerTx(orphanPre, uint256(keccak256("orphan-post")), 1, MAINNET_IDENTITY_MANAGER);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.UnknownPreRoot.selector, orphanPre));
        _executeWith(orphan, mainnet.headerNumber + 1, 9);
    }

    function test_RevertsWhenTheSourceBlockIsNotFinalYet() public {
        uint64 tip = mainnet.headerNumber + FINALITY_DEPTH - 1;
        relay.setAttestedTip(tip);
        vm.expectRevert(
            abi.encodeWithSelector(IAttestedWorldID.NotFinal.selector, tip, mainnet.headerNumber)
        );
        _execute(mainnet);
    }

    function test_AcceptsExactlyAtTheFinalityDepth() public {
        relay.setAttestedTip(mainnet.headerNumber + FINALITY_DEPTH);
        _execute(mainnet);
        assertEq(relay.rootCount(), 2, "relayed");
    }

    function test_RevertsOnThinAttestorQuorum() public {
        relay.setAttestorCount(2);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.ThinQuorum.selector, uint32(2), MIN_ATTESTORS));
        _execute(mainnet);
    }

    function test_RevertsOnReplayOfTheSameQuery() public {
        _execute(mainnet);
        vm.expectRevert("Query already processed");
        _execute(mainnet);
    }

    /// @dev Even at a different height (a different query id), World's own bookkeeping refuses to
    ///      write a root twice.
    function test_RevertsWhenARootWouldBeOverwritten() public {
        _execute(mainnet);
        vm.expectRevert(WorldIDBridge.CannotOverwriteRoot.selector);
        _executeWith(mainnet.txBytes, mainnet.headerNumber + 1, 9);
    }

    // -----------------------------------------------------------------------------------
    //                                        BATCHING
    // -----------------------------------------------------------------------------------

    function test_BatchRelaysInArrayOrder() public {
        (, , uint256 bootRoot) = _bootstrap();
        uint256 second = uint256(keccak256("batch-2"));
        uint256 third = uint256(keccak256("batch-3"));

        uint64[] memory heights = new uint64[](2);
        heights[0] = mainnet.headerNumber + 1;
        heights[1] = mainnet.headerNumber + 5;

        bytes[] memory txs = new bytes[](2);
        txs[0] = _registerTx(bootRoot, second, 3, MAINNET_IDENTITY_MANAGER);
        txs[1] = _registerTx(second, third, 4, MAINNET_IDENTITY_MANAGER);

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = syntheticMerkleProof(11, 6);
        proofs[1] = syntheticMerkleProof(2, 6);

        vm.expectEmit(true, true, true, true, address(relay));
        emit IAttestedWorldID.RootRelayed(
            queryIdOf(3, heights[0], 11), heights[0], second, bootRoot, 0, 3, 11, address(this)
        );
        vm.expectEmit(true, true, true, true, address(relay));
        emit IAttestedWorldID.RootRelayed(
            queryIdOf(3, heights[1], 2), heights[1], third, second, 0, 4, 2, address(this)
        );

        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));

        assertEq(relay.latestRoot(), third, "tip is the last root in the batch");
        assertEq(relay.rootCount(), 4, "two bootstrap roots plus two batched");
        assertEq(relay.humansAddedTotal(), 107, "100 + 3 + 4");
    }

    function test_BatchRejectsOutOfOrderHeights() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _trivialBatch(2);
        heights[0] = 100;
        heights[1] = 99;
        vm.expectRevert(IAttestedWorldID.BatchOutOfOrder.selector);
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchAllowsRepeatedHeights() public {
        // Two transactions in the same block is normal; only a step backwards is rejected.
        (, , uint256 bootRoot) = _bootstrap();
        uint256 second = uint256(keccak256("same-block-2"));
        uint256 third = uint256(keccak256("same-block-3"));

        uint64[] memory heights = new uint64[](2);
        heights[0] = mainnet.headerNumber + 1;
        heights[1] = mainnet.headerNumber + 1;

        bytes[] memory txs = new bytes[](2);
        txs[0] = _registerTx(bootRoot, second, 1, MAINNET_IDENTITY_MANAGER);
        txs[1] = _registerTx(second, third, 1, MAINNET_IDENTITY_MANAGER);

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = syntheticMerkleProof(4, 6);
        proofs[1] = syntheticMerkleProof(5, 6);

        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
        assertEq(relay.latestRoot(), third, "both applied");
    }

    function test_BatchRejectsMoreThanTen() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _trivialBatch(11);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.BatchTooLarge.selector, uint256(11)));
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchRejectsEmpty() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _trivialBatch(0);
        vm.expectRevert(IAttestedWorldID.EmptyBatch.selector);
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchRejectsMismatchedLengths() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _trivialBatch(2);
        bytes[] memory shortTxs = new bytes[](1);
        shortTxs[0] = txs[0];
        vm.expectRevert(IAttestedWorldID.BatchLengthMismatch.selector);
        relay.executeBatch(3, heights, shortTxs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchRejectsARepeatedQueryInsideOneBatch() public {
        (, , uint256 bootRoot) = _bootstrap();

        uint64[] memory heights = new uint64[](2);
        heights[0] = mainnet.headerNumber + 1;
        heights[1] = mainnet.headerNumber + 1;

        bytes[] memory txs = new bytes[](2);
        txs[0] = _registerTx(bootRoot, uint256(keccak256("dup")), 1, MAINNET_IDENTITY_MANAGER);
        txs[1] = txs[0];

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = syntheticMerkleProof(4, 6);
        proofs[1] = syntheticMerkleProof(4, 6);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAttestedWorldID.QueryAlreadyProcessed.selector, queryIdOf(3, heights[0], 4)
            )
        );
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchRejectsAQueryAlreadyRelayedSingly() public {
        _execute(mainnet);

        uint64[] memory heights = new uint64[](1);
        heights[0] = mainnet.headerNumber;
        bytes[] memory txs = new bytes[](1);
        txs[0] = mainnet.txBytes;
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = merkleProofOf(mainnet);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAttestedWorldID.QueryAlreadyProcessed.selector,
                queryIdOf(mainnet.chainKey, mainnet.headerNumber, mainnet.txIndex)
            )
        );
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_BatchRevertsWhenTheProverRejectsTheProof() public {
        vm.etch(BLOCK_PROVER, address(new RejectingNativeQueryVerifier()).code);
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _trivialBatch(1);
        vm.expectRevert(IAttestedWorldID.BatchProofRejected.selector);
        relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet));
    }

    function test_SingleExecuteRevertsWhenTheProverRejectsTheProof() public {
        vm.etch(BLOCK_PROVER, address(new RejectingNativeQueryVerifier()).code);
        vm.expectRevert("Proof of inclusion verification failed");
        _execute(mainnet);
    }

    // -----------------------------------------------------------------------------------
    //                              ROOT VALIDITY AND SEMAPHORE
    // -----------------------------------------------------------------------------------

    function test_RootsExpireAfterOneWeek() public {
        (uint256 preRoot, , uint256 bootRoot) = _bootstrap();
        uint256 newest = uint256(keccak256("newest"));
        bytes memory chained = _registerTx(bootRoot, newest, 1, MAINNET_IDENTITY_MANAGER);
        _executeWith(chained, mainnet.headerNumber + 1, 9);

        assertTrue(relay.isValidRoot(preRoot), "fresh");
        vm.warp(block.timestamp + 7 days + 1);
        assertFalse(relay.isValidRoot(preRoot), "expired");
        assertFalse(relay.isValidRoot(bootRoot), "expired");
        assertTrue(relay.isValidRoot(newest), "the tip never expires");

        uint256[8] memory proof;
        proof[0] = 1;
        proof[4] = 1;
        vm.expectRevert(WorldIDBridge.ExpiredRoot.selector);
        relay.verifyProof(preRoot, 1, 2, 3, proof);
    }

    function test_IsValidRootIsFalseForUnknownAndZeroRoots() public {
        assertFalse(relay.isValidRoot(0), "zero before any relay");
        _execute(mainnet);
        assertFalse(relay.isValidRoot(0), "zero after a relay");
        assertFalse(relay.isValidRoot(uint256(keccak256("never seen"))), "unknown");
    }

    function test_VerifyProofRejectsAnUnknownRootBeforeTouchingTheVerifier() public {
        _execute(mainnet);
        uint256[8] memory proof;
        vm.expectRevert(WorldIDBridge.NonExistentRoot.selector);
        relay.verifyProof(uint256(keccak256("not a root")), 1, 2, 3, proof);
    }

    function test_VerifyProofRejectsAGarbageProof() public {
        _execute(mainnet);
        uint256 root = relay.latestRoot();
        uint256[8] memory proof;
        for (uint256 i; i < 8; ++i) {
            proof[i] = i + 1;
        }
        vm.expectRevert(SemaphoreVerifier.ProofInvalid.selector);
        relay.verifyProof(root, 1, 2, 3, proof);
    }

    function test_LatestRootRevertsBeforeTheFirstRelay() public {
        vm.expectRevert(WorldIDBridge.NoRootsSeen.selector);
        relay.latestRoot();
    }

    // -----------------------------------------------------------------------------------
    //                                     IMMUTABILITY
    // -----------------------------------------------------------------------------------

    function test_ConfigurationIsImmutableAndPublic() public view {
        assertEq(relay.SOURCE_CHAIN_KEY(), 3, "chain key");
        assertEq(relay.IDENTITY_MANAGER(), MAINNET_IDENTITY_MANAGER, "manager");
        assertEq(relay.FINALITY_DEPTH(), FINALITY_DEPTH, "finality");
        assertEq(relay.MIN_ATTESTORS(), MIN_ATTESTORS, "quorum");
        assertEq(relay.MAX_BATCH(), 10, "batch cap");
        assertEq(relay.getTreeDepth(), 30, "World ID tree depth");
        assertEq(relay.rootHistoryExpiry(), 7 days, "expiry");
        assertEq(address(relay.VERIFIER()), BLOCK_PROVER, "block prover");
    }

    function test_RootHistoryExpiryCannotBeChanged() public {
        vm.expectRevert(IAttestedWorldID.RootHistoryExpiryImmutable.selector);
        relay.setRootHistoryExpiry(1 days);
    }

    function test_TheContractSatisfiesItsInterface() public view {
        IAttestedWorldID iface = IAttestedWorldID(address(relay));
        assertEq(iface.SOURCE_CHAIN_KEY(), 3, "reachable through the interface");
        assertEq(iface.rootCount(), 0, "reachable through the interface");
    }

    // -----------------------------------------------------------------------------------
    //                                        HELPERS
    // -----------------------------------------------------------------------------------

    function _execute(ProofFixture memory f) internal {
        _executeOn(relay, f);
    }

    function _executeOn(AttestedWorldIDHarness target, ProofFixture memory f) internal {
        target.execute(
            ACTION_ROOT_UPDATE,
            f.chainKey,
            f.headerNumber,
            f.txBytes,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );
    }

    /// @dev Relay arbitrary transaction bytes under the real mainnet proof.
    function _execute(bytes memory txBytes) internal {
        _executeWith(txBytes, mainnet.headerNumber, uint8(mainnet.siblings.length));
    }

    function _executeWith(bytes memory txBytes, uint64 height, uint8 depth) internal {
        INativeQueryVerifier.MerkleProof memory proof =
            depth == mainnet.siblings.length ? merkleProofOf(mainnet) : syntheticMerkleProof(height, depth);
        relay.execute(
            ACTION_ROOT_UPDATE,
            3,
            height,
            txBytes,
            proof.root,
            proof.siblings,
            mainnet.lowerEndpointDigest,
            mainnet.continuityRoots
        );
    }

    function _bootstrap() internal returns (uint256 preRoot, uint8 kind, uint256 postRoot) {
        (preRoot, kind, postRoot) = _treeChangeFromLogs(mainnet.txBytes);
        _execute(mainnet);
    }

    function _withFixtureLogs(EvmV1Decoder.LogEntryTuple[] memory logs) internal view returns (bytes memory) {
        return TxBytes.withLogs(mainnet.txBytes, logs);
    }

    /// @dev A `registerIdentities` transaction with matching calldata and log, otherwise identical
    ///      to the real mainnet transaction (same signature chunk, same sender, same gas fields).
    function _registerTx(uint256 preRoot, uint256 postRoot, uint32 humansAdded, address emitter)
        internal
        view
        returns (bytes memory)
    {
        return TxBytes.withLogs(
            TxBytes.withData(
                mainnet.txBytes,
                TxBytes.retargetRegister(_calldataOf(mainnet.txBytes), preRoot, postRoot, humansAdded)
            ),
            _treeChangedLogs(emitter, preRoot, 0, postRoot)
        );
    }

    function _trivialBatch(uint256 n)
        internal
        view
        returns (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs)
    {
        heights = new uint64[](n);
        txs = new bytes[](n);
        proofs = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            heights[i] = uint64(mainnet.headerNumber + i);
            txs[i] = mainnet.txBytes;
            proofs[i] = syntheticMerkleProof(uint64(i), 6);
        }
    }

    function _treeChangedLogs(address emitter, uint256 preRoot, uint8 kind, uint256 postRoot)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple[] memory logs)
    {
        logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = _treeChangedLog(emitter, preRoot, kind, postRoot);
    }

    function _treeChangedLog(address emitter, uint256 preRoot, uint8 kind, uint256 postRoot)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory log)
    {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = TREE_CHANGED_TOPIC;
        topics[1] = bytes32(preRoot);
        topics[2] = bytes32(uint256(kind));
        topics[3] = bytes32(postRoot);
        log = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: ""});
    }

    function _realTreeChangedLog(bytes memory txBytes)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory)
    {
        (,, EvmV1Decoder.LogEntryTuple[] memory logs,) = TxBytes.receipt(txBytes);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == TREE_CHANGED_TOPIC) return logs[i];
        }
        revert("fixture has no TreeChanged log");
    }

    /// @dev Independent derivation of the expected event values: read the log topics straight out
    ///      of the proved receipt with the vendored decoder, never from the contract under test.
    function _treeChangeFromLogs(bytes memory txBytes)
        internal
        pure
        returns (uint256 preRoot, uint8 kind, uint256 postRoot)
    {
        EvmV1Decoder.LogEntryTuple memory log = _realTreeChangedLog(txBytes);
        preRoot = uint256(log.topics[1]);
        kind = uint8(uint256(log.topics[2]));
        postRoot = uint256(log.topics[3]);
    }

    /// @dev Independent derivation of `humansAdded`: a full ABI decode of the real calldata, rather
    ///      than the contract's hand-rolled word reads.
    function _humansAddedFromCalldata(bytes memory txBytes) internal pure returns (uint32) {
        bytes memory data = _calldataOf(txBytes);
        bytes memory args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; ++i) {
            args[i] = data[i + 4];
        }
        (, uint256 preRoot, uint32 startIndex, uint256[] memory commitments, uint256 postRoot) =
            abi.decode(args, (uint256[8], uint256, uint32, uint256[], uint256));
        preRoot;
        startIndex;
        postRoot;
        return uint32(commitments.length);
    }

    function _calldataOf(bytes memory txBytes) internal pure returns (bytes memory data) {
        (,,,,,, data) = TxBytes.common(txBytes);
    }
}
