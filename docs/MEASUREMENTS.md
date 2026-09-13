# Measurements

Every number here is reproducible by one command, and none of them is typed in by hand: the rigor
section quotes files the commands write under `evidence/`, and the live section between the markers is
regenerated from `evidence/measurements.json` by the worker.

| What | One command | Writes |
|---|---|---|
| Unit, fuzz and invariant tests | `cd contracts && forge test` (CI: `FOUNDRY_PROFILE=ci`) | test output |
| Line and branch coverage | `bash scripts/coverage.sh` | `evidence/coverage.txt`, `contracts/lcov.info` |
| Mutation score | `bun run scripts/mutation.ts --jobs 4` | `evidence/mutation.json` |
| Static analysis | `cd contracts && uvx --from slither-analyzer slither . --config-file slither.config.json` | triaged below, `evidence/slither.json` |
| Twelve live attacks | `bun run worker/src/cli.ts attack` | `evidence/attacks.json` |
| Gas, cap, latency, proof size, precompile share | `bun run worker/src/cli.ts measure` | `evidence/measurements.json`, the generated block below |

## 1. Rigor

### Tests

| Suite | Tests | Notes |
|---|---:|---|
| Contracts, unit + fuzz | see `forge test` | 512 fuzz runs per property locally, 2,048 in CI |
| Contracts, invariants | 12 invariants in 3 suites | 48 × 64 locally, 128 runs × 128 calls (16,384 calls each) in CI |
| Contracts, live fork | 14 | read the real `0x0FD2`/`0x0FD3`/`0x0FD4` on CC3 testnet (`CC3_FORK=1`) |
| Worker | `cd worker && bun test` | no network |
| Web | `cd web && bun test` | includes in-browser proof verification and the attack and measurement builders |

The invariants, each with an `afterInvariant` anti-vacuity guard that fails the run if the handler never
reached the states the property is about (lines opened, loans drawn, roots advanced, wallets linked):

| Contract | Invariant | What it rules out |
|---|---|---|
| CreditLine | `invariant_TokensAreConserved` | hUSD appearing or disappearing: the pool's balance is exactly deposits and repayments in, minus withdrawals and draws out |
| CreditLine | `invariant_SharesAddUp` | share supply drifting from the sum of lender balances |
| CreditLine | `invariant_PrincipalIsTheSumOfLines` | `totalPrincipal` disagreeing with the ex-fee principal of every line, or `totalAssets` with cash plus that principal |
| CreditLine | `invariant_OneLinePerHuman` | a second line for one nullifier, whichever wallet asks |
| CreditLine | `invariant_FrozenStaysFrozen` | a defaulted line ever borrowing again, including after a wallet rebind |
| CreditLine | `invariant_ExposureCapRespected` | outstanding principal above the `0x0FD4` attestor-bond budget |
| AttestedWorldID | `invariant_TipOnlyAdvancesAlongTheChain` | the tip moving to a root whose pre-root is not the previous tip |
| AttestedWorldID | `invariant_RootCountMatchesHistory` | `rootCount` disagreeing with the recorded history |
| AttestedWorldID | `invariant_NoReplayAcrossEntrypoints` | one proof counted twice through `execute` and `executeBatch` |
| AttestedWorldID | `invariant_OrphanRootsAreNeverAdopted` | a root with an unknown pre-root entering history |
| HumanLinks | `invariant_AWalletNeverChangesHuman` | a linked wallet's history moving to another human |
| HumanLinks | `invariant_LinkListsAreConsistentAndBounded` | link lists and the wallet index disagreeing, or exceeding 8 |

### Coverage

`forge coverage` compiles without the optimizer, where `@gluwa/asc-contracts`' `EvmV1Decoder` is
stack-too-deep under both legacy codegen and `--ir-minimum`. `scripts/coverage.sh` runs it on a scratch
copy in which every inline `assembly {` is annotated `("memory-safe")`, which lets via-IR move stack
slots to memory; no statement changes, so hits map one to one onto the real sources. From
`evidence/coverage.txt`:

| File | Lines | Statements | Branches | Functions |
|---|---:|---:|---:|---:|
| `AttestedWorldID.sol` | 90.13% (137/152) | 88.35% (182/206) | 82.93% (34/41) | 90.00% (18/20) |
| `CreditHistory.sol` | 98.86% (87/88) | 98.52% (133/135) | 100.00% (17/17) | 100.00% (15/15) |
| `CreditLine.sol` | 96.03% (145/151) | 97.27% (178/183) | 100.00% (31/31) | 92.31% (24/26) |
| `EthRepay.sol` | 98.21% (55/56) | 97.67% (84/86) | 100.00% (11/11) | 100.00% (7/7) |
| `HUSD.sol` | 100.00% (13/13) | 100.00% (13/13) | 100.00% (2/2) | 100.00% (3/3) |
| `HumanLinks.sol` | 100.00% (55/55) | 100.00% (72/72) | 100.00% (12/12) | 100.00% (12/12) |
| `HumanRegistry.sol` | 100.00% (24/24) | 100.00% (26/26) | 100.00% (5/5) | 100.00% (4/4) |
| `ProvenSource.sol` | 77.46% (55/71) | 81.13% (86/106) | 89.47% (17/19) | 70.00% (7/10) |
| `RelayReward.sol` | 98.41% (62/63) | 97.47% (77/79) | 92.86% (13/14) | 100.00% (10/10) |
| `examples/HumanGate.sol` | 100.00% (8/8) | 100.00% (8/8) | 100.00% (2/2) | 100.00% (2/2) |
| **Total** | **93.60% (643/687)** | **93.59% (861/920)** | **93.51% (144/154)** | **91.96% (103/112)** |

What the uncovered lines are: the precompile reads (`_attestedTip`, `_attestorCount`, `_bond`,
`_chainIdOf`, `_chainInfoChainId`) are `internal virtual` and overridden by the unit harnesses, so their
real bodies run only in the live fork suites, which coverage excludes because they need the CC3 node.
The same applies to the two library shims in `interfaces/`.

<!-- mutation:start -->
### Mutation score

`scripts/mutation.ts` applies two operators to every one-line guard `if (...) revert ...;` in the nine
top-level contracts in `contracts/src`: delete the guard, or flip its first relational operator. Each
mutant is compiled and run against the unit and fuzz suites in a scratch copy. A mutant that does not
compile is "stillborn" and not scored.

**Full run, 192 mutants: 171 killed, 20 survived, 1 stillborn, a score of 89.5%.** Every survivor was
then either pinned by a new test at the exact boundary it exposed, or shown to be equivalent (no
behaviour can tell the mutant from the original):

| Survivor | Disposition |
|---|---|
| `HumanLinks.sol:170` `wallet > uint160.max` → `>=` | new test `test_TheHighestAddressIsAValidIntentWallet` |
| `AttestedWorldID.sol:233` `attestors < MIN_ATTESTORS` → `<=` | new test `test_AcceptsExactlyTheAttestorFloor` |
| `AttestedWorldID.sol:332` register calldata length, flip | new test `test_AcceptsTheShortestWellFormedRegisterCalldata` |
| `AttestedWorldID.sol:332` register calldata length, delete | equivalent: calldata too short to hold both roots fails the root cross-check at the end of the function with the same error |
| `AttestedWorldID.sol:339` length word inside calldata, delete and flip | new tests `test_AcceptsALengthWordEndingExactlyAtTheCalldataEnd`, `test_RevertsWhenTheLengthWordPointsPastTheCalldata` |
| `AttestedWorldID.sol:341` identity count fits `uint32`, delete and flip | new tests `test_RevertsOnAnIdentityCountThatOverflowsUint32`, `test_AcceptsTheLargestUint32IdentityCount` |
| `AttestedWorldID.sol:344` delete calldata length, flip | new test `test_AcceptsTheShortestWellFormedDeleteCalldata` |
| `AttestedWorldID.sol:344` delete calldata length, delete | equivalent: the same root cross-check refuses calldata too short to hold both roots, with the same error |
| `CreditLine.sol:203` `owed > available` → `>=` | new test `test_BorrowingExactlyTheLimitSucceeds` |
| `CreditHistory.sol:80` zero pool address, delete | extended `test_OnlyConfiguredChainsAndSafeParameters` |
| `CreditHistory.sol:85` `decimals > 36` → `>=` | extended `test_OnlyConfiguredChainsAndSafeParameters` (36 accepted, 37 refused) |
| `CreditHistory.sol:148` `blockHeight < earliest` → `<=` | new test `test_ARepaymentExactlyAtTheMinimumGapCounts` |
| `AttestedWorldID.sol:126` `msg.sig != execute`, delete | equivalent: `_processAndEmitEvent` is only reachable from `ASCBase.execute` |
| `AttestedWorldID.sol:325` calldata shorter than 4 bytes, delete and flip | equivalent: such calldata has no known selector and is refused with the same error one line later |
| `AttestedWorldID.sol:337` tail offset fits `uint32`, delete and flip | equivalent: any tail that large fails the calldata-bounds guard on line 339 with the same error |
| `CreditLine.sol:138` `assets == 0`, delete | equivalent: a zero deposit mints zero shares and hits the `shares == 0` guard with the same error |

An earlier partial run had also surfaced the reentrancy locks in `RelayReward` and `EthRepay`, whose
re-entered calls failed for another reason even with the lock deleted. The tests now assert the lock's
own `Reentrancy` error (`test_ReentryDuringPaymentFailsOnTheLockItself`,
`test_ReentryThroughTheCreditLineFailsOnTheLockItself`), and the full run above killed both.

The per-mutant record, including the re-run of the files these tests touch, is `evidence/mutation.json`
(`bun run scripts/mutation.ts --files AttestedWorldID,HumanLinks,CreditLine,CreditHistory` repeats it).
<!-- mutation:end -->

### Static analysis (Slither 0.11.6)

`contracts/slither.config.json` excludes tests, scripts, vendored and third-party code. 99 results: 2
High, 5 Medium, 28 Low, 64 Informational. Every High and Medium is triaged here; none is a bug.

| Detector | Where | Verdict |
|---|---|---|
| `reentrancy-eth` (High) | `RelayReward.relay` pays `msg.sender`, then credits `claimable` if the payment failed | Guarded: `relay` and `claim` share one `nonReentrant` lock, and the credit branch only runs when the call already failed. `test_ReentryDuringPaymentFailsOnTheLockItself` pins that the lock, not ordering, stops re-entry. |
| `uninitialized-state` (High) | `HumanLinks._walletsOf` | False positive: a `mapping(uint256 => address[])` that `_link` pushes into. |
| `incorrect-equality` (Medium) | `HUSD.faucetAvailableAt` (`last == 0`), `CreditLine.deposit` (`shares == 0`) | Intended: a "never used" sentinel, and a refusal to mint zero shares (`test_ADepositTooSmallToMintAShareReverts`). |
| `reentrancy-no-eth` (Medium) | `HumanRegistry.register` writes after `IWorldID.verifyProof` | The callee is the immutable `AttestedWorldID` set at deployment (a view proof check), not an arbitrary contract. |
| `uninitialized-local` (Medium) | `RelayReward.relay` `paid`, `credited` | Intended zero defaults: exactly one of them is set when a reward is owed. |
| `missing-zero-check` (Low) | `CreditLine` (`asset`, `registry`, `history`), `HumanRegistry` (`worldId`), `HumanLinks` (`registry`) | Accepted. Constructor arguments come from the deploy script and are checked on-chain after deployment; `history == 0` is the documented "no history" mode. |
| `calls-loop` (Low) | `ProvenSource` constructor reads `0x0FD3` per configured chain | Intended: once at deployment, one call per source chain. |
| `reentrancy-benign` / `reentrancy-events` (Low) | writes and events after `0x0FD2.verifyAndEmit` | The callee is the native BlockProver precompile. |
| `timestamp` (Low) | loan terms, faucet cooldown, signature deadline, root freshness | Intended: day-scale windows where validator skew does not matter. |
| `naming-convention`, `assembly`, `low-level-calls` (Informational) | immutables in `UPPER_CASE`, precompile ABIs in `snake_case`, query-id hashing, reward transfers | Style, dictated by the Attestcoin interfaces. |

## 2. Live attacks

`bun run worker/src/cli.ts attack` sends each attack to CC3 testnet as a read-only `eth_call`, with real
Sepolia transactions and real Attestcoin proofs as inputs (`evidence/attack-inputs.json`), and records
what the chain answered. `/judge` fires the same calls while the page loads, with no wallet, and
`.github/workflows/attacks.yml` repeats them every six hours. From `evidence/attacks.json`:

| Attack | Refused with |
|---|---|
| Forged Merkle proof | `Error: Merkle proof validation failed` (0x0FD2) |
| Wrong contract called (a real USDC transfer) | `NotIdentityManager(0x1c7D…7238)` |
| Reverted source transaction (a real failed Sepolia tx) | `SourceTxReverted` |
| Replay an adopted root | `QueryAlreadyProcessed` |
| Roots out of order | `BatchOutOfOrder` |
| Unattested block height | `Error: Continuity proof does not match attestation or checkpoint` (0x0FD2) |
| Below the attestor floor | `ThinQuorum(7, 1000)` |
| Wrong source chain (Sepolia root into the Ethereum relay) | `WrongSourceChain(1, 3)` |
| Decoy `TreeChanged` log appended to a real receipt | `Error: Merkle proof validation failed` (0x0FD2) |
| Oversize batch (11) | `BatchTooLarge(11)` |
| Root from before the relay's history | `UnknownPreRoot` |
| One human, a second registration | `SameWallet` |

Two honest notes. The precompile refuses forged, tampered and unattested proofs inside the relay's own
call, so the contract's `BatchProofRejected` is never the error a live attacker sees. And the live
deployment has 7 bonded attestors against a floor of 3, so the attestor-floor attack runs the live relay
bytecode at a scratch address through an `eth_call` state override with that one immutable raised to
1,000; the refusal still comes from deployed code reading the real `0x0FD4`.

## 3. Live measurements

<!-- measurements:start (generated by `bun run worker/src/cli.ts measure`; do not edit by hand) -->

_Collected 2026-09-13T07:03:05.184Z from CC3 testnet (chainId 102031) at block 5,479,386; block gas limit 75,000,000._

### Gas per batch size

Every real relay transaction on both `AttestedWorldID` instances since deployment, grouped by how many
World ID updates it carried.

| Updates in the batch | Transactions | Min gas | Median gas | Max gas |
|---:|---:|---:|---:|---:|
| 1 | 16 | 237,972 | 276,948 | 279,188 |
| 2 | 6 | 496,720 | 520,016 | 633,808 |
| 3 | 2 | 773,365 | 773,365 | 791,161 |
| 4 | 1 | 741,470 | 741,470 | 741,470 |

- Live fit on batch size alone: gas ≈ 77,087 + 211,858 · updates (R² 0.910, 25 points).
- Live fit with the continuity span: gas ≈ 162,015 + 108,745 · updates + 440.8 · continuity roots (R² 0.996, 25 points).

Live batches only cover the sizes the relay happened to need, so sizes up to the cap are measured on a
fresh copy of the live relay bytecode (an `eth_call` state override) fed consecutive real Sepolia
updates, with gas read by `contracts/script/GasProbe.sol`. 6 consecutive Sepolia tree updates in blocks 11689195..11690075 (one batch proof spans at most 1,000 blocks), relayed onto a fresh copy of the live relay bytecode.

| Updates | Continuity roots | Calldata bytes | Execution gas | Transaction gas | Result |
|---:|---:|---:|---:|---:|---|
| 1 | 6 | 6,500 | 190,628 | 265,480 | adopted |
| 2 | 306 | 21,988 | 292,753 | 568,997 | adopted |
| 3 | 606 | 37,476 | 396,695 | 874,679 | adopted |
| 4 | 906 | 53,028 | 502,855 | 1,179,307 | adopted |
| 5 | 906 | 56,164 | 588,518 | 1,291,998 | adopted |
| 6 | 906 | 62,116 | 682,074 | 1,422,550 | adopted |

- Probe fit: gas ≈ 107,937 + 235,971 · updates (R² 0.964, 6 points).
- Probe fit with the continuity span: gas ≈ 140,800 + 121,213 · updates + 608.6 · continuity roots (R² 1.000, 6 points).
- The first update on a fresh copy is a bootstrap and records two roots, so n = 1 costs slightly more than a steady-state single relay.

### The 10 / 11 cap

- 11 updates: `BatchTooLarge`, refused before any proof work.
- 10 updates: passes the size check and is refused later, by `QueryAlreadyProcessed` (the probe reuses an already-relayed update), which is what proves the cap is exactly 10.
- Projected gas for a full batch of 10: 2,467,646, which fits 30 times in one CC3 block.

### Attestation vs checkpoint

- Reading the attestation tip (`get_latest_attestation_height_and_hash`): 3,125 gas.
- Reading the checkpoint tip (`get_latest_checkpoint_height_and_hash`): 3,125 gas.

`0x0FD2` `verify` gas for real proofs, by what the continuity chain is anchored to:

| Source tx | Chain key | Anchor | Continuity roots | Verify gas |
|---|---:|---|---:|---:|
| `0x36678603…` | 1 | checkpoint | 38 | 12,908 |
| `0x81ece311…` | 3 | checkpoint | 36 | 12,908 |
| `0x2e34a903…` | 1 | checkpoint | 99 | 15,884 |
| `0xe4723adf…` | 1 | checkpoint | 15 | 11,851 |
| `0xf3770ee1…` | 1 | checkpoint | 74 | 14,684 |
| `0x75303ecf…` | 1 | checkpoint | 10 | 11,612 |
| `0x4137f3bb…` | 1 | checkpoint | 1 | 3,380 |
| `0xf7424cd6…` | 1 | checkpoint | 6 | 11,420 |

- verify gas ≈ 9,092 + 79 · continuity roots (R² 0.542, 8 points).

### Attestation latency

Seconds from a World ID update's source block to its root landing on Creditcoin, per root, over 21.6 hours of relay history.

| Relay | Roots | Min | Median | p90 | Max |
|---|---:|---:|---:|---:|---:|
| both | 46 | 13.8 min | 27.9 min | 2.39 h | 2.78 h |
| sepolia | 27 | 13.9 min | 27.9 min | 2.04 h | 2.72 h |
| mainnet | 19 | 13.8 min | 46.5 min | 2.61 h | 2.78 h |

### Proof size

| Measure | Samples | Min | Median | p90 | Max |
|---|---:|---:|---:|---:|---:|
| relay calldata (bytes) | 33 | 3,684 | 6,564 | 31,268 | 39,876 |
| encoded source tx (bytes) | 39 | 2,400 | 5,216 | 5,216 | 5,216 |
| continuity roots per proof | 26 | 2 | 7 | 573 | 671 |

Calldata distribution (2 KB buckets):

| Bytes | Transactions |
|---|---:|
| 2,000–4,000 | 1 |
| 6,000–8,000 | 21 |
| 8,000–10,000 | 2 |
| 20,000–22,000 | 1 |
| 22,000–24,000 | 2 |
| 24,000–26,000 | 1 |
| 26,000–28,000 | 1 |
| 30,000–32,000 | 1 |
| 32,000–34,000 | 1 |
| 36,000–38,000 | 1 |
| 38,000–40,000 | 1 |

### Who uses the BlockProver precompile

Every `0x0FD2` log in CC3 blocks 5,473,627–5,479,386 (24.0 h): 8,449 logs in 5,015 transactions to 72 distinct contracts. Humanline sent 33 of them (0.66%).

| Called contract | Transactions | Share | Humanline |
|---|---:|---:|---|
| `0x0c019e…230e` | 2,072 | 41.32% |  |
| `0x2d8a4d…c118` | 1,256 | 25.04% |  |
| `0xf7283a…36c5` | 631 | 12.58% |  |
| `0xb462c2…4d4c` | 358 | 7.14% |  |
| `0x4bc16e…e2ab` | 114 | 2.27% |  |
| `0xa97242…6047` | 81 | 1.62% |  |
| `0x1fc6c2…fdc9` | 75 | 1.50% |  |
| `0xa15564…5817` | 59 | 1.18% |  |
| `0x0d5c85…22fc` | 46 | 0.92% |  |
| `0x2af320…121c` | 38 | 0.76% |  |
| `0x666aec…6d39` | 32 | 0.64% |  |
| `0x3a7c3c…cef7` | 18 | 0.36% | yes |

<!-- measurements:end -->
