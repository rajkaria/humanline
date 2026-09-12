# Humanline: Attestcoin Protocol Integration

This is the technical write-up of how Humanline uses the Attestcoin Protocol. It is written to be
checked rather than believed: every claim below points at a file and a line range in this
repository, at a transaction on a public explorer, or at a command you can run yourself.

The short version. Humanline mirrors the World ID identity tree from Ethereum onto Creditcoin. The
only way a root enters the mirror is an Attestcoin proof of the real `registerIdentities` or
`deleteIdentities` transaction that produced it, verified by the BlockProver precompile at `0x0FD2`
inside the same Creditcoin transaction that adopts the root. There is no bridge operator, no oracle
signer, no owner, no pause and no upgrade path. Remove Attestcoin and there is no root, therefore no
verified human, therefore no credit line.

Deployed on Creditcoin CC3 testnet (chainId 102031). All six contracts are verified on Blockscout.

| Contract | Address |
|---|---|
| `AttestedWorldID` (Ethereum mainnet, chainKey 3) | [`0x1122ef3fa4ab0693809e42a00b2476efcf4468ad`](https://creditcoin-testnet.blockscout.com/address/0x1122ef3fa4ab0693809e42a00b2476efcf4468ad) |
| `AttestedWorldID` (Ethereum Sepolia, chainKey 1) | [`0x3a7c3cc67034197208923587b8dc5c4674cbcef7`](https://creditcoin-testnet.blockscout.com/address/0x3a7c3cc67034197208923587b8dc5c4674cbcef7) |
| `HumanRegistry` | [`0x62c2fd99ea587e4b466175ad248468782bd5298d`](https://creditcoin-testnet.blockscout.com/address/0x62c2fd99ea587e4b466175ad248468782bd5298d) |
| `CreditLine` | [`0x1bd40163e41e44d2f139d95de88b640f6ea461f7`](https://creditcoin-testnet.blockscout.com/address/0x1bd40163e41e44d2f139d95de88b640f6ea461f7) |
| `hUSD` | [`0x4bd7f4c6648deb8f107932572ce7e85aca259640`](https://creditcoin-testnet.blockscout.com/address/0x4bd7f4c6648deb8f107932572ce7e85aca259640) |
| `HumanGate` (example integration) | [`0xa3e021de49cec8819ea1bd37a8b5a9df005b776c`](https://creditcoin-testnet.blockscout.com/address/0xa3e021de49cec8819ea1bd37a8b5a9df005b776c) |

An earlier deployment of the same six contracts is recorded in `deployments/cc3-testnet.v1.json`.
It was replaced after a code review round (source-block root dating and the pool share math changed,
see `CHANGELOG.md`). It is kept only so the first five rows of the relay evidence log below remain
attributable. Everything current lives at the addresses above, recorded in
`deployments/cc3-testnet.json`.

---

## 1. What Attestcoin proves, and what it does not

Attestcoin's readability layer proves exactly two things about a source-chain transaction:

1. **Inclusion.** The encoded transaction and its receipt are the bytes that sit at a particular
   index of a particular block on a particular source chain, checked against a Merkle root.
2. **Continuity.** That block belongs to the chain the Creditcoin attestor set has attested to,
   reached from an attested endpoint through a chain of block digests.

That is the whole guarantee, and it is deliberately narrow. `verifyAndEmit` returning `true` means
"these bytes really happened on that chain". It does not mean the transaction succeeded, that it was
sent to the contract you care about, that the event you are reading came from that contract, that
the root it carries is the next one in sequence, that the source block is deep enough to be
irreversible, or that a healthy number of attestors stood behind it.

Everything in that second list is Humanline's responsibility, and every item of it is implemented in
`contracts/src/AttestedWorldID.sol`:

| Not proven by Attestcoin | Humanline's check | Reverts with |
|---|---|---|
| The source transaction succeeded | receipt status must be 1 | `SourceTxReverted()` |
| It went to the World ID identity manager | decoded `to` must equal `IDENTITY_MANAGER` | `NotIdentityManager(to)` |
| The `TreeChanged` event came from that manager | logs filtered by emitter, exactly one survivor required | `NoTreeChange()`, `AmbiguousTreeChange(count)` |
| The calldata agrees with the event | selector and both root words cross-checked against the log topics | `CalldataLogMismatch()` |
| The root is the next one in sequence | `preRoot` must be `latestRoot` or a known historical root | `UnknownPreRoot(preRoot)` |
| The source block is final | ChainInfo `0x0FD3` attested tip must be `FINALITY_DEPTH` above it | `NotFinal(attestedTip, sourceBlock)` |
| A real attestor set backed it | AttestorStash `0x0FD4` bonded count must be at least `MIN_ATTESTORS` | `ThinQuorum(have, want)` |
| It was not relayed before | `queryId` from `calculateTxIndex`, recorded once | `QueryAlreadyProcessed(queryId)`, or `ASCBase`'s `"Query already processed"` |
| The root is fresh | the root is dated by its source block, not by arrival | `ExpiredRoot()` on use |

Attestcoin also cannot prove a negative. It cannot prove that a payment did **not** happen, so
Humanline never asks it to: a default is declared from a passed deadline plus the absence of a
repayment in Creditcoin's own state, which is native and directly readable. See section 8.

---

## 2. Every Attestcoin surface Humanline uses

Ten distinct surfaces, each one load-bearing. This section is the depth checklist from
`docs/SPEC.md` section 8, with the code.

### 2.1 `verifyAndEmit` through `ASCBase.execute`: the only door

`AttestedWorldID` inherits `ASCBase` from `@gluwa/asc-contracts`. `execute` computes the query id,
refuses a repeat, calls the BlockProver precompile, and only then hands control to the application.
There is no other entry point into root adoption: no admin setter, no relayer allowlist, no
fallback, no degraded mode.

`contracts/node_modules/@gluwa/asc-contracts/contracts/readability/ASCBase.sol:45-65`

```solidity
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);

        require(!processedQueries[queryId], "Query already processed");

        bool verified = _verifyProof(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleRoot,
            siblings,
            lowerEndpointDigest,
            continuityRoots
        );
        require(verified, "Proof of inclusion verification failed");

        processedQueries[queryId] = true;

        _processAndEmitEvent(action, queryId, encodedTransaction);

        return true;
    }
```

The precompile call itself is one level down, at
`contracts/node_modules/@gluwa/asc-contracts/contracts/readability/ASCBase.sol:85-91`:

```solidity
        verified = VERIFIER.verifyAndEmit(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleProof,
            continuityProof
        );
```

`VERIFIER` is fixed at construction to `0x0000000000000000000000000000000000000FD2` through
`NativeQueryVerifierLib.getVerifier()`. It is `immutable`, so it cannot be repointed after
deployment.

Humanline's half of the contract begins where `ASCBase` ends. `_processAndEmitEvent` is the hook,
and the first thing it does is refuse to run from anywhere except a genuine `execute` frame, because
it recovers the chain key, block height and transaction index by reading that frame's own calldata
(`ASCBase.execute` is `external` and non-virtual and forwards none of them).

`contracts/src/AttestedWorldID.sol:122-132`

```solidity
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
```

**Why it is load-bearing.** `_relay` is the only function that can write a root, and the only two
callers of `_relay` are this hook and `executeBatch`. Both are downstream of a `verifyAndEmit` that
returned `true`. A root that was not proven cannot exist in this contract.

### 2.2 The batch `verifyAndEmit` overload, through `executeBatch`

The precompile exposes a second `verifyAndEmit` that takes parallel arrays of heights, transactions
and Merkle proofs plus **one shared continuity proof**:

`contracts/node_modules/@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol:37-43`

```solidity
    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external returns (bool);
```

`ASCBase` does not use that overload, so `AttestedWorldID` adds `executeBatch`, which enforces the
protocol's batch limits, verifies the whole batch in one precompile call, and then deduplicates and
relays each member individually.

`contracts/src/AttestedWorldID.sol:87-105`

```solidity
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
```

**Why it is load-bearing.** World's sequencer updates the identity tree roughly hourly, and a day of
Sepolia staging activity is on the order of thirty transactions. Relaying those one at a time means
one continuity proof each. `MAX_BATCH` is 10 and the worker groups consecutive transactions inside a
1,000-block window, so a live dry run of 24 hours of Sepolia activity collapsed 29 transactions into
7 submissions (section 5). The batch path shares `processedQueries` with the single path: query ids
are computed by identical assembly in `_queryId`, and
`AttestedWorldID.t.sol :: test_BatchRejectsAQueryAlreadyRelayedSingly` pins that the two paths agree.

The batch path is live, not theoretical. Creditcoin transaction
[`0xe764d3be…0315dd`](https://creditcoin-testnet.blockscout.com/tx/0xe764d3be2bfa002d1f7db2e348daf5be410acc016ef6c4d7ebd797a5380315dd)
relayed two Ethereum mainnet roots under one continuity proof.

### 2.3 `calculateTxIndex`: the replay key and the ordering evidence

Attestcoin derives a transaction's index inside its source block from the `isLeft` flags of the
Merkle path. Humanline never re-derives it in Solidity; it asks the precompile, so the precompile
stays the single source of truth. The index then becomes both half of the replay key and the
`sourceTxIndex` field of the public `RootRelayed` event.

`contracts/src/AttestedWorldID.sol:428-448`

```solidity
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
```

**Why it is load-bearing.** The query id is what makes a relayed root idempotent. Anyone may relay,
which means two relayers racing on the same root is the normal case, not the exception. The loser's
transaction reverts instead of double-counting `humansAddedTotal` or re-timestamping a root. The
worker reproduces the same 72-byte preimage off chain (`worker/src/cc3.ts`, `computeQueryId` and
`computeTxIndex`) so it can check `processedQueries[queryId]` with a single `eth_call` **before**
paying a prover round trip. Both are pinned against the two real proof fixtures, whose true indices
are 173 and 58, in `worker/test/cc3.test.ts` and `contracts/test/FixtureSanity.t.sol`, and
cross-checked against the live precompile in
`AttestedWorldID.fork.t.sol :: testFork_BlockProverVerifiesTheMainnetFixture`.

### 2.4 `EvmV1Decoder` calldata decoding: `registerIdentities` and `deleteIdentities`

`EvmV1Decoder.decodeCommonTxFields(tx).data` yields the source transaction's calldata. Humanline
decodes it by hand, at fixed word offsets, because the event alone is not enough: the event carries
the roots but not the number of identity commitments, and an independent read of the calldata is
what makes the event impossible to reinterpret.

The word layout after the four-byte selector, documented at
`contracts/src/AttestedWorldID.sol:312-319`:

- `registerIdentities(uint256[8] insertionProof, uint256 preRoot, uint32 startIndex, uint256[] identityCommitments, uint256 postRoot)`:
  words 0 to 7 are the proof, word 8 is `preRoot`, word 9 is `startIndex`, word 10 is the offset of
  `identityCommitments`, word 11 is `postRoot`, and the length word at that offset is `humansAdded`.
- `deleteIdentities(uint256[8] deletionProof, bytes packedDeletionIndices, uint256 preRoot, uint256 postRoot)`:
  words 0 to 7 are the proof, word 8 is the offset of `packedDeletionIndices`, word 9 is `preRoot`,
  word 10 is `postRoot`.

`contracts/src/AttestedWorldID.sol:331-353`

```solidity
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
```

**Why it is load-bearing.** Two reasons. First, `humansAdded` is a number nobody reports to us: it
is the length of the commitment array in the calldata of a transaction proved by Attestcoin, so the
"humans in the tree" counter on the site is derived from Ethereum's own bytes and not from a
database. Second, requiring the calldata and the log to agree closes the gap where a genuine proof
of a genuine transaction gets reinterpreted. Every bound is checked explicitly rather than left to
an arithmetic panic: an out-of-range offset or a length above `uint32` is `CalldataLogMismatch`, not
a revert without a name. The tests derive the expected values independently, taking the roots from
`EvmV1Decoder` and `humansAdded` from a full `abi.decode` of the real calldata, so a bug in the word
arithmetic would show up as a disagreement rather than agreeing with itself.

Selectors: `registerIdentities` is `0x2217b211`, `deleteIdentities` is `0xea10fbbe`
(`contracts/src/AttestedWorldID.sol:30-34`).

### 2.5 `EvmV1Decoder` log decoding: `TreeChanged`

`EvmV1Decoder.decodeReceiptFields(tx)` yields the receipt, including its logs, and
`getLogsByEventSignature` filters them by `topic0`. Humanline then filters again by emitter, because
`topic0` alone says nothing about who emitted the event.

`contracts/src/AttestedWorldID.sol:287-310`

```solidity
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
```

`TREE_CHANGED_TOPIC` is `0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04`,
which is `keccak256("TreeChanged(uint256,uint8,uint256)")`.

**Why it is load-bearing.** This is where the root itself comes from. The design decision worth
naming is that a decoy `TreeChanged` emitted by an unrelated contract in the same transaction is
**skipped, not fatal**. Treating a foreign log as fatal would let anyone grief the relay forever by
emitting one look-alike event in any transaction that also touches the identity manager. Two genuine
logs from the manager itself is a different matter and reverts, because then the root to adopt is
genuinely ambiguous. We adopted the skip-not-revert rule after another submission in this hackathon,
Deadswitch, published the decoy-log finding against the common `ASCBase` integration pattern.
Covered by `AttestedWorldID.t.sol :: test_IgnoresDecoyTreeChangedFromAnotherEmitter` and
`:: test_RevertsOnTwoGenuineTreeChangedLogs`.

### 2.6 Emitter, status and callee binding

Three separate bindings, in the order they run.

`contracts/src/AttestedWorldID.sol:186-210`

```solidity
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
```

**Why it is load-bearing.** Attestcoin will happily prove a transaction that reverted, a transaction
sent to a contract an attacker deployed this morning, or a contract-creation transaction with no
callee at all. All three are genuine source-chain history. Binding `receiptStatus == 1` stops a
reverted `registerIdentities` from advancing the tree; binding `to == IDENTITY_MANAGER` stops a
look-alike manager; `toIsNull` is handled explicitly so a contract creation resolves to the zero
address and fails the same check rather than reading a stale word. Combined with the emitter filter
in 2.5, the log, the callee and the selector must all name the same World ID contract before a root
is looked at.

### 2.7 Root chaining: `preRoot` must already be known

Inclusion and continuity say a root is real. They say nothing about whether it is the **next** one.

`contracts/src/AttestedWorldID.sol:213-226`

```solidity
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
```

**Why it is load-bearing.** This is the rule that turns a set of proven roots into a chain. A
relayer cannot skip ahead to a favorable root and cannot replay an old one as if it were current. A
historical gap can still be side-filled, because the root's `preRoot` is already in history, but a
side-fill deliberately does not move `latestRoot`: the tip is saved and restored around the write
(`contracts/src/AttestedWorldID.sol:243-249`) so history gains a root without the tree appearing to
rewind. Bootstrap is the one unchained case, and it is permissionless on purpose: every root in the
World tree is genuine, so the first relayer only decides where local history begins, not what is
true. Covered by `test_RevertsOnAnUnknownPreRootAfterBootstrap`,
`test_AdvancesTheTipOnAChainedRoot` and `test_SideFillRecordsHistoryWithoutMovingTheTip`.

### 2.8 ChainInfo `0x0FD3`: the finality guard

The exact getter, confirmed against `precompiles/metadata/sol/chain_info.sol` in `gluwa/creditcoin3`
and exercised against the live node, is
**`get_latest_attestation_height_and_hash(uint64)`, selector `0x809112da`**, returning
`HeightHashResult { uint64 height; bytes32 hash; bool isAttestation; bool exists; }`.

`contracts/src/interfaces/IChainInfo.sol:33-55`

```solidity
/// @title IChainInfo
/// @notice Minimal, independently written interface for the Creditcoin ChainInfo precompile at
///         `0x0000000000000000000000000000000000000fD3`. Only the getters Humanline needs are
///         declared; the full precompile exposes more.
/// @dev Selectors confirmed against `precompiles/metadata/sol/chain_info.sol` in gluwa/creditcoin3:
///        get_supported_chains()                             -> 0x69e18c3c
///        get_chain_by_key(uint64)                           -> 0x2d256bfa
///        get_latest_attestation_height_and_hash(uint64)     -> 0x809112da
///        get_latest_checkpoint_height_and_hash(uint64)      -> 0xd773a786
///        is_height_attested(uint64,uint64)                  -> 0x9c68eccf
interface IChainInfo {
    /// @notice Every chain the attestation set currently tracks.
    function get_supported_chains() external view returns (ChainInfo[] memory chains);

    /// @notice Look up a single tracked chain by its Creditcoin chain key.
    function get_chain_by_key(uint64 chainKey) external view returns (ChainInfoResult memory result);

    /// @notice Highest source-chain height the attestors have attested to.
    /// @dev This is the "attested tip" Humanline's finality guard reads.
    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);
```

Humanline reads the attestation tip **and** the checkpoint tip and takes the larger of the two, so a
chain that Creditcoin currently checkpoints but does not attest does not brick the relay
(`contracts/src/AttestedWorldID.sol:362-368`). The guard itself is two lines, at
`contracts/src/AttestedWorldID.sol:229-230`:

```solidity
        uint64 attestedTip = _attestedTip();
        if (attestedTip < blockHeight + FINALITY_DEPTH) revert NotFinal(attestedTip, blockHeight);
```

**Why it is load-bearing.** `FINALITY_DEPTH` is an immutable 32 on both source chains. Without it,
Humanline would accept a root from a block that Ethereum can still reorg away, and a reorged-away
root would be permanently adopted because there is no owner to remove it. With it, a root is only
adopted once the Creditcoin attestor set stands at least 32 blocks above the block that produced it.
`testFork_ChainInfoReportsTheSourceChains` reads the real precompile and reports chainKey 3 as
chainId 1 "Ethereum" and chainKey 1 as chainId 11155111 "Sepolia ethereum", with a mainnet
attestation tip of 25,960,280 against a checkpoint tip of 25,960,100 at the time of that run.
Negative path: `AttestedWorldID.t.sol :: test_RevertsWhenTheSourceBlockIsNotFinalYet`, with the exact
boundary pinned by `test_AcceptsExactlyAtTheFinalityDepth`.

### 2.9 AttestorStash `0x0FD4`: the quorum guard

`contracts/src/interfaces/IAttestorStash.sol:4-22`

```solidity
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
```

The guard, at `contracts/src/AttestedWorldID.sol:231-234`:

```solidity
        {
            uint32 attestors = _attestorCount();
            if (attestors < MIN_ATTESTORS) revert ThinQuorum(attestors, MIN_ATTESTORS);
        }
```

**Why it is load-bearing.** Humanline's deepest trust assumption is the attestor set, so the
contract refuses to accept a root when that set is thin enough to be cheap to capture.
`MIN_ATTESTORS` is an immutable 3. `testFork_AttestorStashReportsBondedAttestors` reads the live
precompile: 4 bonded attestors for mainnet (chainKey 3) and 7 for Sepolia (chainKey 1), both above
the floor. Negative path: `AttestedWorldID.t.sol :: test_RevertsOnThinAttestorQuorum`. This guard
does not make Humanline stronger than Attestcoin. It makes Humanline stop rather than degrade when
Attestcoin is weaker than expected.

### 2.10 Proof-dated root timestamps: `SOURCE_BLOCK_TIME`

World's `WorldIDBridge` expires a root from history one week after it was received. Its vendored
`_receiveRoot` stamps `block.timestamp`, which is the moment of relay. That is wrong for a
permissionless relay: relaying is open to anyone, and a side-fill only requires that `preRoot` is
already in history, so anyone could introduce a year-old genuine World root and hand it a fresh week
of validity. Humanline dates a root by its **source block**, using the attested tip it already read
for the finality guard.

`contracts/src/AttestedWorldID.sol:255-270`

```solidity
    /// @dev How old a root is, in Creditcoin time, derived from how far the source block sits below
    ///      the attested tip: `now - (attestedTip - sourceBlock) * SOURCE_BLOCK_TIME`.
    ///
    ///      Relaying is permissionless and a side-fill only needs `rootHistory[preRoot] != 0`, so
    ///      without this anyone could introduce a year-old genuine World root and hand it a fresh
    ///      week of validity. The one-week expiry exists to bound how long a stale root may prove
    ///      an identity that has since been deleted from the tree; dating roots by their source
    ///      block is what makes that bound mean anything. A root older than the expiry therefore
    ///      arrives already expired. `latestRoot` stays unconditionally valid, per World's own
    ///      semantics in `WorldIDBridge.requireValidRoot`.
    ///
    ///      Floored at 1: zero is `NULL_ROOT_TIME`, which would read back as "never seen".
    function _receivedAt(uint64 attestedTip, uint64 sourceBlock) internal view returns (uint128) {
        uint256 age = uint256(attestedTip - sourceBlock) * SOURCE_BLOCK_TIME;
        return block.timestamp > age ? uint128(block.timestamp - age) : uint128(1);
    }
```

**Why it is load-bearing.** The expiry exists to bound how long a stale root can prove membership for
an identity that has since been deleted from the tree. Dating roots by arrival time would make that
bound meaningless under a permissionless relay. `SOURCE_BLOCK_TIME` is an immutable constructor
argument, 12 seconds for both Ethereum chains, recorded in `deployments/cc3-testnet.json`. Because
the value comes from the Attestcoin attested tip rather than from the relayer, the relayer cannot
influence it. Covered by `test_AnAncientSideFilledRootArrivesAlreadyExpired`,
`test_AFreshRootArrivesValid`, `test_AnAncientRootIsStillValidWhenItIsTheTip` and
`test_TheDerivedTimestampFloorsAtOne`.

### 2.11 Two source chains: chainKey 3 and chainKey 1

Two `AttestedWorldID` instances are deployed from identical bytecode with different immutables. The
worker holds the matching definitions.

`worker/src/config.ts:69-92`

```ts
export const SOURCES: Record<SourceName, SourceConfig> = {
  mainnet: {
    name: "mainnet",
    chainKey: 3,
    manager: "0xf7134CE138832c1456F2a91D64621eE90c2bddEa",
    rpcEnv: "ETH_MAINNET_RPC",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
    fallbackRpcs: ["https://mainnet.gateway.tenderly.co", "https://gateway.tenderly.co/public/mainnet"],
    deploymentKey: "AttestedWorldIDMainnet",
    finalityDepth: 32,
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  sepolia: {
    name: "sepolia",
    chainKey: 1,
    manager: "0xb2ead588f14e69266d1b87936b75325181377076",
    rpcEnv: "ETH_SEPOLIA_RPC",
    defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    fallbackRpcs: ["https://sepolia.gateway.tenderly.co"],
    deploymentKey: "AttestedWorldIDSepolia",
    finalityDepth: 32,
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
  },
};
```

The contracts are constructed with those same values at
`contracts/script/deploy-cc3.sh:41-47` and `:92-95`.

**Why it is load-bearing.** chainKey 3 carries production Orb roots, which is what makes the mainnet
counter on the site a real number of real Orb-verified humans. chainKey 1 carries World's Sepolia
staging tree, which is what lets a judge reproduce personhood verification end to end with the World
ID Simulator instead of an Orb. Both instances run identical code, so the reproducible path and the
production path are the same path. The first check in `_relay` is
`chainKey != SOURCE_CHAIN_KEY -> WrongSourceChain`, so a Sepolia proof submitted to the mainnet
instance is rejected even though it is a perfectly valid Attestcoin proof
(`AttestedWorldID.t.sol :: test_RevertsOnWrongSourceChain`).

### 2.12 The Semaphore verifier sitting on top of Attestcoin-anchored roots

`AttestedWorldID` is an `IWorldID`. Once a root is in `rootHistory`, World's own vendored
`WorldIDBridge.verifyProof` runs a Groth16 check over the vendored `SemaphoreVerifier` on
Creditcoin's bn128 precompiles at `0x06`, `0x07` and `0x08`. `HumanRegistry` is the consumer.

`contracts/src/HumanRegistry.sol:52-68`

```solidity
    function register(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) external override {
        if (nullifierHash == 0) revert ZeroNullifier();

        uint256 boundHuman = humanOf[msg.sender];
        if (boundHuman != 0 && boundHuman != nullifierHash) {
            revert WalletAlreadyHuman(msg.sender, boundHuman);
        }

        address boundWallet = walletOf[nullifierHash];
        if (boundWallet == msg.sender) revert SameWallet();

        IWorldID(WORLD_ID).verifyProof(
            root, abi.encodePacked(msg.sender).hashToField(), nullifierHash, EXTERNAL_NULLIFIER_HASH, proof
        );

        walletOf[nullifierHash] = msg.sender;
        humanOf[msg.sender] = nullifierHash;
```

**Why it is load-bearing.** This is the payoff, and the dependency runs one way. The zero-knowledge
proof is a membership proof against a root. If that root did not arrive through Attestcoin, there is
nothing to prove membership in: `verifyProof` reverts `NonExistentRoot` before the verifier is
touched. The signal is `msg.sender`, so a proof lifted from the mempool verifies for nobody else,
and `EXTERNAL_NULLIFIER_HASH` is fixed at construction from the app id and the action
`humanline-register`, so a proof issued for another application does not verify here. The bn128
precompiles are checked as a known-answer test against the live node in
`testFork_Bn128PrecompilesAnswerCorrectly`: an empty pairing product returns 1, and `0x06` and
`0x07` on the point at infinity return 64 zero bytes.

---

## 3. Live evidence

Every row below is a real World ID tree update on Ethereum, relayed to Creditcoin through an
Attestcoin proof verified by `0x0FD2` inside the Creditcoin transaction linked in the same row. The
source of truth is `evidence/relay-log.jsonl`, which the relay appends to and the GitHub Actions
workflow commits. The relay is running, so the live file may be longer than this snapshot.

Snapshot taken 2026-09-12T13:55Z. Rows 1 to 5 landed on the v1 deployment; rows 6 onward landed on
the current contracts. **Rows 13 to 18 were relayed by the GitHub Actions cron**
([`.github/workflows/relay.yml`](../.github/workflows/relay.yml), every 15 minutes), not from a
laptop — the workflow derives its cursor from chain state, relays, and commits the new rows back to
`main`, so this file's git history is also the relayer's uptime record.

| # | Source | Ethereum tx | Block | Creditcoin tx | Call | Gas | Humans | Lag |
|---|---|---|---|---|---|---|---|---|
| 1 | mainnet | [`0x81ece311…dc7e3`](https://etherscan.io/tx/0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3) | 25,959,565 | [`0x4886d2c4…6e904`](https://creditcoin-testnet.blockscout.com/tx/0x4886d2c4a884b9b70ecadad9de75940c248e68dc8bb722a116c729a65ef6e904) | `execute` (bootstrap) | 289,002 | +100 | 7,504 s |
| 2 | sepolia | [`0x36678603…58bb7`](https://sepolia.etherscan.io/tx/0x366786038986b2f9e70e1fc1b2be3a419b7a4a3ef36732ed48bcd4083d058bb7) | 11,687,163 | [`0xbdbe3cbc…6f6a3`](https://creditcoin-testnet.blockscout.com/tx/0xbdbe3cbc325e0c8e8d7f558a7770e58f22b576375d718b4c64eff1f46806f6a3) | `execute` (bootstrap) | 295,213 | +100 | 7,878 s |
| 3 | mainnet | [`0xf321a814…728c2`](https://etherscan.io/tx/0xf321a814442cef61e60ada9e64a7c1fa388c787321af615a5e9f08cae3f728c2) | 25,959,864 | [`0xfb33a81a…13b56`](https://creditcoin-testnet.blockscout.com/tx/0xfb33a81affddeb20dff94fe684506b901729e2b91e60b51bfc553de46a013b56) | `execute` | 287,378 | +100 | 4,594 s |
| 4 | sepolia | [`0x2db89d92…d8364`](https://sepolia.etherscan.io/tx/0x2db89d92bd775b1b718665b3f1f48be87c057dca46ca04a1516f0fefa16d8364) | 11,687,459 | [`0x9b317c8f…3d479`](https://creditcoin-testnet.blockscout.com/tx/0x9b317c8f9e08a44a661a5ec6df14640536668b58e891abda68f1f2924493d479) | `executeBatch` (2) | 494,648 | +100 | 4,968 s |
| 5 | sepolia | [`0x626e57ae…e4e54`](https://sepolia.etherscan.io/tx/0x626e57ae17a7d590a1968b638848326d980ce5fff5ddd0ff20651cd68cae4e54) | 11,687,747 | [`0x9b317c8f…3d479`](https://creditcoin-testnet.blockscout.com/tx/0x9b317c8f9e08a44a661a5ec6df14640536668b58e891abda68f1f2924493d479) | `executeBatch` (2) | 494,648 | +100 | 1,368 s |
| 6 | mainnet | [`0x81ece311…dc7e3`](https://etherscan.io/tx/0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3) | 25,959,565 | [`0x64aab38f…0dc58`](https://creditcoin-testnet.blockscout.com/tx/0x64aab38f8a5218db9a4cc9d5da6b92eb341fd8896826e2cb100cd76bc010dc58) | `execute` (bootstrap) | 291,970 | +100 | 9,409 s |
| 7 | sepolia | [`0x36678603…58bb7`](https://sepolia.etherscan.io/tx/0x366786038986b2f9e70e1fc1b2be3a419b7a4a3ef36732ed48bcd4083d058bb7) | 11,687,163 | [`0x39281065…00f7a`](https://creditcoin-testnet.blockscout.com/tx/0x392810655bd35d4e824e0dc6b9eae24b9906b1e4ff4e7dbb607b63985da00f7a) | `execute` (bootstrap) | 295,498 | +100 | 9,783 s |
| 8 | mainnet | [`0xf321a814…728c2`](https://etherscan.io/tx/0xf321a814442cef61e60ada9e64a7c1fa388c787321af615a5e9f08cae3f728c2) | 25,959,864 | [`0xe764d3be…315dd`](https://creditcoin-testnet.blockscout.com/tx/0xe764d3be2bfa002d1f7db2e348daf5be410acc016ef6c4d7ebd797a5380315dd) | `executeBatch` (2) | 569,744 | +100 | 6,199 s |
| 9 | mainnet | [`0xbb4dff87…c1924`](https://etherscan.io/tx/0xbb4dff87690a536c822b9e5e456d0f5b05520aba4f96f794b9bd65c61e8c1924) | 25,960,305 | [`0xe764d3be…315dd`](https://creditcoin-testnet.blockscout.com/tx/0xe764d3be2bfa002d1f7db2e348daf5be410acc016ef6c4d7ebd797a5380315dd) | `executeBatch` (2) | 569,744 | +100 | 895 s |
| 10 | sepolia | [`0x2db89d92…d8364`](https://sepolia.etherscan.io/tx/0x2db89d92bd775b1b718665b3f1f48be87c057dca46ca04a1516f0fefa16d8364) | 11,687,459 | [`0x2087b417…c7896`](https://creditcoin-testnet.blockscout.com/tx/0x2087b417224ca6b3831d8f16512a7773a0776915d8d854b62b79f888255c7896) | `executeBatch` (2) | 520,016 | +100 | 6,573 s |
| 11 | sepolia | [`0x626e57ae…e4e54`](https://sepolia.etherscan.io/tx/0x626e57ae17a7d590a1968b638848326d980ce5fff5ddd0ff20651cd68cae4e54) | 11,687,747 | [`0x2087b417…c7896`](https://creditcoin-testnet.blockscout.com/tx/0x2087b417224ca6b3831d8f16512a7773a0776915d8d854b62b79f888255c7896) | `executeBatch` (2) | 520,016 | +100 | 2,973 s |
| 12 | sepolia | [`0xf1d56e7d…b9304`](https://sepolia.etherscan.io/tx/0xf1d56e7d65d30c9fb53e59a7998bd38efa13fe4b5d562390f40cd39eafab9304) | 11,688,043 | [`0x42c23626…8e0cb`](https://creditcoin-testnet.blockscout.com/tx/0x42c2362661c27fd6f0e171c4654726d93b6674ca281627436c9c6ebbd4c8e0cb) | `execute` | 275,562 | +100 | 924 s |
| 13 | mainnet | [`0x829c21ab…12d35`](https://etherscan.io/tx/0x829c21abce07a88969f76ab4570e586154ffa3d07e9874a6b1b5a4198fc12d35) | 25,960,630 | [`0x52514bce…86557`](https://creditcoin-testnet.blockscout.com/tx/0x52514bce2114bf51f87307efbde352cf242995bc677fba7bd16f4ff6e6086557) | `executeBatch` (3) | 791,161 | +100 | 10,015 s |
| 14 | mainnet | [`0x2af1910e…3c117`](https://etherscan.io/tx/0x2af1910e21ba3b243cb2e2ae7390d63bbe25f582a3c1100a01a9ec11e4d3c117) | 25,960,932 | [`0x52514bce…86557`](https://creditcoin-testnet.blockscout.com/tx/0x52514bce2114bf51f87307efbde352cf242995bc677fba7bd16f4ff6e6086557) | `executeBatch` (3) | 791,161 | +100 | 6,391 s |
| 15 | mainnet | [`0x40fe7c89…da6ff`](https://etherscan.io/tx/0x40fe7c89155bc0ee7db494c122cba4bb986fffaa1fdd87685a3e0353d27da6ff) | 25,961,231 | [`0x52514bce…86557`](https://creditcoin-testnet.blockscout.com/tx/0x52514bce2114bf51f87307efbde352cf242995bc677fba7bd16f4ff6e6086557) | `executeBatch` (3) | 791,161 | +100 | 2,791 s |
| 16 | sepolia | [`0x76d12857…76aa3`](https://sepolia.etherscan.io/tx/0x76d12857cd4f1baa2ab0b63629654200e451b6b8efd584b34f69280dd3176aa3) | 11,688,338 | [`0x20ac99ef…99d1c`](https://creditcoin-testnet.blockscout.com/tx/0x20ac99ef1bff1a568bc3e9bd8e74e0b97b166ac5caf45b261f288119d1399d1c) | `executeBatch` (3) | 773,365 | +100 | 8,709 s |
| 17 | sepolia | [`0x3858925c…39895`](https://sepolia.etherscan.io/tx/0x3858925cd1a4cfadd6b024f742be14bc1137453ecd95aaccb27bf51883639895) | 11,688,621 | [`0x20ac99ef…99d1c`](https://creditcoin-testnet.blockscout.com/tx/0x20ac99ef1bff1a568bc3e9bd8e74e0b97b166ac5caf45b261f288119d1399d1c) | `executeBatch` (3) | 773,365 | +100 | 5,181 s |
| 18 | sepolia | [`0x83983295…f141b`](https://sepolia.etherscan.io/tx/0x839832958cd31fe54968b7f7f1efc80cf520cdd9ad42b8142452e9d4910f141b) | 11,688,909 | [`0x20ac99ef…99d1c`](https://creditcoin-testnet.blockscout.com/tx/0x20ac99ef1bff1a568bc3e9bd8e74e0b97b166ac5caf45b261f288119d1399d1c) | `executeBatch` (3) | 773,365 | +100 | 1,581 s |

Notes on reading the table.

- **Gas** is the gas used by the whole Creditcoin transaction, so a two-member `executeBatch` row
  shows the batch's total and repeats it on both of its rows. The number includes the real cost of
  the `0x0FD2` verification, which the Foundry figures in section 4 do not.
- **Lag** is `attestationLagSec` from the evidence log: source-block timestamp to Creditcoin
  inclusion timestamp. It is dominated by source finality plus attestation, not by the worker. The
  fastest row here is 895 s, the slowest 9,783 s, and the slow ones are catch-up relays of roots that
  were already hours old when the relay started.
- Rows 1 and 6 are the same Ethereum transaction relayed to two different `AttestedWorldID`
  deployments. Within one deployment the query id makes that impossible.
- Every row's `kind` is 0, an insertion.

State of the current contracts at the time of the snapshot, read directly from CC3:

| | mainnet instance | sepolia instance |
|---|---|---|
| `rootCount()` | 7 | 8 |
| `humansAddedTotal()` | 600 | 700 |
| `latestRoot()` | `0x15cd52107d7e573345bd04713336de26c81d89a7bd3a8759882a53ec6b417d14` | `0x0e4a67954ed0de7af23074c4cd9293d9ebe5aac3a2e0358a60835dfd266b4643` |

Both counts keep rising while the cron runs; [humanline.credit/relay](https://humanline.credit/relay)
reads them from the chain rather than from this file.

`rootCount` exceeds the number of relayed transactions by one because the bootstrap relay records
both the `preRoot` and the `postRoot` of the transaction it starts from.

---

## 4. Gas

Two sets of numbers, because they measure different things.

**Foundry, with the `0x0FD2` precompile etched to a mock.** Optimizer on, `via_ir`, 200 runs. These
exclude whatever the native precompile charges for proof verification, so they isolate Humanline's
own cost.

| Scenario | Function | Gas |
|---|---|---|
| Bootstrap relay of the real mainnet fixture (10.4 KB `txBytes`, 100 commitments, 2 roots recorded) | `execute` | 282,403 |
| Steady-state chained relay (7 commitments, 1 root) | `execute` | 194,145 |
| Batch of 2 chained transactions | `executeBatch` | 268,283 |

**Live on CC3, including the real precompile.** Taken from the evidence log above.

| Scenario | Function | Gas | Transaction |
|---|---|---|---|
| Bootstrap, mainnet (2 roots recorded) | `execute` | 291,970 | `0x64aab38f…` |
| Bootstrap, sepolia (2 roots recorded) | `execute` | 295,498 | `0x39281065…` |
| Chained single relay, mainnet | `execute` | 287,378 | `0xfb33a81a…` |
| Batch of 2, mainnet | `executeBatch` | 569,744 (284,872 per transaction) | `0xe764d3be…` |
| Batch of 2, sepolia | `executeBatch` | 520,016 (260,008 per transaction) | `0x2087b417…` |

Batching's win is calldata and prover round trips rather than execution gas: one continuity proof
covers the whole batch, so a 6-transaction Sepolia batch encodes to about 63 KB of calldata instead
of six separate submissions each carrying their own continuity proof.

Deployment: `AttestedWorldID` runtime is 10,710 bytes and initcode 15,635 bytes, about 13.9 KB under
the EIP-170 limit; deploying it costs roughly 3.38 M gas because the constructor also constructs a
`SemaphoreVerifier`. `CreditLine` is 4,764 bytes, `HUSD` 2,156, `HumanRegistry` 1,802 and
`HumanGate` 561.

A relay transaction costs on the order of 0.0002 CTC on CC3 testnet.

---

## 5. Worker flow

`worker/` is a Bun process. It holds no privilege: the only thing it can do that a stranger cannot
is pay for gas. Its cursor is derived from chain state, so a fresh worker with no disk, such as the
GitHub Actions runner, resumes correctly.

1. **Cursor.** `max(sqlite cursor, last on-chain RootRelayed sourceBlock + 1, --from)`, floored at
   the deployment block of the target contract. Chain state beats local state.
2. **Finality ceiling.** The scan is clamped to `min(head, attestedTip - FINALITY_DEPTH)`, where
   `FINALITY_DEPTH` is read from the deployed contract. Without this, a `--once` pass would pull in
   blocks the contract cannot accept yet and then block on attestation.
3. **Scan.** `eth_getLogs` for `TreeChanged` from the manager, in windows of at most 5,000 blocks,
   ordered by `(blockNumber, logIndex)`, one entry per transaction. Never reordered, never skipped.
4. **Skip what is settled.** The local `queryId` is computed and `processedQueries[queryId]` is read
   on chain before any proof is fetched, so a replay costs one `eth_call` rather than a prover round
   trip.
5. **Batch.** Consecutive transactions are grouped while the span from the batch's first member is
   at most 1,000 blocks and the size is at most 10.
6. **Prove.** `waitUntilHeightAttested` on the SDK's `ProofBuilder`, then a poll of ChainInfo until
   `tip >= blockHeight + FINALITY_DEPTH` (the SDK wait polls the prover's cache; the contract's guard
   reads the chain, and both must be satisfied). Then `getBatchProof`. `normalizeBatchProof` refuses
   a batch that is missing a requested transaction or contains one we did not ask for, so a partial
   batch cannot masquerade as complete. If the batch call fails, the worker falls back to
   per-transaction `getProof` plus `execute`.
7. **Replay the guards locally.** `worker/src/evmv1.ts` decodes the Attestcoin EvmV1 payload in pure
   TypeScript and re-runs contract steps 1 to 6 off chain: source chain, receipt status, callee,
   exactly one `TreeChanged` from the manager with decoys skipped, known selector, and
   calldata-versus-log agreement. A mismatch is recorded instead of burning gas.
8. **Verify read-only.** `verifySingle` or `verifyBatch` on `0x0FD2` as an `eth_call`.
9. **Submit.** Gas estimate times 1.3, one confirmation.
10. **Evidence.** One JSON line per relayed transaction appended to `evidence/relay-log.jsonl`:
    source, Ethereum tx hash, source block and index, pre and post root, kind, humans added,
    Creditcoin tx hash, gas used, attestation lag, timestamp.

**Retry rules** (`worker/src/relay.ts`, `classifyRevert` and `nextRetryAction`, unit-tested through
mocked submissions):

| Revert | Class | Action |
|---|---|---|
| `"Query already processed"` or `QueryAlreadyProcessed(bytes32)` | already-processed | Mark done. Someone else relayed it; that is success, not failure. |
| `NotFinal`, `ThinQuorum` | transient | Stay pending. Chain state will change on its own; the next pass retries. |
| `UnknownPreRoot` | transient | Stay pending. An earlier root has to land first. |
| `"Proof of inclusion verification failed"`, or anything mentioning continuity, merkle, lower endpoint or attestation | stale-proof | Refetch the proof once, retry once, then record as failed. |
| `WrongSourceChain`, `SourceTxReverted`, `NotIdentityManager`, `NoTreeChange`, `AmbiguousTreeChange`, `CalldataLogMismatch`, `CannotOverwriteRoot` | permanent | Record as failed immediately. No refetch can help. |
| Anything else | unknown | Refetch once, then record as failed. |

Nothing is ever dropped. Every transaction keeps a row in sqlite and appears in `status`, whatever
its outcome. The cursor advances only across the leading run of settled batches, and is additionally
clamped below the first block any unsettled batch touches, so a shared block is rescanned rather
than skipped.

**Measured batching behavior.** A read-only pass over 24 hours of Sepolia staging activity, 29
`TreeChanged` transactions, produced 7 submissions: batches of 6, 4, 4, 4, 6 and 4 plus one single,
each inside the 1,000-block span limit, each verifying `true` against the real `0x0FD2`. The
equivalent mainnet pass over 21 transactions produced 5 batches plus 4 singles, the singles because
the prover returned HTTP 500 for one uncached batch range and the per-transaction fallback picked it
up cleanly.

---

## 6. Setup and reproduction

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh)
(`curl -L https://foundry.paradigm.xyz | bash && foundryup`). Clone with
`--recurse-submodules` — `forge-std` is a submodule. The shell scripts target bash 3.2, the macOS
default, which is why they avoid associative arrays.

### Without a wallet

Everything here is read-only. No key, no funds, no deployment of your own.

```bash
git clone --recurse-submodules https://github.com/rajkaria/humanline && cd humanline
bun install                      # worker + web
(cd contracts && bun install)    # Solidity dependencies

# Probe all three Attestcoin precompiles, list supported chains with their attested tips and
# bonded attestor counts, sanity-check bn128, and read both AttestedWorldID instances.
bun run worker/src/cli.ts check

# Take a real Ethereum mainnet World ID transaction, fetch its Attestcoin proof, replay every
# contract guard locally, and verify it against the live 0x0FD2 precompile. Sends nothing.
bun run worker/src/cli.ts prove \
  0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3 \
  --source mainnet --dry-run

# The same for the Sepolia staging tree.
bun run worker/src/cli.ts prove \
  0x366786038986b2f9e70e1fc1b2be3a419b7a4a3ef36732ed48bcd4083d058bb7 \
  --source sepolia --dry-run

# The whole relay pipeline minus the write: scan, batch, prove, verify, print calldata sizes.
bun run worker/src/cli.ts relay --source sepolia --once --dry-run

# Contracts: 101 tests. The 7 live CC3 tests skip cleanly without CC3_FORK.
cd contracts && forge test

# The same suite with the 7 live tests enabled, talking to the real CC3 node.
CC3_FORK=1 forge test
CC3_FORK=1 forge test --match-contract Fork -vv

# Worker: 202 tests, no network. Web: 215.
cd ../worker && bun test
cd ../web && bun test
```

`prove --dry-run` prints the local guard replay as a checklist, which is the artifact to read if you
want to see the contract's reasoning without reading Solidity:

```
local guard replay (AttestedWorldID steps 1-6):
  ok   chainKey == SOURCE_CHAIN_KEY           3 vs 3
  ok   receiptStatus == 1                     1
  ok   to == IDENTITY_MANAGER                 0xf7134CE138832c1456F2a91D64621eE90c2bddEa
  ok   exactly one TreeChanged from manager   1 (of 1 logs)
  ok   known selector                         0x2217b211 (register)
  ok   calldata preRoot == log preRoot        0x23026e03…c4948894
  ok   calldata postRoot == log postRoot      0x076e5a82…3d3bd622
  calldata: register, humansAdded 100, startIndex 17657879
execute calldata 7300 bytes
precompile verifySingle: true
```

`check` prints the live precompile state, including the supported-chain table with attested tips and
attestor counts, and the bn128 answers the Semaphore verifier depends on.

The `/judge` page of the deployed site runs the same reproduction path in the browser, including a
"prove any Ethereum transaction" widget that calls `0x0FD2` with no wallet connected.

### With a wallet

You need a CC3 testnet key with a little tCTC from the faucet. The worker reads
`CREDITCOIN_WALLET_PRIVATE_KEY` from `worker/.env` or from the repo-root `.secrets.env`, and never
prints it.

```bash
# Relay for real. Anyone can do this; the contract does not care who calls it.
bun run worker/src/cli.ts relay --source all --once
bun run worker/src/cli.ts relay --source all          # continuous, 60 s poll

# Cursor, per-transaction counts, failures with reasons, on-chain root state, evidence tail.
bun run worker/src/cli.ts status

# Seed a fresh AttestedWorldID with its first root.
bun run worker/src/cli.ts bootstrap --source sepolia
```

To deploy your own copy:

```bash
cd contracts
PROFILE=demo script/deploy-cc3.sh    # or PROFILE=prod for 30-day loan terms
script/export-abi.sh                 # refresh contracts/abi/*.json
```

`deploy-cc3.sh` uses `cast send --create` rather than `forge script`. Foundry 1.5.1 cannot build an
EVM environment from a CC3 RPC, because CC3 is a Substrate and Frontier chain whose
`eth_getBlockByNumber` result carries no `mixHash`, so revm rejects the environment with a
`prevrandao` header validation error before the script body runs. The same limitation is
why the fork tests read the chain over `vm.rpc("cc3", ...)` instead of `--fork-url`.
`script/Deploy.s.sol` remains the canonical, tested description of the deployment and runs green
against a local EVM.

Without `deployments/cc3-testnet.json`, every command that would send a transaction prints an
explanation and exits 2. `check` and every `--dry-run` path still work.

---

## 7. Threats, errors and the tests that cover them

Each row: the attack, the error it produces, and the test that proves it. Solidity test names are
function names in `contracts/test/`; worker test names are the test strings in `worker/test/`.

### Relay (`AttestedWorldID`)

| Attack | Error | Test |
|---|---|---|
| Forged proof, or a transaction never included on Ethereum | precompile revert, `"Proof of inclusion verification failed"` (batch: `BatchProofRejected`) | `AttestedWorldID.t.sol :: test_SingleExecuteRevertsWhenTheProverRejectsTheProof`, `:: test_BatchRevertsWhenTheProverRejectsTheProof` |
| A real proof, but for the other source chain | `WrongSourceChain(got, want)` | `:: test_RevertsOnWrongSourceChain` |
| A `registerIdentities` that reverted on Ethereum | `SourceTxReverted()` | `:: test_RevertsWhenTheSourceTxReverted` |
| A transaction to a look-alike identity manager | `NotIdentityManager(to)` | `:: test_RevertsWhenTheCalleeIsNotTheIdentityManager` |
| A contract-creation transaction with no callee | `NotIdentityManager(0x0)` | `:: test_RevertsWhenTheTransactionIsAContractCreation` |
| Decoy `TreeChanged` from an unrelated contract in the same transaction | none, the decoy is skipped | `:: test_IgnoresDecoyTreeChangedFromAnotherEmitter` |
| A manager transaction that emits no `TreeChanged` | `NoTreeChange()` | `:: test_RevertsWhenThereIsNoTreeChange`, `:: test_RevertsWhenThereAreNoLogsAtAll` |
| Two genuine `TreeChanged` logs, so the root is ambiguous | `AmbiguousTreeChange(count)` | `:: test_RevertsOnTwoGenuineTreeChangedLogs` |
| Calldata that disagrees with the log | `CalldataLogMismatch()` | `:: test_RevertsWhenCalldataRootsDisagreeWithTheLog` |
| An unexpected selector on the identity manager | `CalldataLogMismatch()` | `:: test_RevertsOnAnUnknownSelector` |
| Truncated or malformed calldata | `CalldataLogMismatch()` | `:: test_RevertsOnTruncatedCalldata` |
| A genuine but out-of-order root | `UnknownPreRoot(preRoot)` | `:: test_RevertsOnAnUnknownPreRootAfterBootstrap` |
| A root from a block shallow enough to be reorged | `NotFinal(attestedTip, sourceBlock)` | `:: test_RevertsWhenTheSourceBlockIsNotFinalYet`, boundary: `:: test_AcceptsExactlyAtTheFinalityDepth` |
| A root attested by a thin attestor set | `ThinQuorum(have, want)` | `:: test_RevertsOnThinAttestorQuorum` |
| Replaying a proof that was already relayed | `"Query already processed"`, or `QueryAlreadyProcessed(queryId)` on the batch path | `:: test_RevertsOnReplayOfTheSameQuery`, `:: test_BatchRejectsARepeatedQueryInsideOneBatch`, `:: test_BatchRejectsAQueryAlreadyRelayedSingly` |
| Re-adopting a historical root to reset its timestamp | `CannotOverwriteRoot()` | `:: test_RevertsWhenARootWouldBeOverwritten` |
| Side-filling an ancient root to give it a fresh week of validity | none; it arrives already expired | `:: test_AnAncientSideFilledRootArrivesAlreadyExpired` |
| An oversized, empty, mismatched or out-of-order batch | `BatchTooLarge(size)`, `EmptyBatch()`, `BatchLengthMismatch()`, `BatchOutOfOrder()` | `:: test_BatchRejectsMoreThanTen`, `:: test_BatchRejectsEmpty`, `:: test_BatchRejectsMismatchedLengths`, `:: test_BatchRejectsOutOfOrderHeights` |
| Changing the one-week root history expiry | `RootHistoryExpiryImmutable()` | `:: test_RootHistoryExpiryCannotBeChanged` |

### Personhood (`HumanRegistry`, `AttestedWorldID.verifyProof`)

| Attack | Error | Test |
|---|---|---|
| A garbage or invalid Groth16 proof | `ProofInvalid()` | `AttestedWorldID.t.sol :: test_VerifyProofRejectsAGarbageProof`, `HumanRegistry.t.sol :: test_RevertsWhenTheProofIsRejected` |
| A proof against a root that was never relayed | `NonExistentRoot()`, before the verifier is touched | `AttestedWorldID.t.sol :: test_VerifyProofRejectsAnUnknownRootBeforeTouchingTheVerifier` |
| A proof against a root older than the one-week expiry | `ExpiredRoot()` | `AttestedWorldID.t.sol :: test_RootsExpireAfterOneWeek` |
| Front-running: lifting a proof from the mempool into your own wallet | `ProofInvalid()`, the signal is `msg.sender` | `HumanRegistry.t.sol :: test_TheSignalHashIsCallerSpecific` |
| Reusing a World ID proof from another application or action | `ProofInvalid()`, the external nullifier is fixed at construction | `HumanRegistry.t.sol :: test_ExternalNullifierMatchesTheProductionVector` |
| One wallet holding two humans | `WalletAlreadyHuman(wallet, nullifierHash)` | `HumanRegistry.t.sol :: test_RevertsWhenTheWalletAlreadyBelongsToAnotherHuman` |
| Re-registering the same wallet to churn events | `SameWallet()` | `HumanRegistry.t.sol :: test_RevertsOnRegisteringTheSameWalletTwice` |
| One human registering twice for two identities | none; a second wallet re-binds rather than creating a second human | `HumanRegistry.t.sol :: test_RebindMovesTheHumanToANewWallet` |

### Credit (`CreditLine`)

| Attack | Error | Test |
|---|---|---|
| An unverified wallet opening a line | `NotHuman(wallet)` | `CreditLine.t.sol :: test_NonHumansCannotTouchTheLine` |
| One human opening a second line from a second wallet | `LineExists(human)` | `:: test_ASecondWalletCannotOpenASecondLine` |
| A defaulted human returning with a fresh wallet | `LineFrozen(human)` | `:: test_DefaultSurvivesAWalletRebind` |
| Borrowing past the limit, fee included | `OverLimit(requested, available)` | `:: test_BorrowingPastTheLimitReverts`, `:: test_TheFeeCountsAgainstTheLimitAcrossDraws` |
| Draining the pool past idle liquidity | `InsufficientLiquidity(requested, available)` | `:: test_BorrowingMoreThanTheIdleBalanceReverts`, `:: test_WithdrawIsLimitedToIdleLiquidity` |
| Marking a healthy line as defaulted | `NotInDefault(human, dueAt, grace)` | `:: test_MarkDefaultBeforeGraceEndsReverts`, `:: test_MarkDefaultOnACleanLineReverts` |
| A first depositor donating to skim the next lender | none; virtual-offset share math bounds it | `:: test_ADonationAttackCannotSkimTheNextDepositor` |
| A lender exiting ahead of a default with unearned interest | none; the fee is income only when paid | `:: test_ALenderCannotWithdrawUnearnedInterest`, `:: test_TwoLendersShareAWriteOffProRata` |
| A one-human-one-claim gate reused from a second wallet | `AlreadyClaimed(human)` | `HumanGate.t.sol :: test_ANewWalletCannotClaimAgain` |

### Relay operation (worker)

| Attack or failure | Handling | Test |
|---|---|---|
| A malicious relayer submitting a fabricated root | No privilege exists to abuse; every submission goes through `0x0FD2` | `AttestedWorldID.fork.t.sol :: testFork_RelaysTheMainnetFixtureEndToEnd` |
| A relayer reordering roots | Refused on chain by the chain rule; the worker also never reorders | `relay.test.ts :: "never reorders and never drops a transaction"` |
| A relayer wasting gas on an already-relayed root | Skipped by checking `processedQueries` before proving | `relay.test.ts :: "a batch that reverts this way is marked already, not failed"` |
| A proof gone stale between fetch and submission | Refetched once and retried, then recorded as failed | `relay.test.ts :: "a stale proof is refetched once and the retry can succeed"`, `:: "a second stale revert gives up rather than looping"` |
| A batch silently losing a member | `normalizeBatchProof` refuses it | `proofs.test.ts :: "refuses a batch that is missing a requested transaction"` |
| The cursor skipping a failed batch | Advance only across the leading settled run, clamped below the first unsettled block | `relay.test.ts :: "two batches sharing a block: the second fails, so the shared block is rescanned"` |
| A decoy log reaching the worker | Skipped off chain too, matching the contract | `evmv1.test.ts :: "skips a decoy TreeChanged from another contract"` |

---

## 8. Limitations

Stated plainly, because a judge will find them anyway.

**Attestcoin is read-only today.** Write-ability, meaning Creditcoin pushing messages out to other
chains, is in audit and not available on testnet. Humanline is one-directional by necessity:
Ethereum state comes in, nothing goes back out.

**There are no absence proofs.** Attestcoin can prove a transaction happened. It cannot prove one did
not. That is why a default is declared from a passed deadline plus the absence of a repayment in
Creditcoin's own state, which is native and directly readable, rather than from any claim about
Ethereum. We do not fake an absence proof anywhere.

**Roots lag.** Source finality plus attestation, plus the worker's poll interval, plus a finality
depth of 32. Measured end to end in the evidence log at roughly 15 minutes for a freshly mined root,
and hours for catch-up relays of older roots. A human verified by an Orb minutes ago cannot register
on Creditcoin until their root arrives. This is correct behavior and it is visible as the attestation
lag column on `/relay`.

**Root history expires after one week.** World's own constant, kept as is, and now genuinely enforced
because roots are dated by their source block. A proof built against a root older than a week fails
with `ExpiredRoot`. If the relay stops for more than a week, registration stops working until it
resumes and a fresh root lands.

**World ID 3.0 dependency.** Humanline verifies Semaphore proofs from World ID's 3.0 tree, which is
what the on-chain Groth16 verifier consumes. World ID 4.0 is live with verification on World Chain,
and IDKit must be asked for legacy proofs (`allow_legacy_proofs` with the `orbLegacy` preset). No
sunset date has been announced, but the dependency is real. The roadmap answer is proving World Chain
output roots through their Ethereum postings, which is the same Attestcoin pipeline with a different
source contract.

**Staging goes through the World ID Simulator.** The Sepolia path exists so personhood verification
can be reproduced without an Orb. It is the same contract code and the same Attestcoin pipeline as
mainnet, but the identities in the staging tree are simulator identities, not Orb-verified humans.
The mainnet instance carries the real thing.

**Demo loan terms are minutes, not months.** The deployed profile is `demo`: `TERM` is 600 seconds
and `GRACE` is 300 seconds, so a full borrow, miss, and default cycle fits in a video. Production
terms are 30 days and 7 days (`PROFILE=prod`). `hUSD` is a test stablecoin we mint, lender deposits
are testnet funds, and no economic claim here has been tested with real money.

**Sybil resistance is exactly World's sybil resistance.** Humanline's guarantee is "one World ID, one
line", not "one biological human, one line". Those coincide only as well as the Orb does. Attestcoin
removes the operator between World's tree and Creditcoin. It does not remove World.

**The attestor set is the deepest assumption.** If a quorum of Attestcoin attestors colludes, they
can attest to an Ethereum block that does not exist and a fabricated root would pass `verifyAndEmit`.
Humanline inherits Attestcoin's security here and cannot do better than it. What it can do, and does,
is refuse roots when the bonded set is under three and when the source block is under 32 attested
blocks deep.

**The relay is single-operator today.** That is a liveness dependency, not a trust dependency: the
worker is public, the contract does not care who calls it, and nothing is lost while nobody relays.
We say "single operator" rather than describing one worker as decentralized.

**Batch limits are the protocol's.** At most 10 proofs share one continuity proof, inside a
1,000-block window. A burst of tree activity takes several transactions to relay. The prover's batch
endpoint also returned HTTP 500 once during testing for an uncached range; the per-transaction
fallback handled it, at the cost of more calldata and more gas.

See `docs/SECURITY.md` for the full threat model and trust assumptions, and `docs/ARCHITECTURE.md`
for the sequence diagrams and the boundary-by-boundary data-flow table.
