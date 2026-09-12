# Humanline: DoraHacks Submission

Every field on the BUIDL CTC 2026 Fall submission form, filled. Copy each block verbatim into DoraHacks. Tokens in double braces are filled at submission time.

Deadline: 2026-09-13 23:59 ET.

---

## Project Information

### Project Name

```
Humanline
```

### Project Logo (Image URL, optional)

```
{{LOGO_URL}}
```

PNG or SVG. If no logo is ready at submission, leave blank rather than uploading a placeholder.

### Project Sector

```
DeFi
```

Secondary fit is RWA. The form takes one value, and DeFi is correct: this is a lending pool with an identity primitive under it. Do not select AI.

### Project Description

Paste as one block. 263 words.

```
One human, one credit line. Humanline brings World ID proof of personhood from Ethereum to Creditcoin through the Attestcoin Protocol, verifies a zero-knowledge proof on Creditcoin itself, and gives a verified human an uncollateralized credit line that follows the person, not the wallet.

Creditcoin's mission is credit history for people the banking system cannot see. Every uncollateralized design on the chain has the same hole: a wallet is not a person. A borrower can open ten wallets, repay themselves ten times, mint ten perfect scores, and default on the eleventh loan at full size. Lenders cannot extend uncollateralized credit against a history that a new keypair erases.

World ID has Orb-verified humans concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia, which are Creditcoin's markets. Its identity tree lives on Ethereum, and the only ways across today are a trusted bridge or a trusted oracle. Attestcoin removes both.

Humanline is three contracts and one worker, live on CC3 testnet.

AttestedWorldID is World's own bridged-root contract from world-id-state-bridge, with the trusted state bridge replaced by Attestcoin proofs of the real registerIdentities transactions on Ethereum mainnet, verified by the 0x0FD2 precompile. HumanRegistry verifies a Semaphore Groth16 proof natively on Creditcoin, on the bn128 precompiles, against a root Attestcoin delivered, and binds a nullifier to a wallet. CreditLine opens exactly one line per nullifier: borrow, repay, grow the limit, and freeze permanently on default. All state is keyed by the human, so re-binding to a new wallet carries the history and the freeze with the person.

No owner, no pause, no upgrade. Anyone can relay.
```

Word count check: run `wc -w` on the block before pasting. The form's limit is 300.

### Attestcoin Protocol Integration Summary

Paste as one block. 372 words. This mirrors the depth table in `docs/SPEC.md` §8 as prose.

```
Attestcoin is not a feature of Humanline. It is the only reason Humanline can exist without a trusted operator, and it is load-bearing in ten distinct places.

Every root enters through ASCBase.execute, which calls verifyAndEmit on the BlockProver precompile at 0x0FD2. No root reaches the World ID verifier by any other path. There is no admin setter, no fallback, and no degraded mode.

The worker batches proofs with getBatchProof, up to ten transactions sharing one continuity proof inside a 1000-block window, and submits them through executeBatch. World's sequencer updates the identity tree roughly hourly, so an hour of tree activity lands in a small number of batches.

Inside the contract, EvmV1Decoder does the real work. decodeReceiptFields gives the receipt status, and a status other than 1 reverts: a reverted registerIdentities must never advance the tree. getLogsByEventSignature finds the TreeChanged logs, and the log's indexed topics carry preRoot, kind and postRoot. decodeCommonTxFields gives the destination and the calldata, which we decode independently to cross-check the roots against the log and to extract the number of identity commitments, which is the number of humans added. A mismatch between calldata and log reverts.

Emitter binding is explicit at three levels: the transaction's to must be the World ID identity manager, the emitting log address must be the same contract, and the selector must be registerIdentities or deleteIdentities. A decoy TreeChanged from an unrelated contract is skipped rather than fatal, so an attacker cannot grief the relay by emitting one.

calculateTxIndex supplies the queryId, which is both the replay key enforced by ASCBase and the ordering evidence surfaced in the RootRelayed event as sourceTxIndex.

Two more precompiles guard the edges. ChainInfo at 0x0FD3 gives the attested tip for the source chain, and a root is accepted only once it is at least 32 blocks behind it. AttestorStash at 0x0FD4 gives the bonded attestor count, and a thin attestor set is refused.

We run two source chains: Ethereum mainnet at chainKey 3 for production Orb roots, and Ethereum Sepolia at chainKey 1 for the staging tree, so a judge can reproduce the entire flow with World's simulator.

On top of all of it sits a Semaphore Groth16 verifier. Without Attestcoin it has no root to verify against.
```

Word count check: run `wc -w` on the block before pasting. The form's limit is 400.

### GitHub Repository URL

```
{{REPO_URL}}
```

The README must be present at the repo root, with the one-liner, a GIF, architecture, install steps, deployed addresses and known limitations. The required technical documentation for the Attestcoin integration requirement is `docs/ATTESTCOIN_INTEGRATION.md`, linked from the README.

### Project Deck or Whitepaper (PDF URL)

```
{{DECK_URL}}
```

Source: `docs/DECK.md`. Built PDF: `docs/deck.pdf`. Host the PDF at a stable public URL, or link the raw file in the repo, before pasting.

### Prototype Demo Video URL

```
{{VIDEO_URL}}
```

Three minutes, unlisted or public, per `docs/VIDEO_SCRIPT.md`. Do not gate it behind a login.

---

## What's real

Paste this paragraph wherever the form allows extra detail, and keep it in the README. It is the statement judges will check first.

```
The World ID roots in this submission are real. They come from World's own sequencer updating the identity tree on Ethereum mainnet about once an hour, and each one arrives on Creditcoin as an Attestcoin proof verified by the 0x0FD2 precompile inside that same transaction. There is no mock verifier, no canned proof and no replayed fixture in the deployed path. The Semaphore Groth16 verification runs natively on Creditcoin CC3 on the bn128 precompiles at 0x06, 0x07 and 0x08. The Sepolia staging path and the World simulator are there so a judge can reproduce personhood verification end to end without an Orb, and it is the same code. What is testnet-only: hUSD is a test stablecoin we mint, lender deposits are testnet funds, and the demo deployment shortens loan terms to minutes so a full borrow and repay cycle fits in the video. What we do not claim: Attestcoin cannot prove that a payment did not happen, so a default is declared from a passed deadline plus the absence of a repayment on Creditcoin, which is native state, not a cross-chain absence claim.
```

---

## Deployed addresses

Paste into the form's description if space allows, and into the README regardless.

| Contract | Address (CC3 testnet, chainId 102031) |
|---|---|
| `AttestedWorldID` (Ethereum mainnet, chainKey 3) | `{{ADDRESS_ATTESTED_WORLDID_MAINNET}}` |
| `AttestedWorldID` (Ethereum Sepolia, chainKey 1) | `{{ADDRESS_ATTESTED_WORLDID_SEPOLIA}}` |
| `HumanRegistry` | `{{ADDRESS_HUMAN_REGISTRY}}` |
| `CreditLine` | `{{ADDRESS_CREDIT_LINE}}` |
| `hUSD` | `{{ADDRESS_HUSD}}` |
| `HumanGate` (example integration) | `{{ADDRESS_HUMAN_GATE}}` |

Explorer: `https://creditcoin-testnet.blockscout.com`. All six verified on Blockscout.

---

## Team Information

Minimum team size is one. Fill one block per member. Every field marked optional may be left blank, but a blank Telegram ID means the organizers cannot reach you quickly during judging, so fill it.

### Member 1

| Field | Value |
|---|---|
| First & Last Name | Raj Karia |
| Email | `{{TEAM_1_EMAIL}}` |
| Telegram ID (optional) | `{{TEAM_1_TELEGRAM}}` |
| X / Twitter (optional) | `{{TEAM_1_X}}` |
| LinkedIn (optional) | `{{TEAM_1_LINKEDIN}}` |
| Resume (PDF URL, optional) | `{{TEAM_1_RESUME_URL}}` |
| Role within the team | Sole builder: contracts, relay worker, web app, documentation |
| Country of Residence | `{{TEAM_1_COUNTRY_RESIDENCE}}` |
| Country of Citizenship | `{{TEAM_1_COUNTRY_CITIZENSHIP}}` |

Short Bio (keep to about 60 words):

```
{{TEAM_1_BIO}}
```

### Member N (template, copy as needed)

| Field | Value |
|---|---|
| First & Last Name | `{{TEAM_N_NAME}}` |
| Email | `{{TEAM_N_EMAIL}}` |
| Telegram ID (optional) | `{{TEAM_N_TELEGRAM}}` |
| X / Twitter (optional) | `{{TEAM_N_X}}` |
| LinkedIn (optional) | `{{TEAM_N_LINKEDIN}}` |
| Resume (PDF URL, optional) | `{{TEAM_N_RESUME_URL}}` |
| Role within the team | `{{TEAM_N_ROLE}}` |
| Country of Residence | `{{TEAM_N_COUNTRY_RESIDENCE}}` |
| Country of Citizenship | `{{TEAM_N_COUNTRY_CITIZENSHIP}}` |

Short Bio:

```
{{TEAM_N_BIO}}
```

---

## Eligibility and terms

Confirm each before submitting. These are the organizers' stated conditions, and the form asks you to affirm them.

- [ ] Every team member has no criminal record and no pending criminal cases.
- [ ] No team member is a resident of a sanctioned country.
- [ ] No team member is a sanctioned individual.
- [ ] Every team member is legally permitted to participate under their local law.
- [ ] The work is original and was created during the hackathon.
- [ ] The project is deployed on a testnet. (CC3 testnet, chainId 102031.)
- [ ] The project integrates the Attestcoin Protocol as a core feature.
- [ ] The project does not infringe third-party IP. (Vendored World ID bridge and Semaphore verifier are MIT, attribution retained in `contracts/vendor/worldid/`. Humanline's own code is MIT, see `LICENSE`.)
- [ ] All submitted information is accurate and truthful.

---

## Pre-submit checklist

- [ ] Contracts deployed and verified on Blockscout; every address token above replaced.
- [ ] Relay worker running and `/relay` showing a mainnet root relayed within the last few hours.
- [ ] Web app live at `{{LIVE_URL}}` with no build errors and no "not deployed yet" banner.
- [ ] README present at repo root with the one-liner, addresses and known limitations.
- [ ] `docs/ATTESTCOIN_INTEGRATION.md` present and linked from the README (this satisfies the technical documentation requirement).
- [ ] `docs/deck.pdf` built and hosted; `{{DECK_URL}}` replaced.
- [ ] Video recorded, uploaded, ungated; `{{VIDEO_URL}}` replaced.
- [ ] Description block under 300 words and integration summary under 400 words, both checked with `wc -w`.
- [ ] Foundry suite green, worker tests green, negative-path suite runnable without a wallet.
- [ ] Submitted before 2026-09-13 23:59 ET, not at 23:58.
