// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {Fixtures} from "../Fixtures.sol";
import {TxBytes} from "../harness/TxBytes.sol";
import {AttestedWorldIDHarness} from "../harness/AttestedWorldIDHarness.sol";
import {MockNativeQueryVerifier} from "../mocks/MockNativeQueryVerifier.sol";

/// @notice Relays random chained updates, batches, side-fills, replays (across `execute` and
///         `executeBatch`) and roots that chain to nothing, on top of the real mainnet bootstrap.
contract RelayHandler is Fixtures {
    uint8 internal constant DEPTH = 8;

    AttestedWorldIDHarness public relay;
    ProofFixture internal mainnet;

    struct QueryRef {
        uint64 height;
        uint64 txIndex;
    }

    uint256 public tip;
    uint256[] public knownRoots;
    QueryRef[] internal used;
    uint64 public nextHeight;
    uint256 private _nonce;

    uint256 public advances;
    uint256 public batchAdvances;
    uint256 public sideFills;
    uint256 public replaysAttempted;
    uint256 public replaysSucceeded;
    uint256 public orphansAttempted;
    uint256 public orphansSucceeded;

    constructor(AttestedWorldIDHarness relay_) {
        relay = relay_;
        mainnet = loadFixture(MAINNET_FIXTURE);
        relay.setAttestedTip(mainnet.headerNumber + 1_000_000);
        relay.execute(
            0,
            3,
            mainnet.headerNumber,
            mainnet.txBytes,
            mainnet.merkleRoot,
            mainnet.siblings,
            mainnet.lowerEndpointDigest,
            mainnet.continuityRoots
        );
        (,, EvmV1Decoder.LogEntryTuple[] memory logs,) = TxBytes.receipt(mainnet.txBytes);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == TREE_CHANGED_TOPIC) {
                knownRoots.push(uint256(logs[i].topics[1]));
                tip = uint256(logs[i].topics[3]);
                knownRoots.push(tip);
            }
        }
        used.push(QueryRef(mainnet.headerNumber, mainnet.txIndex));
        nextHeight = mainnet.headerNumber + 1;
    }

    // ------------------------------------------------------------------ honest traffic

    function advance(uint256 seed) external {
        uint256 post = _freshRoot();
        uint64 height = nextHeight++;
        uint64 txIndex = uint64(seed % 256);
        if (_execute(_registerTx(tip, post, uint32(seed % 50) + 1), height, txIndex)) {
            tip = post;
            knownRoots.push(post);
            used.push(QueryRef(height, txIndex));
            advances++;
        }
    }

    function advanceBatch(uint256 seed) external {
        uint256 n = seed % 4 + 1;
        uint64[] memory heights = new uint64[](n);
        bytes[] memory txs = new bytes[](n);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](n);
        uint256[] memory posts = new uint256[](n);
        uint256 pre = tip;
        for (uint256 i; i < n; ++i) {
            posts[i] = _freshRoot();
            heights[i] = nextHeight++;
            txs[i] = _registerTx(pre, posts[i], 1);
            proofs[i] = syntheticMerkleProof(uint64(i), DEPTH);
            pre = posts[i];
        }
        try relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet)) {
            for (uint256 i; i < n; ++i) {
                knownRoots.push(posts[i]);
                used.push(QueryRef(heights[i], uint64(i)));
            }
            tip = posts[n - 1];
            batchAdvances++;
        } catch {}
    }

    /// A genuine historical gap: pre is known but is not the tip. Recorded, tip unchanged.
    function sideFill(uint256 which) external {
        if (knownRoots.length < 2) return;
        uint256 pre = knownRoots[which % knownRoots.length];
        if (pre == tip) return;
        uint256 post = _freshRoot();
        uint64 height = nextHeight++;
        if (_execute(_registerTx(pre, post, 1), height, 7)) {
            knownRoots.push(post);
            used.push(QueryRef(height, 7));
            sideFills++;
        }
    }

    // ------------------------------------------------------------------ attacks

    /// Re-send an already-relayed (height, txIndex) carrying a *valid* next root, singly or in a batch.
    function replay(uint256 which, bool viaBatch) external {
        QueryRef memory q = used[which % used.length];
        replaysAttempted++;
        bytes memory txBytes = _registerTx(tip, _freshRoot(), 1);
        bool ok;
        if (viaBatch) {
            uint64[] memory heights = new uint64[](1);
            bytes[] memory txs = new bytes[](1);
            INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
            heights[0] = q.height;
            txs[0] = txBytes;
            proofs[0] = syntheticMerkleProof(q.txIndex, q.height == mainnet.headerNumber ? uint8(mainnet.siblings.length) : DEPTH);
            if (q.height == mainnet.headerNumber) proofs[0] = merkleProofOf(mainnet);
            try relay.executeBatch(3, heights, txs, proofs, continuityProofOf(mainnet)) {
                ok = true;
            } catch {}
        } else if (q.height == mainnet.headerNumber) {
            try relay.execute(0, 3, q.height, txBytes, mainnet.merkleRoot, mainnet.siblings, mainnet.lowerEndpointDigest, mainnet.continuityRoots) {
                ok = true;
            } catch {}
        } else {
            ok = _execute(txBytes, q.height, q.txIndex);
        }
        if (ok) replaysSucceeded++;
    }

    /// A root whose preRoot Creditcoin has never seen.
    function orphan(uint256 seed) external {
        orphansAttempted++;
        uint256 pre = uint256(keccak256(abi.encode("orphan", seed, _nonce++)));
        if (_execute(_registerTx(pre, _freshRoot(), 1), nextHeight++, 3)) orphansSucceeded++;
    }

    function knownRootCount() external view returns (uint256) {
        return knownRoots.length;
    }

    // ------------------------------------------------------------------ helpers

    function _execute(bytes memory txBytes, uint64 height, uint64 txIndex) internal returns (bool) {
        INativeQueryVerifier.MerkleProof memory proof = syntheticMerkleProof(txIndex, DEPTH);
        try relay.execute(0, 3, height, txBytes, proof.root, proof.siblings, mainnet.lowerEndpointDigest, mainnet.continuityRoots) {
            return true;
        } catch {
            return false;
        }
    }

    function _freshRoot() internal returns (uint256) {
        return uint256(keccak256(abi.encode("root", _nonce++)));
    }

    function _registerTx(uint256 preRoot, uint256 postRoot, uint32 humansAdded) internal view returns (bytes memory) {
        (,,,,,, bytes memory data) = TxBytes.common(mainnet.txBytes);
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = TREE_CHANGED_TOPIC;
        topics[1] = bytes32(preRoot);
        topics[3] = bytes32(postRoot);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: MAINNET_IDENTITY_MANAGER, topics: topics, data: ""});
        return TxBytes.withLogs(
            TxBytes.withData(mainnet.txBytes, TxBytes.retargetRegister(data, preRoot, postRoot, humansAdded)), logs
        );
    }
}

/// @notice Roots only ever advance along the chain, and no proved transaction is relayed twice.
contract AttestedWorldIDInvariantTest is Fixtures {
    RelayHandler internal handler;
    AttestedWorldIDHarness internal relay;

    function setUp() public {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        vm.warp(1_760_000_000);
        relay = new AttestedWorldIDHarness(3, MAINNET_IDENTITY_MANAGER, 32, 3, 12);
        handler = new RelayHandler(relay);
        targetContract(address(handler));
    }

    /// The tip is always the last root reached by walking forward from the previous tip.
    function invariant_TipOnlyAdvancesAlongTheChain() public view {
        assertEq(relay.latestRoot(), handler.tip());
    }

    /// No (chainKey, height, txIndex) is ever processed twice, whichever entrypoint is used.
    function invariant_NoReplayAcrossEntrypoints() public view {
        assertEq(handler.replaysSucceeded(), 0);
    }

    /// A root that chains to nothing Creditcoin knows is never adopted.
    function invariant_OrphanRootsAreNeverAdopted() public view {
        assertEq(handler.orphansSucceeded(), 0);
    }

    /// Every recorded root is dated, and the counter matches the history exactly.
    function invariant_RootCountMatchesHistory() public view {
        uint256 n = handler.knownRootCount();
        assertEq(relay.rootCount(), n);
        for (uint256 i; i < n; ++i) {
            assertGt(relay.rootHistory(handler.knownRoots(i)), 0);
        }
    }

    function afterInvariant() public view {
        assertGt(handler.advances() + handler.batchAdvances(), 0, "roots advanced");
        assertGt(handler.replaysAttempted() + handler.orphansAttempted(), 0, "attacks were attempted");
    }
}
