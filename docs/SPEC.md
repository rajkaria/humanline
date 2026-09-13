# Humanline: BUIDL CTC 2026 Fall Build Spec

> One human, one credit line. World ID proof of personhood reaches Creditcoin through the Attestcoin Protocol, a zero-knowledge proof is verified on Creditcoin itself, and a verified human receives an uncollateralized credit line that follows the person, not the wallet.

Track: **DeFi** (secondary fit: RWA, AI-free by design). Hackathon: BUIDL CTC 2026 Fall (Creditcoin & Credit Labs). Deadline 2026-09-13 23:59 ET.

---

## 1. The problem

Creditcoin's founding mission is credit history for people the banking system cannot see. Every undercollateralized lending design on Creditcoin, including all thirty "credit passport" submissions in this hackathon, has the same hole: a wallet is not a person. A borrower can open ten wallets, repay themselves ten times, mint ten perfect scores, and default on the eleventh loan. Lenders like Aella (1M+ users on Creditcoin) cannot lend against on-chain history until the history belongs to a human who cannot walk away from it by generating a new key.

Proof of personhood exists. World ID has 18M+ Orb-verified humans (July 2026), concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia, which are Creditcoin's markets. But World ID's identity tree lives on Ethereum. Creditcoin cannot see it, and the only ways to bring it over today are a trusted bridge or a trusted oracle, which is exactly what Attestcoin exists to remove.

## 2. The solution

Humanline is three contracts and one worker:

1. **AttestedWorldID**: World's own bridged-root contract (MIT, from `world-id-state-bridge`) with one change: roots arrive as Attestcoin proofs of the real `registerIdentities` / `deleteIdentities` transactions on Ethereum, verified by the 0x0FD2 precompile, instead of by a trusted state bridge. It exposes the same `IWorldID.verifyProof` interface every World ID integration uses.
2. **HumanRegistry**: binds a World ID nullifier (the human) to a Creditcoin wallet after verifying the Semaphore Groth16 proof on Creditcoin. One human, one registration. Re-binding to a new wallet is allowed; the identity and its history move with the human. Any Creditcoin contract can call `isHuman(address)` / `humanOf(address)`.
3. **CreditLine**: a lender-funded pool that opens exactly one line per human. Borrow, repay, grow the limit. Miss a deadline and the human's line freezes, on every wallet, forever. Loan events mirror Credal's loan lifecycle so a Creditcoin lender can consume them.

The worker tails Ethereum for new World ID roots, batches Attestcoin proofs (up to 10 per continuity proof), and relays them in order. Nothing in the system trusts the worker: a bad proof reverts, a root out of sequence reverts, and anyone can run the worker.

## 3. Competitive positioning

- 87 submissions. 30 are credit passports built on toy Sepolia loan contracts. 10 are AI guardrails. Zero touch identity, zero-knowledge proofs, or proof of personhood.
- The best entries (PRECEDENCE 8.8, index41 8.6, nomen 8.4, Singleton 8.3) win on mainnet-real data, batch verification, multi-precompile use and test rigor. Humanline matches each of those axes and adds a cryptographic layer none of them have.
- The one-sentence knock-out: every other credit passport can be forged by creating a new wallet. Ours cannot, because the nullifier is the human.

## 4. Target user persona

**Amina, 27, Nairobi.** Orb-verified through World App in 2025. Sells phone accessories, paid in M-Pesa and USDC. No bank credit file. She wants a 50 USD working-capital line she can grow by repaying on time. She should never be asked for collateral, never be asked to trust an oracle operator, and never be able to be impersonated by a sybil farm.

**Aella (the lender).** Runs BNPL for a million Nigerians and records loans on Creditcoin through Credal. Wants a trustless answer to "is this borrower a unique human, and what is their Humanline history?" before extending uncollateralized credit.

## 5. Architecture

```
ETHEREUM MAINNET (chainKey 3)             CREDITCOIN CC3 TESTNET (chainId 102031)
┌──────────────────────────────┐          ┌──────────────────────────────────────────┐
│ WorldIDIdentityManager (Orb) │          │ 0x0FD2 BlockProver  0x0FD3 ChainInfo      │
│ 0xf7134CE1…bddEa             │          │ 0x0FD4 AttestorStash                      │
│ registerIdentities() ~hourly │  proofs  ├──────────────────────────────────────────┤
│ emits TreeChanged(pre,kind,  │ ───────▶ │ AttestedWorldID (ASCBase + WorldIDBridge) │
│        post)                 │ worker   │  · verifyAndEmit → decode calldata + log  │
└──────────────────────────────┘          │  · preRoot must chain to a known root     │
ETHEREUM SEPOLIA (chainKey 1)             │  · finality + quorum guards (0xFD3/0xFD4) │
┌──────────────────────────────┐          │  · rootHistory, 1-week expiry             │
│ Staging identity manager     │ ───────▶ │  · IWorldID.verifyProof (Semaphore/bn128) │
│ 0xb2ead588…7076 (simulator)  │          ├──────────────────────────────────────────┤
└──────────────────────────────┘          │ HumanRegistry  · nullifier ⇄ wallet       │
                                          │ CreditLine     · one line per nullifier   │
   World App / IDKit / Simulator ───ZK──▶ │ HumanGate      · example integration      │
                                          └──────────────────────────────────────────┘
```

**Stack.** Solidity 0.8.28 + Foundry (contracts, tests). Bun + TypeScript + `@gluwa/usc-sdk` 0.18 + ethers v6 (worker). Next.js 15 App Router + Tailwind + shadcn + wagmi/viem + `@worldcoin/idkit` (web). Vercel (web). Worker runs as a long-lived Bun process and, as a serverless fallback, as a GitHub Actions cron that catches up from on-chain state.

### 5.1 AttestedWorldID (per source chain)

Two instances are deployed: `AttestedWorldID(chainKey=3, manager=0xf713…)` for production Orb roots, and `AttestedWorldID(chainKey=1, manager=0xb2ea…)` for the Sepolia staging tree so judges can verify with World's simulator. Both run the identical code path.

`execute(action, chainKey, blockHeight, encodedTx, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` (inherited from `ASCBase`) → `_processAndEmitEvent(action, queryId, encodedTx)`:

1. `chainKey == SOURCE_CHAIN_KEY`, else revert `WrongSourceChain`.
2. `EvmV1Decoder.decodeReceiptFields(tx).receiptStatus == 1`, else `SourceTxReverted`.
3. `EvmV1Decoder.decodeCommonTxFields(tx).to == IDENTITY_MANAGER`, else `NotIdentityManager`.
4. Find `TreeChanged` logs (`topic0 = 0x25f6d5cc…af04`) whose emitter is `IDENTITY_MANAGER`. Skip foreign logs rather than reverting (Deadswitch's decoy-log finding). Require exactly one, else `NoTreeChange` / `AmbiguousTreeChange`.
5. `preRoot = topics[1]`, `kind = topics[2]`, `postRoot = topics[3]`.
6. Calldata cross-check: selector `0x2217b211` (registerIdentities) → word 8 is `preRoot`, word 11 is `postRoot`, `identityCommitments.length` at the dynamic offset gives `humansAdded`; selector `0xea10fbbe` (deleteIdentities) → last two words are `preRoot`, `postRoot`. Mismatch reverts `CalldataLogMismatch`.
7. Chain rule: `preRoot == latestRoot` (advance) or `rootHistory[preRoot] != 0` (side-fill of a historical gap, does not advance `latestRoot`). Unknown `preRoot` reverts `UnknownPreRoot`, except the very first root, which any relayer may bootstrap (every root in the World tree is genuine; bootstrap only decides where history starts).
8. Finality guard: `ChainInfo(0x0FD3)` attested tip for `chainKey` must be ≥ `blockHeight + FINALITY_DEPTH` (32 on mainnet, 32 on Sepolia). Quorum guard: `AttestorStash(0x0FD4)` bonded attestor count ≥ `MIN_ATTESTORS` (3).
9. `_receiveRoot(postRoot)` (World's code: timestamps, `CannotOverwriteRoot`). Emit `RootRelayed(queryId, blockHeight, preRoot, postRoot, kind, humansAdded, sourceTxIndex)`.

`verifyProof(root, signalHash, nullifierHash, externalNullifierHash, proof[8])` is World's own implementation over the vendored `SemaphoreVerifier` (Groth16 on bn128; precompiles 0x06/0x07/0x08 confirmed on CC3).

No owner, no pause, no upgrade. Constants are immutables.

### 5.2 HumanRegistry

- `register(uint256 root, uint256 nullifierHash, uint256[8] proof)` with `signal = msg.sender`, `externalNullifier = hashToField(abi.encodePacked(hashToField(APP_ID), ACTION))`, `ACTION = "humanline-register"`.
- First registration of a nullifier binds `wallet ⇄ nullifier`. A repeat with a different wallet re-binds (the human moved wallets); the previous wallet is unbound. A wallet can hold at most one human.
- Views: `isHuman(address)`, `humanOf(address) → nullifier`, `walletOf(nullifier)`, `registeredAt(nullifier)`.
- `IHumanRegistry` is the public interface; `examples/HumanGate.sol` shows one-human-one-claim in 20 lines.

### 5.3 CreditLine

- Lenders `deposit()` the pool asset (`hUSD`, a test ERC-20 we mint, 6 decimals, so amounts read like dollars) and receive pool shares.
- A registered human `openLine()`: limit starts at `INITIAL_LIMIT` (25 hUSD). `borrow(amount)` ≤ available; `repay(amount)`; a flat `FEE_BPS` (100 = 1%) is added to principal on every draw. A due date (`TERM` = 30 days in production, 600 s on the demo deployment) is set when principal goes from zero to positive.
- On-time full repayment: `limit = limit * 125 / 100` (cap 2,000 hUSD). Late repayment: limit halves. Past `GRACE` with balance > 0: anyone calls `markDefault(nullifier)`; the human is frozen permanently and the debt is written off against the pool.
- All state keyed by nullifier. Wallet re-binding carries the line.
- Events: `LineOpened`, `Borrowed`, `Repaid`, `LimitChanged`, `Defaulted`, mirroring Credal's loan lifecycle so lenders can index them.

### 5.4 Worker (`worker/`)

- `humanline relay --source mainnet|sepolia|all`: eth_getLogs on `TreeChanged` from the manager since the last relayed block; for each tx in order: `ProofBuilder.waitUntilHeightAttested`, `getProof` (or `getBatchProof` for consecutive txs within 1000 blocks, max 10), `execute()` on the matching `AttestedWorldID`; on stale-proof revert, refetch and retry; persist cursor in `bun:sqlite`; never skip, never reorder.
- `humanline bootstrap`: seeds the first root.
- `humanline prove <txHash>`: one-off proof + submit, used for the spike and by judges.
- `humanline check`: prints 0xFD2/0xFD3/0xFD4 state, latest root on both chains, and bn128 precompile sanity.
- Catch-up is derived from chain state (`latestRoot`, `RootRelayed` events), so a fresh worker or the GitHub Actions cron resumes correctly.

### 5.5 Web (`web/`)

- `/` landing: hero, one-liner, "every other passport can be forged" comparison, how it works, live counters (roots relayed, humans registered, credit extended), CTA.
- `/app`: connect wallet on CC3 → "Verify you're human" (IDKit widget, staging on demo, production flag for Orb users) → registration tx → credit line panel (limit, available, borrow, repay, due date, history) → explorer links for every tx.
- `/relay`: live root-relay feed for both source chains: Ethereum tx → Creditcoin tx, pre/post roots, humans added, attestation lag, precompile guard values. Every row links Etherscan and Blockscout.
- `/judge`: one page with contract addresses, the exact commands to reproduce every claim without a wallet, the negative-path suite output, and the evidence JSON.
- `/docs`: integration guide for lenders (`IHumanRegistry`, `ICreditLine` reads), the Attestcoin integration write-up, security model.
- Dark theme, Inter + JetBrains Mono, mobile responsive, loading and error states.

## 6. Core features (must ship)

1. **Root relay**: live, unattended relay of real World ID roots from Ethereum mainnet and Sepolia staging into `AttestedWorldID` through Attestcoin, batched, ordered, replay-protected, with guards from all three precompiles.
2. **Personhood verification on Creditcoin**: a real World ID proof (simulator on staging, Orb on production) verified on Creditcoin against an Attestcoin-relayed root, binding a human to a wallet.
3. **One human, one credit line**: deposit, open, borrow, repay, limit growth, freeze on default, all keyed by nullifier, with a full UI and explorer links.

## 7. Nice-to-have (in impact order)

1. Repay from Ethereum: a USDC transfer on Sepolia to the pool's receiver, proven through Attestcoin, credited to the human's line (second Attestcoin surface; reuses the relay pipeline).
2. `HumanGate` example deployed with a one-click "claim once" demo (verifiable governance / airdrop angle).
3. Lender dashboard with pool utilization and per-human histories.
4. World ID 4.0 path via World Chain output roots proven on Ethereum (the "Periscope" roadmap).

## 8. Attestcoin Protocol integration (depth checklist)

| Surface | Where | Why it is load-bearing |
|---|---|---|
| `verifyAndEmit` (0x0FD2) | `ASCBase.execute` | No root enters the verifier without it |
| Batch verification | worker `getBatchProof` → `execute` per tx sharing one continuity proof; on-chain `verifyBatch` for hourly batches | Hourly roots land in 3–10 batches |
| Calldata decoding | `decodeCommonTxFields(tx).data` → `postRoot`, `humansAdded` | Cross-checks the event, feeds the dashboard |
| Log decoding | `getLogsByEventSignature` on `TreeChanged` | The root itself |
| Emitter and status binding | `to == manager`, `log.address_ == manager`, `status == 1` | Rejects look-alike events and reverted txs |
| `calculateTxIndex` | `queryId` and `sourceTxIndex` in `RootRelayed` | Replay key and ordering evidence |
| ChainInfo (0x0FD3) | finality depth guard | A root is only accepted 32+ blocks behind the attested tip |
| AttestorStash (0x0FD4) | quorum floor | Refuses roots attested by a thin set |
| Two source chains | mainnet chainKey 3, Sepolia chainKey 1 | Production and judge-reproducible paths |
| Zero-knowledge on top | Semaphore verifier over an Attestcoin-anchored root | Without Attestcoin the verifier has no trusted root |

Remove Attestcoin and Humanline has no roots, no humans and no credit.

## 9. Security model

- Attestcoin proves inclusion and continuity only. Humanline adds: status, emitter, source-contract, selector/calldata-vs-log agreement, root chaining, finality depth, attestor quorum, replay by `queryId`, root-history expiry, nullifier uniqueness, wallet uniqueness.
- Threats and tests: forged root (verifier rejects), tampered payload (Merkle mismatch), wrong source chain, reverted tx, decoy `TreeChanged` from another contract, replayed query, out-of-order root, stale root past expiry, proof for a different signal (wallet), proof reuse across actions, double registration, borrow over limit, repay by non-owner wallet, default freeze survives re-bind, oversized batch.
- No admin keys. Constants are immutable. Anyone can relay.

## 10. What is real and what is not

- Real: Ethereum mainnet World ID roots (updated hourly by World's sequencer), Attestcoin proofs generated by the CC3 proof builder and verified by the 0x0FD2 precompile in every relay tx, Groth16 verification on Creditcoin, Sepolia staging roots, simulator proofs.
- Testnet-only: `hUSD` is a test stablecoin we mint; lender deposits are testnet funds; loan terms are minutes-long on the demo deployment so a full cycle fits in a video.
- Not claimed: Attestcoin cannot prove a payment did not happen. Defaults are declared by deadline plus absence of a repayment on Creditcoin, which is native state, not a cross-chain absence claim.

## 11. Demo flow (3 minutes)

1. `/relay`: watch a real Ethereum root land on Creditcoin, click through to the Ethereum tx (World's sequencer) and the Creditcoin tx (precompile event), show humans-added count.
2. `/app`: connect, verify with World simulator (staging), registration tx confirms in one block, wallet becomes a human.
3. Open line (25 hUSD), borrow 20, repay 20.2, limit grows to 31.25. Explorer links throughout.
4. Second wallet, same simulated identity: re-bind, line and history follow. Attempt to open a second line: `AlreadyHasLine`.
5. `/judge`: run the negative-path suite live; all attacks rejected with named errors.
6. Close on the mainnet counter: "N real World ID roots relayed, M humans in the tree, zero trusted parties."

## 12. Product vision and business

- **Month 1:** production `AttestedWorldID` on CC3 mainnet; `IHumanRegistry` adopted by one Creditcoin lender (Aella via Credal) for sybil checks. Revenue: per-verification fee (0.10 USD equivalent in CTC) paid by the integrating lender.
- **Month 3:** Humanline lines funded by PenguinSwap LPs; repayments from Ethereum and BSC (chainKey 8 when it ships) proven through Attestcoin; World ID 4.0 via World Chain roots.
- **Month 6:** 100k verified humans with lines; origination fee 1% + spread. Attestcoin usage grows with every root batch and every cross-chain repayment.
- **The ask (CEIP):** funding for a 6-month pilot in Kenya and Argentina with a Creditcoin lending partner, and engineering support to bring World Chain under Attestcoin.

## 13. Submission checklist

- [ ] Contracts deployed on CC3 testnet, verified on Blockscout, addresses in README and `/judge`
- [ ] Worker relaying mainnet and Sepolia roots unattended; evidence JSON committed
- [ ] Web deployed on Vercel with custom-ish domain
- [ ] README with one-liner, GIF, architecture, install, addresses, known limitations
- [ ] `docs/ATTESTCOIN_INTEGRATION.md` (required technical documentation)
- [ ] `docs/VISION.md`, pitch deck PDF, 3-minute video, DoraHacks form fields
- [ ] Foundry suite green, worker tests green, negative-path suite runnable without a wallet

## 14. Environments and addresses

| Item | Value |
|---|---|
| Creditcoin CC3 testnet | chainId 102031, `https://rpc.cc3-testnet.creditcoin.network`, explorer `https://creditcoin-testnet.blockscout.com` |
| Proof builder | `https://prover.cc3-testnet.creditcoin.network` |
| Precompiles | BlockProver `0x…0FD2`, ChainInfo `0x…0FD3`, AttestorStash `0x…0FD4` |
| Deployed EvmV1Decoder library | `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B` |
| World ID Orb manager (mainnet, chainKey 3) | `0xf7134CE138832c1456F2a91D64621eE90c2bddEa` |
| World ID staging manager (Sepolia, chainKey 1) | `0xb2ead588f14e69266d1b87936b75325181377076` |
| `TreeChanged` topic | `0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04` |
| Selectors | `registerIdentities` `0x2217b211`, `deleteIdentities` `0xea10fbbe`, `latestRoot()` `0xd7b0fef1` |
| Relayer wallet (needs faucet) | `0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3` |

## 15. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| IDKit stops issuing 3.0 proofs | `allow_legacy_proofs: true`; mainnet 3.0 tree still updated hourly (verified 2026-09-12 06:34 UTC). Fallback: World Chain 4.0 verification events proven via OP-Stack output roots on Ethereum |
| Proof payload too large for RPC | `registerIdentities` txs are small (proof + commitments); batch size adapts |
| Attestation lag during demo | Pre-recorded relay evidence plus live feed; demo uses staging line terms in minutes |
| Faucet limits | 100 tCTC/day is ample; relay tx ≈ 0.0002 CTC |
