<div align="center">

<img src="docs/screenshots/hero.png" alt="Humanline: one human, one credit line" width="100%">

# Humanline

### One human, one credit line.

**World ID proof of personhood, carried from Ethereum to Creditcoin by the Attestcoin Protocol with no bridge and no oracle in between, verified by a zero-knowledge proof on Creditcoin itself, and turned into an uncollateralized credit line that follows the person, not the wallet.**

[![Live](https://img.shields.io/badge/live-humanline.credit-0ea5e9)](https://humanline.credit)
[![Chain](https://img.shields.io/badge/Creditcoin_CC3-chainId_102031-1f2937)](https://creditcoin-testnet.blockscout.com)
[![Contracts](https://img.shields.io/badge/contracts-12_verified_on_Blockscout-16a34a)](#live-addresses)
[![Attacks](https://img.shields.io/badge/live_attacks-12%2F12_refused-dc2626)](https://humanline.credit/judge)
[![Coverage](https://img.shields.io/badge/coverage-93.6%25_lines-16a34a)](docs/MEASUREMENTS.md)
[![Mutation](https://img.shields.io/badge/mutation_score-95.8%25-16a34a)](docs/MEASUREMENTS.md)
[![SDK](https://img.shields.io/badge/npm-%40humanline%2Fsdk-cb3837)](packages/sdk)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[![contracts](https://github.com/rajkaria/humanline/actions/workflows/contracts.yml/badge.svg)](https://github.com/rajkaria/humanline/actions/workflows/contracts.yml)
[![worker](https://github.com/rajkaria/humanline/actions/workflows/worker.yml/badge.svg)](https://github.com/rajkaria/humanline/actions/workflows/worker.yml)
[![web](https://github.com/rajkaria/humanline/actions/workflows/web.yml/badge.svg)](https://github.com/rajkaria/humanline/actions/workflows/web.yml)
[![live attacks](https://github.com/rajkaria/humanline/actions/workflows/attacks.yml/badge.svg)](https://github.com/rajkaria/humanline/actions/workflows/attacks.yml)

**[Live app](https://humanline.credit/app)** · **[Judge page, no wallet needed](https://humanline.credit/judge)** · **[Relay feed](https://humanline.credit/relay)** · **[One person, one vote](https://humanline.credit/vote)** · **[Public API](https://humanline.credit/api)** · **[SDK](packages/sdk)** · **[Deck](docs/deck.pdf)** · **[Attestcoin write-up](docs/ATTESTCOIN_INTEGRATION.md)**

Built by **Raj Karia** · [X @rajkaria_](https://x.com/rajkaria_) · [GitHub @rajkaria](https://github.com/rajkaria)

BUIDL CTC 2026 Fall · DeFi track · Creditcoin CC3 testnet

</div>

---

## The thirty-second version

- **Every uncollateralized credit design on Creditcoin scores a wallet. A wallet is free.** Open ten, repay yourself ten times, default on the eleventh at full size. Humanline scores the person.
- **The person is a World ID nullifier**, derived from an Orb iris scan. It is the same value on every wallet the person will ever hold. Credit limits, repayment history and defaults are keyed to it, so a new keypair is not a new borrower.
- **World ID's tree lives on Ethereum. Creditcoin cannot see it.** Humanline mirrors it with the Attestcoin Protocol: every root arrives as a proof of the real Ethereum transaction that produced it, verified by the `0x0FD2` precompile inside the same Creditcoin transaction that adopts it. No bridge operator, no oracle signer, no admin key.
- **The zero-knowledge proof is verified on Creditcoin itself**, on the bn128 precompiles. Groth16 on Creditcoin was an open question. It is now a deployed contract with real humans in it.
- **Attestcoin is load-bearing 22 different ways**, including one nobody else has tried: the attestors' bonded stake, read live from `0x0FD4`, caps how much the pool may lend.
- **Nothing here asks for trust.** Anyone can relay, from the app, from a wallet funded only by the faucet, or through a vault that pays them. Twelve named attacks are fired at the deployed contracts every time the judge page loads. Coverage, invariants, mutation score, gas curves and latency are published from chain data.
- **Personhood ships as a primitive**: `@humanline/sdk` on npm, `HumanGated.sol`, a CORS-open public API with a loan-lifecycle feed, and `HumanPoll`, one person one vote, built on nothing but the SDK.

---

## Contents

1. [Why Humanline has to exist](#why-humanline-has-to-exist)
2. [The insight: the nullifier is the human](#the-insight-the-nullifier-is-the-human)
3. [What we built](#what-we-built)
4. [How each technology is used at its core](#how-each-technology-is-used-at-its-core)
5. [Why it is the deepest Attestcoin integration on Creditcoin](#why-it-is-the-deepest-attestcoin-integration-on-creditcoin)
6. [Why it is the strongest World ID integration anywhere off Ethereum](#why-it-is-the-strongest-world-id-integration-anywhere-off-ethereum)
7. [A relay nobody has to trust or wait for](#a-relay-nobody-has-to-trust-or-wait-for)
8. [Cross-chain credit identity](#cross-chain-credit-identity)
9. [Build on it: the SDK, the API, the first app](#build-on-it-the-sdk-the-api-the-first-app)
10. [Proof, not promises](#proof-not-promises)
11. [Verify it yourself in five minutes](#verify-it-yourself-in-five-minutes)
12. [Live addresses](#live-addresses)
13. [Repository layout](#repository-layout)
14. [Getting started](#getting-started)
15. [Where this goes](#where-this-goes)
16. [What is testnet-only, and what we do not claim](#what-is-testnet-only-and-what-we-do-not-claim)
17. [Team and license](#team-and-license)

---

## Why Humanline has to exist

**Creditcoin's mission is credit history for people the banking system cannot see.** The ledger exists. Credal gives lenders a way to write loans to it. Aella runs buy-now-pay-later for more than a million users on top of it. What none of that answers is the oldest question in unsecured lending: *is this the same person who borrowed last time, and is there exactly one of them?*

**Every uncollateralized design on the chain has the same hole underneath it: a wallet is not a person.** A borrower opens ten wallets, repays themselves ten times, mints ten spotless credit passports, and defaults on the eleventh loan at full size. The score was real. The person behind it was not. That is why "uncollateralized" lending keeps quietly asking for collateral from exactly the people who have none.

When we surveyed the BUIDL CTC gallery it held eighty-seven submissions. About thirty were credit passports built on the same pattern: read repayments on a testnet, mint a score. Zero touched identity. Zero used a zero-knowledge proof. Zero did proof of personhood. Every one of those passports can be forged by *generating a new wallet*. Not hacked. Generated.

**Proof of personhood already exists, and it is already in Creditcoin's markets.** World ID's Orb-verified population is concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia. That is the map Creditcoin's mission describes. The obstacle was never adoption. It was plumbing: World ID's identity tree lives on Ethereum, and the only ways to bring it to another chain have been a trusted bridge or a trusted oracle, which is precisely the kind of party a credit system for the unbanked should not rest on.

**Attestcoin removes both.** Creditcoin's BlockProver precompile verifies that a specific Ethereum transaction, with its receipt, sits in a block Creditcoin's attestors have signed. So a World ID root can arrive on Creditcoin as a proof of the real `registerIdentities` transaction that produced it, and a contract can adopt it without asking anyone to vouch. That single capability is the reason Humanline can exist without an operator, and it is why Humanline is built on Creditcoin rather than anywhere else.

---

## The insight: the nullifier is the human

A World ID nullifier is derived from an Orb iris scan and an action string. It reveals nothing about the person and it is the same value whatever wallet they use, whatever chain they move to, whatever key they lose.

Humanline keys **every piece of credit state** to that nullifier and never to an address:

| | Wallet-scored credit passports | Humanline |
|---|---|---|
| The thing being scored | an address | a human |
| Cost to reset the score | one new keypair, free | a second iris |
| Re-bind to a new wallet | new borrower, clean slate | same borrower, same limit, same history |
| A default | erased by the next wallet | frozen on the person, forever, on every wallet |
| Second line from a second wallet | granted | refused with `LineExists` |
| Who guarantees the identity data | a bridge operator or oracle | an Attestcoin proof verified on-chain |
| Admin keys | usually | none, anywhere |

Re-registering from a new wallet *moves* the binding. It never mints a second human. Default, and `LineFrozen` attaches to the nullifier and travels with it. The test that pins this, `test_DefaultSurvivesAWalletRebind`, is the single most important test in the repository.

The forgery that breaks every other credit passport costs nothing. Forging a Humanline identity costs a second iris.

---

## What we built

Twelve verified contracts across two live deployments, a relay worker, a web app with nine pages and fourteen API routes, an npm package, a public API, and a second consumer app, all running unattended on Creditcoin CC3 testnet.

```
ETHEREUM MAINNET (chainKey 3)             CREDITCOIN CC3 TESTNET (chainId 102031)
┌──────────────────────────────┐          ┌──────────────────────────────────────────────┐
│ WorldIDIdentityManager (Orb) │          │ 0x0FD2 BlockProver   0x0FD3 ChainInfo         │
│ 0xf7134CE1…bddEa             │          │ 0x0FD4 AttestorStash 0x06/07/08 bn128         │
│ registerIdentities() ~hourly │  proofs  ├──────────────────────────────────────────────┤
│ emits TreeChanged(pre,kind,  │ ───────▶ │ AttestedWorldID (ASCBase + WorldIDBridge)     │
│        post)                 │ anyone   │  · verifyAndEmit → decode calldata + log     │
└──────────────────────────────┘          │  · preRoot must chain to a known root         │
ETHEREUM SEPOLIA (chainKey 1)             │  · finality (0xFD3) + quorum (0xFD4) guards   │
┌──────────────────────────────┐          │  · rootHistory, 1-week expiry                 │
│ Staging identity manager     │ ───────▶ │  · IWorldID.verifyProof (Semaphore, bn128)    │
│ 0xb2ead588…7076 (simulator)  │          ├──────────────────────────────────────────────┤
└──────────────────────────────┘          │ HumanRegistry   nullifier ⇄ wallet            │
                                          │ CreditLine      one line per nullifier,       │
   World App / IDKit / Simulator ──ZK──▶  │                 capped by attestor bonds      │
                                          │ RelayReward     pays anyone who relays        │
   Linked Ethereum wallets ──proofs──▶    │ HumanLinks · CreditHistory · EthRepay         │
   (self-send, Aave V3, USDC)             │ HumanGated → HumanGate, HumanPoll             │
                                          └──────────────────────────────────────────────┘
```

### The ledger of what is shipped

| Layer | What it is | Where | How you know it is real |
|---|---|---|---|
| **`AttestedWorldID`** ×2 | World's own `WorldIDBridge` and `SemaphoreVerifier`, vendored unmodified, with the trusted state bridge replaced by Attestcoin proofs. One instance mirrors Ethereum mainnet's Orb tree, one mirrors Sepolia's staging tree. Exposes the same `IWorldID.verifyProof` every World ID integration already uses. | `contracts/src/AttestedWorldID.sol` | 61 roots relayed and counting, each with an Attestcoin proof in the receipt. [Live feed](https://humanline.credit/relay). |
| **`HumanRegistry`** ×2 | Verifies a Semaphore Groth16 proof natively on Creditcoin against an Attestcoin-delivered root and binds the nullifier to a wallet. The signal is the caller, so a proof cannot be lifted from the mempool. | `contracts/src/HumanRegistry.sol` | Real World ID proofs verified on CC3, [`evidence/e2e-worldid-staging.md`](evidence/e2e-worldid-staging.md). |
| **`CreditLine`** v2 ×2, v3 | One revolving line per nullifier from an open lender pool. 25 hUSD to start, ×1.25 per on-time term, halved when late, capped at 2,000. Total outstanding principal capped by the attestors' bonded stake from `0x0FD4`, read on every draw. v3 adds a limit boost from proven Aave history and `repayFor` for Ethereum-side repayments. | `contracts/src/CreditLine.sol` | Full borrow → repay → limit-growth loop on chain, [`evidence/e2e-credit-loop-v2.log`](evidence/e2e-credit-loop-v2.log). |
| **`RelayReward`** | A permissionless vault that forwards to `executeBatch` and pays 0.002 tCTC per fresh root the call recorded. No owner, no withdrawal. | `contracts/src/RelayReward.sol` | A wallet created seconds earlier relayed a root through it and was paid, [`evidence/self-relay.jsonl`](evidence/self-relay.jsonl). |
| **`HumanLinks`** | Binds a human's Ethereum wallets to their Creditcoin identity, by an Attestcoin-proven self-send on Ethereum or an EIP-712 signature. A wallet belongs to one human forever; a human holds at most 8. | `contracts/src/HumanLinks.sol` | Tested against real Sepolia proofs the live `0x0FD2` accepts. |
| **`CreditHistory`** | Imports Aave V3 `Borrow` and `Repay` events from linked wallets, with anti-wash rules, and turns verified repaid dollars into a limit boost. The official Attestcoin Loan Flow pattern pointed at the largest real lending protocol. | `contracts/src/CreditHistory.sol` | A real 120 USDC Aave borrow and its 85.23 USDC repayment, proven. |
| **`EthRepay`** | Repay a Creditcoin line by sending USDC on Ethereum. The `Transfer` is proven through Attestcoin and settled on the line. | `contracts/src/EthRepay.sol` | A real Circle USDC transfer, proven and applied. |
| **`ProvenSource`** | The shared base every non-root proof goes through: `0x0FD2` inclusion, `0x0FD3` finality, `0x0FD4` quorum, receipt status, and the chain id the transaction was *signed for*. | `contracts/src/ProvenSource.sol` | 92 named custom errors across the suite, each with a test. |
| **`HumanGated.sol`** | `onlyHuman` and `oncePerHuman(scope)` modifiers. Twenty lines to make any contract one human, one action. | `contracts/src/sdk/HumanGated.sol`, shipped in the npm package | `HumanGate` and `HumanPoll` inherit nothing else. |
| **`HumanPoll`** ×2 | One person, one vote. A second wallet does not buy a second ballot. | `contracts/src/examples/HumanPoll.sol` | [humanline.credit/vote](https://humanline.credit/vote), Blockscout-verified on both trees. |
| **`hUSD`** | Six-decimal test stablecoin the pool lends, with a faucet. | `contracts/src/HUSD.sol` | Shared by both deployments. |
| **Relay worker** | Bun CLI: `check`, `bootstrap`, `prove`, `relay`, `local-proof`, `proof-diff`, `attack`, `measure`, `status`. Builds proofs locally with usc-sdk and falls back to the hosted prover; batches up to 10 updates under one continuity proof. | `worker/` | Every command is read-only or dry-run without a key. |
| **Always-on relay** | Vercel Cron every 5 minutes, GitHub Actions as backup, a watchdog at `/api/relay/health` that returns `503` when a relayable root is late, and an alert webhook. | `web/app/api/cron/relay` | Uptime and latency published on [`/relay`](https://humanline.credit/relay). |
| **Self-relay** | When a proof's root has not reached Creditcoin yet, the verify card plans the missing updates, builds the proof, dry-runs it, and the user's own wallet sends it. Also a CLI. | `web/lib/hooks/use-self-relay.ts`, `web/scripts/self-relay.ts` | Two live self-relays from fresh wallets, one paid by the vault. |
| **Web app** | `/`, `/app` (verify, borrow, repay, lend, link, import history, repay from Ethereum), `/relay`, `/judge`, `/vote`, `/docs`, `/api`, `/h/{human}`. Auto gas drip for first-time wallets. | `web/` | [humanline.credit](https://humanline.credit) |
| **`@humanline/sdk`** | `isHuman`, `humanOf`, `lineOf`, `profileOf` over any viem client, a `useHuman` React hook, `HumanGated.sol`. | `packages/sdk` | `npm install @humanline/sdk viem` |
| **Public API** | `GET /api/v1/human/{address}`, `/api/v1/line/{nullifier}`, `/api/v1/feed`. CORS open, OpenAPI 3.1. | `web/app/api/v1` | [humanline.credit/api](https://humanline.credit/api) |
| **Prover independence** | Proofs built from any Ethereum RPC match the hosted prover byte for byte. The browser recomputes every Merkle path and continuity fold and matches it against `0x0FD3` before anything is signed. | `worker/src/local-proof.ts`, `web/lib/relay/verify-proof.ts` | [`evidence/proof-diff.jsonl`](evidence/proof-diff.jsonl); *Verify a proof in your browser* on `/judge`. |
| **Rigor** | 12 stateful invariants, fuzzing, 93.6% line coverage, 95.8% mutation score, Slither triaged, CodeQL, gitleaks, a submission checker that resolves every cited address and URL. | `.github/workflows`, `scripts/` | [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) |

Two deployments run side by side against the **same** relayed roots, because "a real human can use this" and "you can check it yourself" need different trees:

| Deployment | Verifies proofs against | Who can register | Terms | Open |
|---|---|---|---|---|
| Reproducible | World's **Sepolia staging** tree | anyone, via the [World ID Simulator](https://simulator.worldcoin.org) | 10 min term, 5 min grace | [humanline.credit/app](https://humanline.credit/app) |
| Real | World's **Ethereum mainnet Orb** tree | anyone with an Orb-verified World ID | 30 day term, 7 day grace | [humanline.credit/app?profile=production](https://humanline.credit/app?profile=production) |

The switch is on the page. You are never asked to trust that the other one exists.

**No owner, no pause, no upgrade path, in any contract.** Every parameter is an immutable set at construction. There is nobody to appeal to, including us. That is the design.

---

## How each technology is used at its core

Humanline is not a product with integrations bolted on. Each technology below is doing the one thing it was built to do, at the layer where removing it would collapse the system.

### Attestcoin Protocol: the only door a root can walk through

Attestcoin proves exactly two things about an Ethereum transaction: **inclusion** (these bytes sit at this index of this block) and **continuity** (that block belongs to the chain Creditcoin's attestors signed). It deliberately proves nothing else. `verifyAndEmit` returning `true` does not mean the transaction succeeded, went to the right contract, emitted the event you care about, carries the next root in sequence, is deep enough to be final, or was attested by a healthy set.

Every one of those is Humanline's job, and every one is enforced in `AttestedWorldID` with a named revert:

| Not proven by Attestcoin | Humanline's check | Reverts with |
|---|---|---|
| The source transaction succeeded | `decodeReceiptFields` status must be 1 | `SourceTxReverted()` |
| It went to World's identity manager | `decodeCommonTxFields(tx).to == IDENTITY_MANAGER` | `NotIdentityManager(to)` |
| `TreeChanged` came from that manager | logs filtered by emitter, exactly one survivor (decoys skipped, not fatal) | `NoTreeChange()`, `AmbiguousTreeChange(n)` |
| Calldata agrees with the log | selector and both root words cross-checked against the topics | `CalldataLogMismatch()` |
| The root is next in sequence | `preRoot` must be the tip or a known historical root | `UnknownPreRoot(preRoot)` |
| The block is final | ChainInfo `0x0FD3` tip must be 32 attested blocks above it | `NotFinal(tip, block)` |
| A real attestor set backed it | AttestorStash `0x0FD4` bonded count ≥ 3 | `ThinQuorum(have, want)` |
| It was not relayed before | `calculateTxIndex` → query id, recorded once, shared across `execute` and `executeBatch` | `QueryAlreadyProcessed(id)` |
| The root is fresh | dated by its **source block**, not by arrival | `ExpiredRoot()` on use |

The batch overload of `verifyAndEmit`, which `ASCBase` does not use, is exposed through a custom `executeBatch`: up to 10 updates under one shared continuity proof, the protocol's 10-transaction and 1,000-block limits enforced on chain, heights required non-decreasing, and every member deduplicated by the same 72-byte query-id preimage as the single path. A live dry run of 24 hours of Sepolia activity collapsed 29 transactions into 7 submissions.

`EvmV1Decoder` is used both ways: the receipt for the `TreeChanged` log, and the calldata for an *independent* decode of `registerIdentities` and `deleteIdentities` at fixed word offsets. The calldata is where `humansAdded` comes from, so the "identities carried" counter on the landing page is derived from Ethereum's own bytes, never from a database.

Then the surface nobody else has used: **`0x0FD4` as a lending parameter.** The deepest assumption under every loan is the attestor quorum for the World ID source chain. A quorum that attested a fake Ethereum block could mint a fake human and borrow. So `CreditLine` never lets total outstanding principal exceed what that quorum has bonded:

```
cap = getAttestorsCount(chainKey) × getMinBondRequirement(chainKey) × 10 hUSD per CTC
```

read live on every draw. More attestors or a higher bond raise the ceiling. A thinning set lowers it. A set that reports zero stops new draws entirely, while repayments, withdrawals and defaults are never blocked. On testnet that is a 7,000 hUSD ceiling on the staging pool and 4,000 hUSD on the Orb pool. The constructor also asserts through `get_chain_by_key` that chainKey 3 really is Ethereum (chainId 1) and chainKey 1 really is Sepolia (11155111), so the security budget can never be read from the wrong chain by a copy-paste mistake.

The full table of **22 load-bearing surfaces**, each with `file:line`, what it decides, and the test that proves it, is in [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) section 2.0. Counted strictly: an interface we declared but do not depend on is listed separately and not counted.

### World ID: consumed the way World intended, de-trusted the way Attestcoin allows

`AttestedWorldID` **is** World's `WorldIDBridge` and `SemaphoreVerifier` from `world-id-state-bridge`, MIT, vendored byte-for-byte unmodified. World's bridge expects roots to be handed to it by a trusted state bridge. We replaced that single entry point with `ASCBase.execute` plus a proof from `0x0FD2`. Everything else, `rootHistory`, the one-week expiry, `verifyProof`, is World's own code. That means any protocol with a bridged-root design can be de-trusted the same way, which is a much larger claim than Humanline.

Because the contract still exposes `IWorldID.verifyProof`, every existing World ID integration pattern works against it unchanged. IDKit in the browser, World App on a phone, and the World ID Simulator for judges all produce proofs `HumanRegistry` verifies with the wallet address as the signal, scoped to the `humanline-register` action, so a proof is bound to one caller and one purpose.

Two trees are mirrored on purpose. Sepolia staging, so anyone can reproduce personhood end to end with the simulator and no Orb. Ethereum mainnet Orb, so a real verified human can use the real product with 30-day terms.

### Creditcoin CC3: Groth16 verified natively, three precompiles in the hot path

Zero-knowledge on Creditcoin was an open question when this started. The bn128 precompiles at `0x06`, `0x07` and `0x08` answer correctly on CC3, so a Semaphore proof is checked in one Creditcoin transaction, natively, rather than through a relayer's attestation. A known-answer fork test pins it.

All three Attestcoin precompiles sit in the hot path, and the fourteen live fork tests read the real ones: `0x0FD2` returns `true` for both proof fixtures and agrees the mainnet transaction index is 173; `0x0FD3` tracks chainKey 3 as Ethereum and chainKey 1 as Sepolia with their attested tips; `0x0FD4` reports the bonded attestor counts against the floor of 3.

CC3 is a Substrate/Frontier chain, and we learned its edges: block headers carry no `mixHash`, so Foundry cannot build a local EVM from a CC3 RPC and `forge script` cannot target it. The deploy path uses `cast send --create`, the fork tests talk to the node over `vm.rpc`, and `script/Deploy.s.sol` remains the tested, canonical description of the deployment.

### Semaphore and zero knowledge: the proof says "I am in the tree", not who

The borrower proves membership in the World ID tree without revealing which leaf they are. What comes out is a nullifier, stable per (app, action), which is exactly the property a credit system needs: unlinkable across apps, unforgeable within ours, and the same for the person forever.

### Aave V3, USDC and EIP-712: a credit identity that reaches back into Ethereum

`CreditHistory` proves Aave V3 `Borrow` and `Repay` logs from linked wallets. `EthRepay` proves a USDC `Transfer` to the repayment address. `HumanLinks` accepts either an Attestcoin-proven self-send or an EIP-712 `Link` signature, domain-bound to this chain and contract with a deadline. All three go through `ProvenSource`, which reads the chain id the transaction was *signed for* from the type-specific chunk (`decodeTransactionType2`, EIP-155 `v`, or the typed layout) and refuses unprotected legacy transactions, so a signature valid on another chain can never stand in for this one.

### Foundry, Bun, Next.js, Vercel

Solidity 0.8.28 with `via_ir` (required: `EvmV1Decoder` is stack-too-deep under legacy codegen), forge fuzzing and invariant testing with anti-vacuity guards, and a scratch-copy coverage build that annotates every assembly block `("memory-safe")` so via-IR can move stack slots to memory. Bun and TypeScript for the worker, `@gluwa/usc-sdk` 0.18 for local proof building, ethers v6, `bun:sqlite` for the relay cursor. Next.js 15 App Router, Tailwind, shadcn/ui, wagmi and viem, `@worldcoin/idkit`, on Vercel with a five-minute cron.

---

## Why it is the deepest Attestcoin integration on Creditcoin

Depth is not a count. It is dependency. Remove Attestcoin from Humanline and there is no root, therefore no verified human, therefore no credit. There is no degraded mode, no admin setter, no fallback path.

What only Humanline does:

| | |
|---|---|
| **Proof of personhood** | A World ID zero-knowledge proof verified on Creditcoin against roots Attestcoin delivered. Credit, votes and claims are keyed to the human. A new wallet is not a new person. |
| **Economic security from `0x0FD4`** | Total credit is capped by the attestors' bonded stake, read live on every draw. The protocol's security budget becomes a lending parameter. |
| **Another protocol's state root, not a token transfer** | Attestcoin's readability set turns out to be sufficient for identity: the log gives the roots, the calldata cross-checks them and counts the humans, receipt status rejects reverts, `calculateTxIndex` gives ordering and replay. No state proof, no storage proof, no absence proof needed. |
| **Two source chains, one code path** | Ethereum mainnet for Orb roots, Sepolia for staging, identical bytecode, both live on `/relay`. |
| **A relay nobody has to trust or wait for** | Self-relay from the user's wallet, a vault that pays third-party relayers, a 5-minute cron, a watchdog. |
| **Prover independence** | Proofs built locally from any Ethereum RPC match the hosted prover byte for byte. The browser re-verifies every proof against `0x0FD3` before a wallet signs. |
| **Four kinds of proven payload** | World ID tree updates, wallet-link self-sends, Aave V3 borrow and repay events, and USDC transfers, each through the same precompile with its own replay key. |
| **Refusals you can watch** | Twelve attacks fired at the deployed contracts on every load of the judge page, re-run in CI every six hours. |
| **Measured, not asserted** | Gas regression across batch sizes, the 10/11 cap probed live, `verify` gas as a function of continuity roots, latency distribution, proof size distribution, and Humanline's share of all `0x0FD2` traffic on CC3. |
| **A primitive for the ecosystem** | `HumanGated.sol`, `@humanline/sdk`, a public API with a Credal-shaped loan feed, and `HumanPoll` built on them. |

And it fits the mission Creditcoin describes for itself. Credal lenders do not have to move their book, change their contracts or trust us. They add one read: is this borrower a unique human, and what is their Humanline history. `CreditLine` emits a loan lifecycle shaped like Credal's, so a lender indexing Credal events can index Humanline events with the same code. The first lender gets sybil resistance. The second gets sybil resistance plus the defaults the first one recorded, because a freeze attaches to the nullifier and is visible to everyone. Ten lenders sharing one personhood layer is a shared credit bureau that no single party operates, which is close to Creditcoin's founding description of itself.

---

## Why it is the strongest World ID integration anywhere off Ethereum

- **It is the first path from World ID into Creditcoin that adds no operator.** Every other cross-chain World ID deployment rests on a state bridge someone runs. Humanline rests on a proof anyone can produce and a precompile anyone can call.
- **It de-trusts World's own bridge code without modifying it.** The vendored `WorldIDBridge` is unchanged. The change was the root source, and nothing else. That is a reusable recipe for any bridged-root protocol.
- **It keeps World's interface.** `IWorldID.verifyProof` is the same call World's own docs teach. Integrators on Creditcoin can copy any World ID tutorial and point it at `AttestedWorldID`.
- **It honours World's own constants.** The one-week root expiry now bites correctly because roots are dated by their source block, not by when a relayer happened to arrive.
- **It handles both of World's trees.** Staging for reproducibility, Orb for real humans, with the World Developer Portal app and action fixed at construction so a proof issued for another app verifies for nobody.
- **It uses personhood for what personhood is for.** Not a badge. A credit line, a vote, a one-per-human claim, and a permanent consequence for default. World ID's Orb footprint and Creditcoin's lending footprint are the same countries. Every new Orb verification in Nairobi or Buenos Aires is a potential borrower who needs no new app and no new KYC.
- **It has a path for World ID 4.0.** Verification for 4.0 lives on World Chain, an OP-Stack rollup whose output roots are posted to Ethereum, which Attestcoin already attests. Proving that posting proves the rollup. We call this Periscope, and it gives Attestcoin reach into every OP-Stack rollup, not just World Chain. Humanline is the first application that needs it.

---

## A relay nobody has to trust or wait for

A relayer is a liveness dependency even when it is not a trust dependency. Humanline removes it three ways.

**Self-relay, in the app.** World mints a proof against its newest root, which may not have reached Creditcoin yet. When it has not, the verify card's Sync step offers *Relay it now from your wallet*. `/api/relay/plan` finds the `TreeChanged` transaction whose `postRoot` is the proof's root by its indexed topic, walks the `preRoot → postRoot` chain back to the root Creditcoin already follows, and splits the gap into `executeBatch` calls of at most 10 members within one continuity span. If the update is still shallower than the 32-block finality depth it shows how many attested blocks are left and an ETA, using `is_height_attested` and the same ChainInfo reads the contract uses. `/api/relay/proof` builds the proof, the browser dry-runs it with the precompile's free `verify` view and then `eth_call`, tops up an empty wallet from `/api/gas`, and the user's own wallet sends it. The contract re-checks everything, so the planner cannot talk anyone into relaying a false root.

It has run live, from nothing: a wallet generated seconds earlier, holding 0.05 faucet tCTC, carried Sepolia root `0x041e604b…` to Creditcoin in [`0xd1df2b92…`](https://creditcoin-testnet.blockscout.com/tx/0xd1df2b9251ff67d1487580ffc21bd9e6f02296ebfb0d2339222b9ee816ba6e85), ahead of the scheduled relayer. The same path runs from the command line: `cd web && bun run scripts/self-relay.ts --send --fresh`.

**A reason for strangers to relay.** `RelayReward` ([`0x9766480a…`](https://creditcoin-testnet.blockscout.com/address/0x9766480a872ad7df2a5cf86f9e307804a3f7afe0), funded with 25 tCTC, Blockscout-verified) forwards `executeBatch` to `AttestedWorldID` and pays the caller 0.002 tCTC per root the call recorded, from anyone's donations. It never judges a proof: the precompile and the relay contract do, and the vault pays only for what they demonstrably changed, the `rootCount` delta. Farming is closed by construction: a root can be relayed once, a call earns only if it moves the tip to a root younger than 6 hours by its source block, and at most 10 roots are paid per call. No owner, no withdrawal; a relayer that cannot receive tCTC is credited and claims later. The second fresh-wallet self-relay went through the vault and was paid, on chain: [`0xe0832863…`](https://creditcoin-testnet.blockscout.com/tx/0xe08328635b73d3eb0a3f1e13a9cc9df4538824ca017efbe67b6e0ca68a63fb4c).

**An always-on relay, measured.** Vercel Cron calls `/api/cron/relay` every 5 minutes with a constant-time-compared bearer secret. It runs one pass for both source chains through the same planner and proof code as self-relay; GitHub Actions is the backup and the cron route can dispatch it. [`/relay`](https://humanline.credit/relay) publishes the track record recomputed from chain data: end-to-end latency from source block to root on Creditcoin, relay delay from the first moment the finality guard allowed it, as p50/p95/max, uptime against a 10-minute target over 24 hours and 7 days, and which relays came from wallets that are not ours. `GET /api/relay/health` is the watchdog: `200` when every relayable root is on Creditcoin within target, `503` with the waiting time when one is late, and the cron posts an alert when it crosses either threshold.

Measured over the relay's history in [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md): a freshly mined World ID update is on Creditcoin a median 18.4 minutes later, of which most is Ethereum finality plus the 32-block attestation depth. The lag is shown, not hidden.

---

## Cross-chain credit identity

A person's credit identity should not stop at Creditcoin's edge. Three contracts, all through `ProvenSource`, extend it back into Ethereum.

**`HumanLinks`: one human, their wallets.** The wallet sends itself a zero-value transaction on Ethereum or Sepolia whose calldata is the link intent: a marker plus `abi.encode(human, creditcoinWallet, creditcoinChainId, address(this))`. The human's registered Creditcoin wallet submits the Attestcoin proof. Because it is a self-send, the calldata cannot be anyone else's contract call. Because the intent names this chain and this deployment, it cannot be replayed into another. Because the caller must be the human's registered wallet, a stranger cannot attach a wallet to someone else's identity. `linkBySignature` is the gasless EIP-712 alternative, recorded as such. A wallet belongs to one human forever, and a human holds at most 8.

**`CreditHistory`: a real repayment record, with the rules a lender needs.** It is the Attestcoin Loan Flow template (`ASCLoanManager` proving `LoanFunded` and `LoanRepaid`) pointed at Aave V3. A `Repay` counts only if it matches an earlier proven `Borrow` by the same wallet in the same reserve, lands at least 7,200 source blocks later (proofs carry no timestamps, so time is measured in blocks), was paid by the borrower and not with aTokens, is in USDC, USDT or DAI, stays within the borrow's amount, and has not been counted before. Verified repaid dollars raise the line by 25%, capped at 500 hUSD. A flash loan emits no `Borrow` and counts for nothing.

**`EthRepay`: repay from where the money is.** Send USDC to Humanline's repayment address on Ethereum, prove the `Transfer` through Attestcoin, and `CreditLine.repayFor` settles the line on Creditcoin from a treasury-funded float. A proof can never be credited twice or to the wrong human; if the float is empty a valid proof waits and consumes nothing.

All three are tested against real Sepolia transactions the live `0x0FD2` verifies: a 120 USDC Aave borrow, its 85.23 USDC repayment, and a Circle USDC transfer. The `/app` *Ethereum history* card runs all three flows, each dry-run and browser-verified before a signature. `contracts/script/deploy-cross-chain.sh` deploys the set and migrates liquidity in one step.

---

## Build on it: the SDK, the API, the first app

Personhood is a primitive, so it ships as one. We built the package because the most valuable thing Humanline can be for Creditcoin is not a lending app but the `isHuman` call every other lending app makes.

### `@humanline/sdk`

```bash
npm install @humanline/sdk viem
```

**TypeScript, over any viem client, no wallet needed:**

```ts
import { createHumanlineClient, isHuman, humanOf, lineOf, profileOf } from "@humanline/sdk";

const client = createHumanlineClient();          // CC3 testnet
await isHuman(client, "0x…");                    // true when the wallet is bound to a verified human
const human = await humanOf(client, "0x…");      // the nullifier, or 0n
const line  = await lineOf(client, human);       // limit, principal, available, due date, repaid/late counts
const all   = await profileOf(client, "0x…");    // everything above in one call
```

Every read takes `{ profile: "staging" | "production" }` or `{ deployment }` with your own addresses.

**React, without a wagmi requirement:**

```tsx
import { useHuman } from "@humanline/sdk/react";

function Gate({ address }: { address?: `0x${string}` }) {
  const { loading, isHuman, line } = useHuman(address, { refreshMs: 15_000 });
  if (loading) return <p>Checking…</p>;
  return isHuman
    ? <p>Verified human, {String(line?.available)} hUSD available</p>
    : <a href="https://humanline.credit/app">Verify once</a>;
}
```

**Solidity, two modifiers:**

```solidity
import {HumanGated} from "@humanline/sdk/contracts/HumanGated.sol";

contract Airdrop is HumanGated {
    constructor(address registry) HumanGated(registry) {}

    function claim() external oncePerHuman("airdrop-1") {
        // one claim per human, from whichever wallet they hold today
    }

    function vote() external onlyHuman {}
}
```

Package source and README: [`packages/sdk`](packages/sdk). Docs: [humanline.credit/docs](https://humanline.credit/docs).

### Public API

CORS open, described in OpenAPI 3.1 at [humanline.credit/api](https://humanline.credit/api), for anyone not on JavaScript:

| Endpoint | Returns |
|---|---|
| `GET /api/v1/human/{address}` | whether the wallet is a human, the nullifier, the line |
| `GET /api/v1/line/{nullifier}` | the line by human, whichever wallet holds it today |
| `GET /api/v1/feed` | the loan lifecycle: lines opened, loans drawn and repaid, limits changed, defaults, keyed by human, for a credit bureau or a Credal consumer to ingest |
| `GET /api/relay/stats`, `GET /api/relay/health` | relay liveness, latency, uptime; a `200`/`503` watchdog |

### The first app on the primitive

[`/vote`](https://humanline.credit/vote) is `HumanPoll`, one person one vote, a separate contract that inherits `HumanGated` and nothing else ([`0xD7854346…`](https://creditcoin-testnet.blockscout.com/address/0xD7854346FEA444f6Ac966d2Ce764A4f029e013Bc) on the staging registry, [`0x99d76Bbe…`](https://creditcoin-testnet.blockscout.com/address/0x99d76Bbee73F56B03aD32b8FFb304961c1B0E87D) on the Orb registry). A new wallet is not a new voter. It exists to show that a third party needs twenty lines to get sybil resistance on Creditcoin.

Every human also has a page, `/h/{first 12 hex digits of the nullifier}`: registration, the wallet held today, and the credit history that followed the person there.

---

## Proof, not promises

### Tests

| Suite | Count | Command |
|---|---:|---|
| Contracts (Foundry): unit, fuzz, 12 invariants, 14 live fork tests | 234 | `cd contracts && CC3_FORK=1 forge test` |
| Worker (Bun), no network | 216 | `cd worker && bun test` |
| Web (Bun): in-browser proof verification, self-relay planner, real-proof encoding, relay statistics, cross-chain helpers, attack and measurement builders | 417 | `cd web && bun test` |
| SDK | 10 | `cd packages/sdk && bun test` |
| Everything, plus typecheck and lint | 877 | `bash scripts/verify.sh` |

### Invariants

Twelve stateful invariants in three suites, each with an `afterInvariant` anti-vacuity guard that fails the run if the handler never reached the states the property is about. In CI: 128 runs × 128 calls each.

| Contract | Rules out |
|---|---|
| `CreditLine` | hUSD appearing or disappearing; share supply drifting; `totalPrincipal` disagreeing with the lines; a second line for one nullifier; a defaulted line borrowing again, including after a wallet rebind; outstanding principal above the `0x0FD4` budget |
| `AttestedWorldID` | the tip moving to a root whose pre-root is not the previous tip; `rootCount` disagreeing with history; one proof counted twice across `execute` and `executeBatch`; an orphan root entering history |
| `HumanLinks` | a linked wallet's history moving to another human; link lists exceeding 8 or disagreeing with the wallet index |

### Coverage, mutation, static analysis

| | Result | Detail |
|---|---|---|
| Line coverage | **93.6%** (643/687) | branches 93.5%, functions 92.0%; uncovered lines are the precompile reads that only run in the live fork suites |
| Mutation score | **95.8%** (183/191 killed) | every one-line guard deleted or its relation flipped; the 8 survivors are shown equivalent, one by one, in `docs/MEASUREMENTS.md` |
| Slither | 99 findings | every High and Medium triaged; none is a bug |
| CodeQL, gitleaks | on every push | |
| Submission check | daily | every cited address, transaction and humanline.credit URL must resolve; every contract must be Blockscout-verified |

### Twelve live attacks

`bun run worker/src/cli.ts attack` sends each as a read-only `eth_call` to CC3 testnet with real Sepolia transactions and real Attestcoin proofs as inputs. [`/judge`](https://humanline.credit/judge) fires the same calls while the page loads, with no wallet. CI repeats them every six hours.

| Attack | Refused with |
|---|---|
| Forged Merkle proof | `Merkle proof validation failed` (`0x0FD2`) |
| Wrong contract called (a real USDC transfer) | `NotIdentityManager(0x1c7D…7238)` |
| Reverted source transaction (a real failed Sepolia tx) | `SourceTxReverted` |
| Replay an adopted root | `QueryAlreadyProcessed` |
| Roots out of order | `BatchOutOfOrder` |
| Unattested block height | `Continuity proof does not match attestation or checkpoint` (`0x0FD2`) |
| Below the attestor floor | `ThinQuorum(7, 1000)` |
| Wrong source chain (Sepolia root into the Ethereum relay) | `WrongSourceChain(1, 3)` |
| Decoy `TreeChanged` appended to a real receipt | `Merkle proof validation failed` (`0x0FD2`) |
| Oversize batch (11) | `BatchTooLarge(11)` |
| Root from before the relay's history | `UnknownPreRoot` |
| One human, a second registration | `SameWallet` |

Twelve of twelve, by name. Every attack in the threat model maps to a named custom error and a named test: [`docs/SECURITY.md`](docs/SECURITY.md).

### Measurements from chain data

All regenerated by `bun run worker/src/cli.ts measure`, none typed by hand. Headlines:

| Measurement | Result |
|---|---|
| Gas per relay, live fit | gas ≈ 169,639 + 99,959 · updates + 470.6 · continuity roots (R² 0.994) |
| Single-root relay | median 276,948 gas |
| Full batch of 10 | 2,467,646 gas projected; fits 30 times in one CC3 block |
| The cap | 11 updates: `BatchTooLarge` before any proof work. 10: passes the size check. The cap is exactly 10. |
| `0x0FD2` `verify` gas | ≈ 11,135 + 48 · continuity roots (R² 1.000) |
| Latency, source block → root on Creditcoin | median 18.4 min, minimum 13.8 min |
| Relay calldata | median 6.5 KB, p90 31 KB |
| Share of all BlockProver traffic on CC3 | 70 contracts called `0x0FD2` in 24 h; Humanline is one of them, and every one of its calls carried a World ID root |

### Continuous integration

On every push to `main`: [contracts](.github/workflows/contracts.yml) (build, CI-profile fuzz and invariants, live fork tests, coverage, Slither), [worker](.github/workflows/worker.yml), [web](.github/workflows/web.yml) (typecheck, lint, tests, production build, Lighthouse), [CodeQL](.github/workflows/codeql.yml), [gitleaks](.github/workflows/gitleaks.yml), [submission-check](.github/workflows/submission-check.yml), and every six hours [live-attacks](.github/workflows/attacks.yml).

---

## Verify it yourself in five minutes

| | |
|---|---|
| Live app | https://humanline.credit |
| Judge page, no wallet needed | https://humanline.credit/judge |
| Live relay feed | https://humanline.credit/relay |
| One person, one vote | https://humanline.credit/vote |
| Public API and OpenAPI spec | https://humanline.credit/api |
| Measurements, coverage, mutation score, live attacks | [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) |
| Attestcoin write-up, every surface with `file:line` | [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) |
| Architecture and sequence diagrams | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Threat model | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Relay evidence, one line per relayed root | [`evidence/relay-log.jsonl`](evidence/relay-log.jsonl) |
| Deployment records | [`deployments/cc3-testnet.json`](deployments/cc3-testnet.json), [`deployments/cc3-testnet.production.json`](deployments/cc3-testnet.production.json) |
| Pitch deck | [`docs/deck.pdf`](docs/deck.pdf) |

Three commands, no wallet, no funds:

```bash
git clone --recurse-submodules https://github.com/rajkaria/humanline
cd humanline
bun install && (cd contracts && bun install)

# All three Attestcoin precompiles, supported chains with attested tips and bonded attestor
# counts, bn128 sanity, and the live state of both AttestedWorldID instances.
bun run worker/src/cli.ts check

# Take a real World ID transaction from Ethereum mainnet, fetch its Attestcoin proof, replay
# every on-chain guard locally, and verify it against the live 0x0FD2 precompile. Sends nothing.
bun run worker/src/cli.ts prove \
  0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3 \
  --source mainnet --dry-run

# Fire twelve named attacks at the deployed contracts as read-only calls.
bun run worker/src/cli.ts attack

# Build a proof locally from an Ethereum RPC and diff it against the hosted prover, byte for byte.
bun run worker/src/cli.ts proof-diff \
  0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3 --source mainnet
```

And one relayed root, end to end, on public explorers: Ethereum mainnet [`0xf321a814…728c2`](https://etherscan.io/tx/0xf321a814442cef61e60ada9e64a7c1fa388c787321af615a5e9f08cae3f728c2) became Creditcoin [`0xe764d3be…315dd`](https://creditcoin-testnet.blockscout.com/tx/0xe764d3be2bfa002d1f7db2e348daf5be410acc016ef6c4d7ebd797a5380315dd), an `executeBatch` carrying two roots and 200 identity commitments under one Attestcoin continuity proof.

---

## Live addresses

Creditcoin CC3 testnet, chainId 102031, RPC `https://rpc.cc3-testnet.creditcoin.network`, explorer `https://creditcoin-testnet.blockscout.com`. All twelve verified on Blockscout, re-checked daily by `scripts/submission-check.ts`.

**Shared by both deployments**

| Contract | Address |
|---|---|
| `AttestedWorldID` (Ethereum mainnet, chainKey 3) | [`0x1122ef3fa4ab0693809e42a00b2476efcf4468ad`](https://creditcoin-testnet.blockscout.com/address/0x1122ef3fa4ab0693809e42a00b2476efcf4468ad) |
| `AttestedWorldID` (Ethereum Sepolia, chainKey 1) | [`0x3a7c3cc67034197208923587b8dc5c4674cbcef7`](https://creditcoin-testnet.blockscout.com/address/0x3a7c3cc67034197208923587b8dc5c4674cbcef7) |
| `hUSD` (test stablecoin, 6 decimals) | [`0x4bd7f4c6648deb8f107932572ce7e85aca259640`](https://creditcoin-testnet.blockscout.com/address/0x4bd7f4c6648deb8f107932572ce7e85aca259640) |
| `RelayReward` (permissionless relayer vault) | [`0x9766480a872ad7df2a5cf86f9e307804a3f7afe0`](https://creditcoin-testnet.blockscout.com/address/0x9766480a872ad7df2a5cf86f9e307804a3f7afe0) |

**Reproducible deployment, Sepolia staging tree** ([humanline.credit/app](https://humanline.credit/app))

| Contract | Address |
|---|---|
| `HumanRegistry` | [`0x62c2fd99ea587e4b466175ad248468782bd5298d`](https://creditcoin-testnet.blockscout.com/address/0x62c2fd99ea587e4b466175ad248468782bd5298d) |
| `CreditLine` v2 (10-minute terms, attestor-bond exposure cap) | [`0x49d5f2ea387a4ee16eef3cf390fccfa689dda2b9`](https://creditcoin-testnet.blockscout.com/address/0x49d5f2ea387a4ee16eef3cf390fccfa689dda2b9) |
| `HumanGate` (example integration) | [`0xa3e021de49cec8819ea1bd37a8b5a9df005b776c`](https://creditcoin-testnet.blockscout.com/address/0xa3e021de49cec8819ea1bd37a8b5a9df005b776c) |
| `HumanPoll` (one person, one vote) | [`0xd7854346fea444f6ac966d2ce764a4f029e013bc`](https://creditcoin-testnet.blockscout.com/address/0xd7854346fea444f6ac966d2ce764a4f029e013bc) |

**Real deployment, Ethereum mainnet Orb tree** ([humanline.credit/app?profile=production](https://humanline.credit/app?profile=production))

| Contract | Address |
|---|---|
| `HumanRegistry` | [`0x53fcba2cd9296b22635c67d5e73777b4e5db96af`](https://creditcoin-testnet.blockscout.com/address/0x53fcba2cd9296b22635c67d5e73777b4e5db96af) |
| `CreditLine` v2 (30-day term, 7-day grace, exposure cap) | [`0x8063982df3250c2f21f2f18f1cf340ec75c1c1cb`](https://creditcoin-testnet.blockscout.com/address/0x8063982df3250c2f21f2f18f1cf340ec75c1c1cb) |
| `HumanGate` | [`0x544264e52a12fffa5c8640eb5a91b7f4628d5b93`](https://creditcoin-testnet.blockscout.com/address/0x544264e52a12fffa5c8640eb5a91b7f4628d5b93) |
| `HumanPoll` | [`0x99d76bbee73f56b03ad32b8ffb304961c1b0e87d`](https://creditcoin-testnet.blockscout.com/address/0x99d76bbee73f56b03ad32b8ffb304961c1b0e87d) |

Deployed parameters: initial limit 25 hUSD, maximum 2,000 hUSD, fee 100 bps per term, limit ×1.25 on an on-time full repayment, halved when late, frozen after due date plus grace. `deployments/cc3-testnet.v1.json` records an earlier deployment of the same contracts, replaced after a review round, kept so the first rows of the relay evidence log stay attributable.

---

## Repository layout

```
contracts/        Foundry project, Solidity 0.8.28, via_ir
  src/            AttestedWorldID, HumanRegistry, CreditLine, HUSD, RelayReward,
                  HumanLinks, CreditHistory, EthRepay, ProvenSource,
                  sdk/HumanGated, examples/HumanGate, examples/HumanPoll
  src/interfaces/ IAttestedWorldID, IHumanRegistry, ICreditLine, IHumanLinks, ICreditHistory,
                  ISourceProof, IChainInfo, IAttestorStash
  test/           unit, fuzz, fork and invariant/ suites (234 tests)
  script/         Deploy.s.sol, deploy-cc3.sh, deploy-cross-chain.sh, deploy-relay-reward.sh,
                  deploy-poll.sh, verify-blockscout.sh, export-abi.sh, GasProbe.sol
  vendor/worldid/ World's WorldIDBridge and SemaphoreVerifier, unmodified (MIT)
  abi/            exported ABIs, consumed by the worker, the web app and the SDK
worker/           Bun CLI: check, bootstrap, prove, relay, local-proof, proof-diff, attack, measure, status
web/              Next.js 15: /, /app, /relay, /vote, /judge, /docs, /api, /h/{id}, /api/v1, cron, self-relay
packages/sdk/     @humanline/sdk: viem reads, useHuman, HumanGated.sol
deployments/      cc3-testnet.json (staging tree), cc3-testnet.production.json (Orb tree), v1 (superseded)
evidence/         relay log, self-relay, proof-diff, attacks, measurements, coverage, mutation, slither, e2e logs
docs/             ATTESTCOIN_INTEGRATION, ARCHITECTURE, SECURITY, MEASUREMENTS, VISION, SUBMISSION,
                  DECK + deck.pdf, VIDEO_SCRIPT, launch/, ecosystem/
scripts/          verify.sh, coverage.sh, mutation.ts, submission-check.ts, seed-pool.sh
.github/          contracts, web, worker, codeql, gitleaks, submission-check, live-attacks, relay workflows
```

---

## Getting started

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`). Clone with `--recurse-submodules` (`forge-std` is a submodule). `bun install` at the root installs the `worker`, `web` and `packages/sdk` workspaces; `cd contracts && bun install` installs the Solidity dependencies (OpenZeppelin, `@gluwa/asc-contracts`).

### Contracts

```bash
cd contracts
bun install
forge build
forge test                                 # unit, fuzz, invariants; fork tests skip cleanly
CC3_FORK=1 forge test                      # adds the 14 tests that read the live CC3 precompiles

PROFILE=demo script/deploy-cc3.sh          # your own copy (needs a funded CC3 key in ../.secrets.env)
PROFILE=prod WORLD_ID_SOURCE=mainnet \
  REUSE="AttestedWorldIDMainnet AttestedWorldIDSepolia HUSD" \
  REUSE_FROM=../deployments/cc3-testnet.json \
  DEPLOYMENT_OUT=../deployments/cc3-testnet.production.json script/deploy-cc3.sh
script/deploy-relay-reward.sh              # the relayer vault
script/deploy-cross-chain.sh               # HumanLinks, CreditHistory, EthRepay, CreditLine v3, liquidity migration
script/verify-blockscout.sh                # source verification
script/export-abi.sh                       # refresh contracts/abi/*.json
```

### Worker

```bash
cd worker
bun run src/cli.ts check                            # read-only, no wallet
bun run src/cli.ts prove <txHash> --source mainnet --dry-run
bun run src/cli.ts local-proof <txHash> --source sepolia   # build the proof yourself
bun run src/cli.ts proof-diff <txHash…>             # local vs hosted, byte for byte
bun run src/cli.ts relay --source all --once --dry-run
bun test

cp .env.example .env                                # CREDITCOIN_WALLET_PRIVATE_KEY to relay for real
bun run src/cli.ts relay --source all               # continuous, 60 s poll
bun run src/cli.ts status
```

Without a key, every command that would send a transaction explains itself and exits 2. See [`worker/README.md`](worker/README.md).

### Web

```bash
cd web
cp .env.example .env.local                 # WORLD_RP_SIGNER_PRIVATE_KEY is server-side only
bun run dev                                # http://localhost:3000
bun run build
bun test
bun run scripts/self-relay.ts              # plan + proof + eth_call for the newest World update
bun run scripts/self-relay.ts --send --fresh   # relay it from a brand-new wallet funded by the faucet
```

`/app` picks the deployment at runtime, the staging tree by default and the Orb tree at `?profile=production`. `GAS_FAUCET_PRIVATE_KEY` enables `/api/gas`, which drips CC3 gas to a first-time wallet. See [`web/README.md`](web/README.md).

### SDK

```bash
cd packages/sdk
bun test && bun run build
```

Two environment notes that will otherwise cost you ten minutes: Foundry is not vendored, so install it once and call `forge` and `cast` (the scripts honour `FORGE=` and `CAST=`); and the shell scripts target bash 3.2, the macOS default, so they use tab-separated rows instead of associative arrays.

---

## Where this goes

The endpoint is not a lending app. It is **the personhood layer for Creditcoin**: a public `IHumanRegistry` that any lender, DAO, airdrop, payroll contract or governance module on the chain reads for free, funded by the credit business that sits on top of it. Humanline's own `CreditLine` is the reference implementation and the proof that the registry is good enough to lend against.

| Horizon | Milestone |
|---|---|
| Month 1 | `AttestedWorldID`, `HumanRegistry` and the cross-chain set on Creditcoin mainnet (where Ethereum is chainKey 1), same code, same lack of an owner. First Credal lender using `isHuman` as a sybil check on an existing loan book. Two independent relayers run by different parties. |
| Month 3 | Lines funded by PenguinSwap LPs, so the pool has a real cost of capital. BSC as a source chain when chainKey 8 ships, because remittance corridors into Africa and Southeast Asia settle there. Periscope begun: World Chain output roots proven through their Ethereum postings. |
| Month 6 | A supervised pilot in Kenya and Argentina with a Creditcoin lending partner. Real money, small tickets, the 25 dollar line growing to a few hundred. The deliverable is a published cohort loss curve for personhood-gated uncollateralized credit. Nobody has one. |

Revenue turns on in three lines: a per-verification fee paid by the integrating lender at registration and re-bind (reads stay free), a spread on the deployed 1% per-term pool fee, and a planned 1% origination fee per draw. Modeled from the shipped parameters, a well-behaved first-year borrower draws about 281 USD across six growing terms and returns roughly 3.76 USD. The number that decides whether this works is the default rate, and the whole design exists to make it measurable: in wallet-scored lending the ceiling on a sybil attack is the attacker's patience; here it is the number of Orbs they can get in front of with a different iris each time.

The full product vision, unit economics and the CEIP ask are in [`docs/VISION.md`](docs/VISION.md).

---

## What is testnet-only, and what we do not claim

Stated up front rather than discovered later. Full reasoning in [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) section 8 and [`docs/SECURITY.md`](docs/SECURITY.md) section 3.

- **The World ID roots are real.** They come from World's own sequencer on Ethereum mainnet, roughly hourly, and each arrives with an Attestcoin proof verified by `0x0FD2` in the same transaction. There is no mock verifier, no canned proof and no replayed fixture anywhere in the deployed path.
- **hUSD is a test stablecoin we mint.** Lender deposits are testnet funds. The demo deployment shortens terms to minutes so a full borrow, miss and default cycle fits in a video. No economic claim here has been tested with real money.
- **Attestcoin cannot prove a negative.** A default is declared from a passed deadline plus the absence of a repayment in Creditcoin's own state, which is native. We never dress that up as a cross-chain absence claim.
- **Roots lag.** Source finality plus attestation plus a 32-block depth: a median of about 18 minutes for a freshly mined root. Someone Orb-verified five minutes ago cannot register yet. The lag is shown on `/relay`, and self-relay means nobody waits longer than the protocol requires.
- **Sybil resistance is exactly World's.** The guarantee is "one World ID, one line", not "one biological human, one line".
- **The attestor set is the deepest assumption.** A colluding quorum could attest to a block that does not exist. Humanline enforces a floor of 3 bonded attestors, a depth of 32 attested blocks, and a credit ceiling tied to their bonded stake, and cannot do better than the protocol it sits on.
- **World ID 4.0** verifies on World Chain, which is not an Attestcoin source chain yet. IDKit is asked for legacy proofs. Periscope is the roadmap answer, and it is a design, not a deployment.
- **Cross-chain history has edges.** Links prove an externally owned account; smart-contract wallets cannot sign the self-send or the EIP-712 message. On Sepolia, Aave reserves are faucet tokens, so testnet history demonstrates the rules rather than signalling creditworthiness. Someone with capital can still borrow, wait, and repay to build a record, at real interest, for a boost capped at 500 hUSD.
- **A freeze is permanent and there is nobody to appeal to.** That is the design, and it is also a real product limitation a production version would address with a lender-controlled cure path written into the contract from the start.

---

## Team and license

| | |
|---|---|
| Builder | **Raj Karia**, sole builder: contracts, relay worker, web app, SDK, documentation |
| X | [@rajkaria_](https://x.com/rajkaria_) |
| GitHub | [@rajkaria](https://github.com/rajkaria) |
| Repository | https://github.com/rajkaria/humanline |
| Live | https://humanline.credit |

MIT. See [`LICENSE`](LICENSE). Vendored third-party code keeps its own attribution: World's `WorldIDBridge` and `SemaphoreVerifier` under `contracts/vendor/worldid/` are MIT and unmodified. Attestcoin's `ASCBase` and `EvmV1Decoder` come from `@gluwa/asc-contracts`, likewise unmodified. `IChainInfo.sol` and `IAttestorStash.sol` were written from scratch under MIT rather than copied, because the upstream precompile metadata in `gluwa/creditcoin3` is GPL-3.0-only.

Security reports: [`docs/SECURITY.md`](docs/SECURITY.md) section 4.

<div align="center">

**One human, one credit line.** Zero trusted parties.

</div>
