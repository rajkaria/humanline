# Humanline: Security Model

Attestcoin proves two things: that a transaction was included in an attested block on a source chain, and that a given receipt belongs to it. That is all it proves, and it is deliberately narrow. Everything between "this Ethereum transaction happened" and "this person may borrow twenty five dollars" is Humanline's responsibility.

This document lists what we defend against, where each defense sits, what it is trusting, and what it does not cover.

Deployed contracts, CC3 testnet (chainId 102031):

| Contract | Address |
|---|---|
| `AttestedWorldID` (mainnet, chainKey 3) | `0x1122ef3fa4ab0693809e42a00b2476efcf4468ad` |
| `AttestedWorldID` (Sepolia, chainKey 1) | `0x3a7c3cc67034197208923587b8dc5c4674cbcef7` |
| `HumanRegistry` | `0x62c2fd99ea587e4b466175ad248468782bd5298d` |
| `CreditLine` | `0x1bd40163e41e44d2f139d95de88b640f6ea461f7` |
| `hUSD` | `0x4bd7f4c6648deb8f107932572ce7e85aca259640` |
| `HumanGate` | `0xa3e021de49cec8819ea1bd37a8b5a9df005b776c` |

There are no admin keys, no pause switch and no upgrade path in any of them. Every configured constant is an immutable set at construction. Anyone can run the relay.

---

## 1. Threat model

Read the table as: an attacker tries the thing in column one, and column two is the line of code that stops them. Test names in braces are filled in from the shipped suite; the file each lives in is fixed.

### 1.1 Root relay (`AttestedWorldID`)

| Threat | Where it is stopped | Error | Test |
|---|---|---|---|
| Forged Attestcoin proof, or a transaction that was never included on Ethereum | `ASCBase.execute` calls `verifyAndEmit` on the BlockProver precompile `0x0FD2` before any Humanline code runs | Precompile revert (no Humanline error reached) | `AttestedWorldID.fork.t.sol :: `test_RevertsWhenTheProofIsRejected / testFork_BlockProverVerifiesTheMainnetFixture`` |
| Tampered transaction payload with a genuine Merkle path | Merkle root check inside `verifyAndEmit`; the encoded transaction is hashed and compared | Precompile revert | `AttestedWorldID.fork.t.sol :: `test_SingleExecuteRevertsWhenTheProverRejectsTheProof`` |
| Proof from the wrong source chain, for example a Sepolia proof submitted to the mainnet instance | Step 1 of `_processAndEmitEvent`: `chainKey == SOURCE_CHAIN_KEY` | `WrongSourceChain(got, want)` | `AttestedWorldID.t.sol :: `test_RevertsOnWrongSourceChain`` |
| A `registerIdentities` transaction that reverted on Ethereum | Step 2: `decodeReceiptFields(tx).receiptStatus == 1` | `SourceTxReverted()` | `AttestedWorldID.t.sol :: `test_RevertsWhenTheSourceTxReverted`` |
| A transaction sent to a look-alike identity manager | Step 3: `decodeCommonTxFields(tx).to == IDENTITY_MANAGER` | `NotIdentityManager(to)` | `AttestedWorldID.t.sol :: `test_RevertsWhenTheCalleeIsNotTheIdentityManager`` |
| Decoy `TreeChanged` event emitted by an unrelated contract inside the same transaction | Step 4: logs are filtered by emitter before counting; foreign logs are skipped, not fatal | none (skipped) | `AttestedWorldID.t.sol :: `test_IgnoresDecoyTreeChangedFromAnotherEmitter`` |
| A transaction to the manager that emits no `TreeChanged` at all | Step 4 | `NoTreeChange()` | `AttestedWorldID.t.sol :: `test_RevertsWhenThereIsNoTreeChange`` |
| Two genuine `TreeChanged` logs in one transaction, so the root to adopt is ambiguous | Step 4 | `AmbiguousTreeChange(count)` | `AttestedWorldID.t.sol :: `test_RevertsOnTwoGenuineTreeChangedLogs`` |
| Calldata that disagrees with the emitted log, or an unexpected selector | Step 6: selector must be `0x2217b211` or `0xea10fbbe`, and the decoded `preRoot` and `postRoot` words must equal the log topics | `CalldataLogMismatch()` | `AttestedWorldID.t.sol :: `test_RevertsWhenCalldataRootsDisagreeWithTheLog`` |
| A genuine but out-of-order root, skipping tree history | Step 7: `preRoot == latestRoot`, or `rootHistory[preRoot] != 0` for a historical side-fill | `UnknownPreRoot(preRoot)` | `AttestedWorldID.t.sol :: `test_SideFillRecordsHistoryWithoutMovingTheTip / test_AdvancesTheTipOnAChainedRoot`` |
| A root from a block shallow enough to be reorged away | Step 8: ChainInfo `0x0FD3` attested tip must be at least `FINALITY_DEPTH` (32) above the source block | `NotFinal(attestedTip, sourceBlock)` | `AttestedWorldID.t.sol :: `test_RevertsWhenTheSourceBlockIsNotFinalYet`` |
| A root attested by a thin or captured attestor set | Step 8: AttestorStash `0x0FD4` bonded attestor count must be at least `MIN_ATTESTORS` (3) | `ThinQuorum(have, want)` | `AttestedWorldID.t.sol :: `test_RevertsOnThinAttestorQuorum`` |
| Replay of a proof that was already relayed | `ASCBase` marks `processedQueries[queryId]`, where `queryId` derives from `calculateTxIndex` | `ASCBase` revert, reason contains "Query already processed" | `AttestedWorldID.t.sol :: `test_RevertsOnReplayOfTheSameQuery`` |
| Re-adopting a root already in history, to reset its timestamp | Step 9: World's `_receiveRoot` | `CannotOverwriteRoot()` | `AttestedWorldID.t.sol :: `test_RevertsWhenARootWouldBeOverwritten`` |
| An oversized batch, or a batch whose blocks are not in order | `executeBatch`: length at most 10, `blockHeights` non-decreasing | `BatchTooLarge` / `BatchOutOfOrder` (see note below) | `AttestedWorldID.t.sol :: `test_BatchRejectsMoreThanTen / test_BatchRejectsOutOfOrderHeights`` |

Every error name in this table is the name in the shipped contract; `contracts/abi/AttestedWorldID.json` is the machine-readable list.

### 1.2 Personhood (`HumanRegistry`)

| Threat | Where it is stopped | Error | Test |
|---|---|---|---|
| An invalid or garbage Groth16 proof | `WorldIDBridge.verifyProof` over the vendored `SemaphoreVerifier`, on the bn128 precompiles | `ProofInvalid()` | `HumanRegistry.t.sol :: `test_VerifyProofRejectsAGarbageProof`` |
| A proof against a root that was never relayed | `WorldIDBridge` root check, before the verifier is touched | `NonExistentRoot()` | `HumanRegistry.t.sol :: `test_RevertsOnAnUnknownPreRootAfterBootstrap`` |
| A proof against a root older than the one-week history expiry | `WorldIDBridge` root check | `ExpiredRoot()` | `HumanRegistry.t.sol :: `test_RootsExpireAfterOneWeek / test_AnAncientSideFilledRootArrivesAlreadyExpired`` |
| Front-running: taking someone else's proof from the mempool and registering it to your own wallet | The signal is `msg.sender`, so `signalHash` is bound to the caller. A stolen proof verifies for nobody else | `ProofInvalid()` | `HumanRegistry.t.sol :: `test_TheSignalHashIsCallerSpecific`` |
| Reusing a World ID proof issued for a different application or action | `EXTERNAL_NULLIFIER_HASH` is computed from `APP_ID` and the action `humanline-register` and fixed at construction | `ProofInvalid()` | `HumanRegistry.t.sol :: `test_ExternalNullifierMatchesTheProductionVector`` |
| One human registering twice to get two identities | The nullifier is the key. A second registration from a different wallet re-binds; it does not create a second human | none (re-bind is the intended path) | `HumanRegistry.t.sol :: `test_RebindMovesTheHumanToANewWallet`` |
| One wallet holding two humans | A wallet maps to at most one nullifier | `WalletAlreadyHuman(wallet, nullifierHash)` | `HumanRegistry.t.sol :: `test_RevertsWhenTheWalletAlreadyBelongsToAnotherHuman`` |
| Re-registering the same wallet to churn events | Same-wallet re-bind is refused | `SameWallet()` | `HumanRegistry.t.sol :: `test_RevertsOnRegisteringTheSameWalletTwice`` |

### 1.3 Credit (`CreditLine`)

| Threat | Where it is stopped | Error | Test |
|---|---|---|---|
| An unverified wallet opening a line | `REGISTRY.isHuman(msg.sender)` at `openLine`, and `humanOf` on every other entry point | `NotHuman(wallet)` | `CreditLine.t.sol :: `test_NonHumansCannotTouchTheLine`` |
| A human opening a second line from a second wallet | State is keyed by nullifier, not address | `LineExists(human)` | `CreditLine.t.sol :: `test_ASecondWalletCannotOpenASecondLine`` |
| A defaulted human coming back with a fresh wallet | The freeze is on the nullifier. Re-binding carries it | `LineFrozen(human)` | `CreditLine.t.sol :: `test_DefaultSurvivesAWalletRebind`` |
| Borrowing more than the limit | `availableCredit` check in `borrow` | `OverLimit(requested, available)` | `CreditLine.t.sol :: `test_BorrowingPastTheLimitReverts`` |
| Draining the pool past idle liquidity | Liquidity check in `borrow` and `withdraw` | `InsufficientLiquidity(requested, available)` | `CreditLine.t.sol :: `test_BorrowingMoreThanTheIdleBalanceReverts`` |
| Marking a healthy line as defaulted | `markDefault` requires `principal > 0` and `now > dueAt + GRACE` | `NotInDefault(human, dueAt, grace)` | `CreditLine.t.sol :: `test_MarkDefaultBeforeGraceEndsReverts`` |
| Repaying a line that owes nothing, or a zero-value call | Guards in `repay` and `borrow` | `NothingOwed(human)`, `ZeroAmount()` | `CreditLine.t.sol :: `test_ZeroAmountsRevert / test_RepayingNothingReverts`` |
| A third party repaying to inflate someone's standing | Repayment transfers from `msg.sender` and resolves the line through `humanOf(msg.sender)`, so a non-owner wallet has no line to repay | `NotHuman(wallet)` or `NoLine(human)` | `CreditLine.t.sol :: `test_NonHumansCannotTouchTheLine`` |
| Reentrancy through a malicious pool asset | State is written before any external transfer, and transfers use OpenZeppelin `SafeERC20` | none (ordering) | `CreditLine.t.sol :: `test_WithdrawIsLimitedToIdleLiquidity / test_ALenderCannotWithdrawUnearnedInterest`` |
| Share-price manipulation by a first depositor | First deposit mints one-to-one; later shares price against `totalAssets = idle balance + totalBorrowed` | none (accounting) | `CreditLine.t.sol :: `test_TwoLendersShareAWriteOffProRata / test_ADonationAttackCannotSkimTheNextDepositor`` |

### 1.4 Relay operation

| Threat | Where it is stopped | Error | Test |
|---|---|---|---|
| A malicious relayer submitting a fabricated root | The relayer has no privilege. Every submission goes through `0x0FD2` | Precompile revert | `AttestedWorldID.fork.t.sol :: `test_RevertsWhenTheProofIsRejected / testFork_BlockProverVerifiesTheMainnetFixture`` |
| A relayer censoring or reordering roots | Reordering is refused by the chain rule. Censorship is a liveness issue, and anyone may relay the skipped root | `UnknownPreRoot(preRoot)` | `relay.test.ts :: `worker: "orders by block then log index regardless of input order" / test_BatchRelaysInArrayOrder`` |
| A relayer front-running itself into wasted gas | The worker skips transactions whose `queryId` is already marked processed on chain before building a proof | none | `relay.test.ts :: `worker: "skips a decoy TreeChanged from another contract" + relay.test.ts already-processed classification`` |
| A stale proof at submission time, because the attested window moved | The worker refetches the proof once and retries, then records the failure without dropping the transaction | none | `relay.test.ts :: `worker relay.test.ts retry policy (refetch once, then failed)`` |
| A self-relay plan that asks a user to send something false | The plan only chooses what to send; `AttestedWorldID` re-checks every claim, and the app dry-runs the call with `eth_call` first | the contract's named revert | `web/test/relay-plan.test.ts`, `web/test/relay-proof.test.ts` |
| Farming `RelayReward` by relaying roots that do not matter | Paid only when the call moves the tip, the new tip is younger than `MAX_ROOT_AGE` by its source block, and at most 10 roots per call; a root can be relayed once | none (paid 0) | `RelayReward.t.sol :: test_ASideFillThatDoesNotMoveTheTipEarnsNothing, test_AStaleTipEarnsNothing, test_BootstrapThroughTheVaultPaysAtMostTenRoots, test_TheSameRootCannotBePaidTwice` |
| Draining `RelayReward` by re-entering during payment | Non-reentrant `relay` and `claim`; a failed transfer is credited to `claimable` and reserved out of `available()` | `Reentrancy()` | `RelayReward.t.sol :: test_ReentryDuringPaymentIsRefusedAndTheRewardIsCredited, testFuzz_NeverPaysMoreThanItHoldsOrOwes` |
| Triggering the scheduled relay to burn the relayer's gas | `/api/cron/relay` requires `Bearer $CRON_SECRET`, compared in constant time, and refuses everyone when the secret is unset | HTTP 401 | `web/test/relay-cron.test.ts` |

---

## 2. Trust assumptions

Four, and we do not pretend there are fewer.

### 2.1 The Attestcoin attestor set

Attestcoin's attestors observe source chains and attest to block headers. CC3 testnet currently runs four attestors with a quorum of three. Humanline enforces a floor of three bonded attestors through `AttestorStash` at `0x0FD4` and rejects a root if the set is thinner than that.

If a quorum of attestors colludes, they can attest to an Ethereum block that does not exist, and a fabricated World ID root would pass `verifyAndEmit`. Humanline inherits Attestcoin's security here and cannot do better than it. What we can do, and do, is refuse to accept roots when the set is thin and when the source block is shallow. The finality depth of 32 blocks means a colluding set would also have to survive Ethereum finality, not just a momentary fork.

This is the assumption every Attestcoin application makes. It is the reason the protocol's decentralization roadmap matters to us.

### 2.2 World's identity operator

Humanline proves that World's sequencer sent a `registerIdentities` transaction and that the tree root changed as the calldata says. It does not and cannot prove that an Orb saw a live human iris before that commitment was inserted.

If World inserted fabricated identity commitments, Humanline would register fabricated humans. If World deletes an identity, the human loses the ability to produce new proofs, though their existing registration and their outstanding debt remain. We are consuming World ID with exactly the trust model that every other World ID integration has, which is: World runs the Orb, and the Orb's biometric uniqueness claim is the thing being relied on.

What Attestcoin removes is the extra operator that would otherwise sit between World's tree and Creditcoin. It does not remove World.

### 2.3 The Semaphore circuit and its setup

Verification uses World's vendored `SemaphoreVerifier`, unmodified, from `world-id-state-bridge`. That is a Groth16 verifier over bn128, and Groth16 requires a trusted setup. If the toxic waste from World's ceremony survived, an attacker holding it can forge membership proofs for any root, including proofs that pass our verifier on Creditcoin.

We also assume Creditcoin's bn128 precompiles at `0x06`, `0x07` and `0x08` implement EIP-196, EIP-197 and EIP-1108 correctly. We verified that they answer correctly on CC3 and the fork test suite exercises the real ones, but a subtle divergence in a precompile would be a verification bug we would not catch from Solidity.

### 2.4 Liveness, which is not trust

If nobody runs the relay, no new roots arrive, the newest World ID users cannot register, and existing users cannot produce proofs against roots that have expired out of the one-week history. Nothing is lost, nothing is stolen, and the moment anyone runs the worker the chain of roots resumes from where it stopped.

This is a liveness dependency, not a trust dependency, and the difference matters. It is now covered four ways, none of which needs the others: Vercel Cron runs a relay pass every five minutes; the GitHub Actions workflow is an independent backup; any user whose root has not arrived can relay it from their own wallet in the verify card; and the `RelayReward` vault pays anyone who carries a fresh root, so a third party has a reason to run the public worker. `/api/relay/health` reports when a relayable root has waited past the ten-minute target.

---

## 3. Known limitations

**Attestcoin is read-only today.** Writability, meaning Creditcoin pushing messages out to other chains, is in audit and not available on testnet. Humanline is one-directional by necessity: Ethereum state comes in, nothing goes back out.

**There are no absence proofs.** Attestcoin can prove a transaction happened. It cannot prove one did not. This is why a default is declared from a passed deadline plus the absence of a repayment on Creditcoin, which is native state we can read directly, rather than from any claim about Ethereum. We do not fake an absence proof anywhere.

**Roots lag.** Source finality plus attestation has been measured at roughly 6.5 to 9.3 minutes on Sepolia, and mainnet is similar. Add the worker's poll interval and the finality depth of 32 blocks. A human verified by an Orb minutes ago cannot register on Creditcoin until their root arrives. This is correct behavior, and it is visible as the attestation lag column on `/relay`.

**Root history expires after one week.** This is World's own constant and we kept it. A proof built against a root older than a week fails with `ExpiredRoot`. Clients must build proofs against a recent root. If the relay stops for more than a week, registration stops working until it resumes and a fresh root lands.

**A freeze is permanent and there is no appeal.** There is no owner, so there is nobody to unfreeze a line, including us. That is the design: a default that can be negotiated away is not a default. It is also a genuine product limitation, and a production version would want a lender-controlled cure path defined in the contract from the start rather than an admin key added later.

**Sybil resistance is exactly World's sybil resistance.** If one person obtains two Orb verifications, they get two nullifiers and two credit lines. Humanline's guarantee is "one World ID, one line", not "one biological human, one line". Those coincide only as well as the Orb does.

**The nullifier is public and permanent.** It is action-scoped, so it cannot be correlated with the same person's activity in other World ID applications, and it reveals nothing about who the person is. But a default is attached to it forever and visible to everyone. That is the mechanism working, and it is also a permanent public record of a financial failure attached to a stable identifier. A production deployment should think hard about a time-based decay of the visible record, even if the freeze itself is permanent.

**World ID 3.0 dependency.** We verify Semaphore proofs from World ID's 3.0 tree. World ID 4.0 is live with verification on World Chain, and IDKit must be asked for legacy proofs. No sunset date has been announced, but the dependency is real, and the roadmap answer is proving World Chain output roots through their Ethereum postings.

**Batch limits are the protocol's.** At most 10 proofs share one continuity proof, inside a 1000-block window. A burst of tree activity takes several transactions to relay.

**`hUSD` is a test token.** Lender deposits are testnet funds and pool losses are testnet losses. No economic claim in this repository has been tested with real money.

**The relay is single-operator today.** See 2.4. It is a liveness dependency and we are honest about it rather than describing one worker as decentralized.

---

## 4. Responsible disclosure

If you find a vulnerability in Humanline, please report it privately before disclosing it publicly.

**How to report.** Open a private security advisory at `https://github.com/rajkaria/humanline/security/advisories/new`. That channel is private to the maintainers until a fix ships. If you cannot use GitHub advisories, open a public issue containing only a request for a contact address and no details of the finding.

**What to include.** The contract or file, the conditions required, and a proof of concept if you have one. A failing Foundry test is the most useful form, and this repository is set up to run one against the CC3 fork.

**What we commit to.** Acknowledgement within 72 hours. An assessment with a severity and a plan within 7 days. Credit in the fix commit and in the release notes unless you ask us not to.

**Scope.** In scope: `contracts/src/`, the relay worker in `worker/`, and the web application in `web/`. Out of scope: the vendored World ID bridge and Semaphore verifier under `contracts/vendor/worldid/` (report those to World), the Attestcoin Protocol precompiles and SDK (report those to Gluwa and Credit Labs), and the Creditcoin node itself.

**A note on the contracts.** There is no owner, no pause and no upgrade path. A vulnerability in a deployed contract cannot be patched in place. The response to a critical finding is to deploy a corrected contract, publish the new addresses, and tell users to migrate. Anyone relying on `IHumanRegistry` should read the registry address from a source they control rather than hardcoding ours, so that a migration is a configuration change for them and not a redeploy.

**Prior art we benefited from.** Another submission in this hackathon, Deadswitch, published two vulnerabilities in the common `ASCBase` integration pattern and filed them upstream. The decoy-log handling in step 4 of our relay, where a foreign `TreeChanged` is skipped rather than treated as fatal, exists because of that work. Credit where it is due.
