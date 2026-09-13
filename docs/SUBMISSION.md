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
https://raw.githubusercontent.com/rajkaria/humanline/main/docs/brand/humanline-logo-480.png
```

480 × 480 PNG, 106 KB (form limit 2 MB), rendered from `docs/brand/humanline-logo.svg` (the same mark as `web/app/icon.svg`). Upload the file directly where the form asks for an image.

### Project Sector

```
DeFi
```

If the form shows Category instead (Crypto / Web3, Quantum Computing, Space, AI / Robotics, Other), choose **Crypto / Web3**. Secondary fit is RWA. The sector field takes one value, and DeFi is correct: this is a lending pool with an identity primitive under it. Do not select AI.

### Project Description

Paste as one block. Under the 300-word limit (check with `wc -w`).

```
One human, one credit line. Prove you're a person once with World ID. Humanline carries that proof from Ethereum to Creditcoin through the Attestcoin Protocol, verifies the zero-knowledge proof on Creditcoin itself, and gives you an uncollateralized credit line that follows you, not your wallet.

Creditcoin's mission is credit history for people the banking system cannot see. Every uncollateralized design on the chain has the same hole underneath it: a wallet is not a person. A borrower can open ten wallets, repay themselves ten times, and default on the eleventh loan at full size. We built Humanline to close that hole.

World ID has Orb-verified humans concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia, which are Creditcoin's markets. Its identity tree lives on Ethereum, and the only ways across were a trusted bridge or a trusted oracle. Attestcoin removes both.

AttestedWorldID relays World's real identity-tree roots from Ethereum mainnet and Sepolia, each verified by the 0x0FD2 precompile and guarded by ChainInfo finality and AttestorStash quorum. HumanRegistry verifies a Semaphore proof natively on Creditcoin and binds the nullifier to a wallet. CreditLine opens one line per nullifier, with total credit capped by the attestors' bonded stake, so history and defaults follow the person across wallets.

Anyone can relay: from their own wallet in the app, or through a vault that pays them. Twelve attacks are refused by name against the live contracts, on every load of the judge page. Builders get @humanline/sdk, a public API and HumanGated.sol; HumanPoll, one person one vote, is the first app built on it.

No owner, no pause, no upgrade. Nobody to trust, including us.
```

Word count check: run `wc -w` on the block before pasting. The form's limit is 300.

### Attestcoin Protocol Integration Summary

Paste as one block. Under the 400-word limit (check with `wc -w`). The per-surface table with file and line references is `docs/ATTESTCOIN_INTEGRATION.md` section 2.0.

```
Attestcoin is not a feature of Humanline. It is the only reason Humanline can exist without a trusted operator, and we lean on it in 22 separate places.

Every World ID root enters through verifyAndEmit on the BlockProver precompile at 0x0FD2, singly through ASCBase.execute or up to ten at a time under one continuity proof through executeBatch. There is no admin setter, fallback or degraded mode.

EvmV1Decoder does the checking Attestcoin leaves to the application. The receipt status must be 1. The transaction must call World's identity manager, exactly one TreeChanged log must come from that manager (decoys from other emitters are skipped), and the calldata, decoded independently, must agree with the log's roots. preRoot must chain to a root already held, so roots only advance along World's own chain. calculateTxIndex supplies the replay key.

ChainInfo at 0x0FD3 supplies finality: a root is accepted only 32 attested blocks deep. AttestorStash at 0x0FD4 supplies two economic guards: a floor of three bonded attestors per source chain, and a credit ceiling. CreditLine caps total outstanding principal at bonded attestors times minimum bond times a per-CTC ratio, read on every draw, so the pool never lends more than the attestors have at stake.

Two source chains run identical code: Ethereum mainnet for Orb roots and Sepolia for World's staging tree, so a judge can reproduce everything with the simulator.

Humanline does not depend on one prover or one relayer. The worker builds proofs locally with usc-sdk and matches the hosted prover byte for byte. The browser recomputes each Merkle path and continuity fold and matches it against ChainInfo before a user relays from their own wallet, and a reward vault pays anyone who relays a fresh root.

The guards are exercised against the deployed contracts, not only mocks: twelve attacks, including a forged proof, a decoy log, a wrong source chain, a replay and an oversize batch, are refused by name on every load of the judge page. Gas per batch, latency and Humanline's share of 0x0FD2 traffic are published from chain data.

On top sits a Semaphore Groth16 verifier. Without Attestcoin it has no root to verify against.
```

### What only Humanline does

For the long-form description field, if the form offers one. It names no other project.

| | |
|---|---|
| Personhood | A World ID zero-knowledge proof verified on Creditcoin against roots Attestcoin delivered. Credit, votes and claims are keyed to the human, so a new wallet is not a new person. |
| Economic security from `0x0FD4` | Total credit is capped by the attestors' bonded stake, read live on every draw. |
| Relay nobody has to trust or wait for | Self-relay from the user's wallet, a vault that pays third-party relayers, and a 5-minute cron with a watchdog. |
| Prover independence | Proofs built locally match the hosted prover byte for byte; the browser re-verifies before sending. |
| Refusals you can watch | Twelve attacks fired at the deployed contracts on page load, re-run in CI every six hours. |
| A primitive for others | `HumanGated.sol`, `@humanline/sdk`, a public API with a loan-lifecycle feed, and `HumanPoll` built on them. |

Word count check: run `wc -w` on the block before pasting. The form's limit is 400.

### GitHub Repository URL

```
https://github.com/rajkaria/humanline
```

The README must be present at the repo root, with the one-liner, a GIF, architecture, install steps, deployed addresses and known limitations. The required technical documentation for the Attestcoin integration requirement is `docs/ATTESTCOIN_INTEGRATION.md`, linked from the README.

### Project Deck or Whitepaper (PDF URL)

```
docs/deck.pdf
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
The World ID roots in this submission are real. They come from World's own sequencer updating the identity tree on Ethereum mainnet about once an hour, and each one arrives on Creditcoin as an Attestcoin proof verified by the 0x0FD2 precompile inside that same transaction. There is no mock verifier, no canned proof and no replayed fixture in the deployed path. The Semaphore Groth16 verification runs natively on Creditcoin CC3 on the bn128 precompiles at 0x06, 0x07 and 0x08. Humanline is deployed twice against those same roots: once verifying against World's Sepolia staging tree, so a judge can reproduce personhood verification end to end with the World simulator and no Orb, and once verifying against the Ethereum mainnet Orb tree with 30-day terms, which is what a real verified human uses. Same code, same relayed roots, one switch on the page. What is testnet-only: hUSD is a test stablecoin we mint, lender deposits are testnet funds, and the demo deployment shortens loan terms to minutes so a full borrow and repay cycle fits in the video. What we do not claim: Attestcoin cannot prove that a payment did not happen, so a default is declared from a passed deadline plus the absence of a repayment on Creditcoin, which is native state, not a cross-chain absence claim.
```

---

## Deployed addresses

Paste into the form's description if space allows, and into the README regardless.

| Contract | Address (CC3 testnet, chainId 102031) |
|---|---|
| `AttestedWorldID` (Ethereum mainnet, chainKey 3) | `0x1122ef3fa4ab0693809e42a00b2476efcf4468ad` |
| `AttestedWorldID` (Ethereum Sepolia, chainKey 1) | `0x3a7c3cc67034197208923587b8dc5c4674cbcef7` |
| `HumanRegistry` | `0x62c2fd99ea587e4b466175ad248468782bd5298d` |
| `CreditLine` v3 (attestor-bond exposure cap, history boost) | `0xbb97982f1138f36bfa3ba4706dad5134a10556d9` |
| `hUSD` | `0x4bd7f4c6648deb8f107932572ce7e85aca259640` |
| `HumanGate` (example integration) | `0xa3e021de49cec8819ea1bd37a8b5a9df005b776c` |
| `RelayReward` (relayer vault, shared) | `0x9766480a872ad7df2a5cf86f9e307804a3f7afe0` |
| `HumanPoll` (one person, one vote, on `HumanGated`) | `0xd7854346fea444f6ac966d2ce764a4f029e013bc` |
| `HumanLinks` | `0xbbf6f64c3aff6715c42711329e3292b3c967781c` |
| `CreditHistory` | `0xa4833b1b667a729e80248004ac91cfa3a2ff3404` |
| `EthRepay` | `0x231ce1ceb88edefad482fc6dfd49a8454cd1fc48` |

The Orb-tree deployment: the same contracts verifying against World's Ethereum mainnet identity
tree, 30-day terms, for people who actually hold an Orb-verified World ID. It shares the hUSD and
both `AttestedWorldID` instances above:

| Contract | Address (CC3 testnet, chainId 102031) |
|---|---|
| `HumanRegistry` (Orb tree) | `0x53fcba2cd9296b22635c67d5e73777b4e5db96af` |
| `CreditLine` v3 (30-day term, 7-day grace) | `0x30ca59acbf161284ed51f0412a42ecf3c9e577d7` |
| `HumanGate` (Orb tree) | `0x544264e52a12fffa5c8640eb5a91b7f4628d5b93` |
| `HumanPoll` (Orb tree) | `0x99d76bbee73f56b03ad32b8ffb304961c1b0e87d` |
| `HumanLinks` (Orb tree) | `0x78ac98d48042091c9d58ff21d29e1351cce5b327` |
| `CreditHistory` (Orb tree) | `0x803e9fdcefb1d94331da6423b8fb2458305e3c8a` |
| `EthRepay` (Orb tree) | `0x71c5839704528e20cb13b9fd08d5f23d6ac3f60a` |

Open it at `https://humanline.credit/app?profile=production`; the switch is on the page.

Explorer: `https://creditcoin-testnet.blockscout.com`. All eighteen contracts are verified on Blockscout,
which `scripts/submission-check.ts` re-checks daily in CI along with every transaction and page this
document cites.

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

- [x] Contracts deployed and verified on Blockscout (twelve, across both deployments); every address above is live, checked by `submission-check`.
- [x] Relay running every 5 minutes from Vercel Cron with GitHub Actions as backup, independent of any laptop; any user can self-relay, and `RelayReward` pays third parties. `/relay` shows the track record.
- [x] Twelve attacks refused by name against the deployed contracts (`bun run worker/src/cli.ts attack`), re-run every six hours in CI and live on `/judge`.
- [x] `docs/MEASUREMENTS.md` generated from the live chains; coverage 93.6% lines, mutation score and Slither triage published.
- [x] Web app live at `https://humanline.credit` with no build errors and no "not deployed yet" banner.
- [x] README present at repo root with the one-liner, addresses and known limitations.
- [x] `docs/ATTESTCOIN_INTEGRATION.md` present and linked from the README (this satisfies the technical documentation requirement).
- [ ] Vercel → Settings → Deployment Protection → Vercel Authentication set to **Off** (the custom domain is already public; this opens the `*.vercel.app` URLs too).
- [ ] `docs/deck.pdf` built and hosted; `docs/deck.pdf` replaced.
- [ ] Video recorded, uploaded, ungated; `{{VIDEO_URL}}` replaced.
- [ ] Description block under 300 words and integration summary under 400 words, both checked with `wc -w`.
- [x] Foundry suite green (234 including 14 live fork tests and 12 invariants), worker tests green (216), web tests green (411), SDK tests green (10), all runnable from a fresh clone without a wallet (`bash scripts/verify.sh`).
- [ ] `@humanline/sdk` published: `cd packages/sdk && npm publish --access public` (maintainer action).
- [ ] Submitted before 2026-09-13 23:59 ET, not at 23:58.
