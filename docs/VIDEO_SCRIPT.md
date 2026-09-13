# Humanline: Demo Video Script

Target length **2:40**, hard ceiling 3:00. About 400 words of voiceover at a calm 150 words per minute, which leaves room for pauses on the explorer tabs. Record at 1920x1080 with the browser at 100 percent zoom and the dark theme. Hide bookmarks and extensions so only the URL bar shows. No music. Hard cuts only.

The rule for the whole video: **every claim on screen is a real transaction, and the viewer sees at least one of them open in a block explorer.** Anything too slow to film live (Attestcoin attestation takes about 15 minutes, and a default needs a term to expire) is shown as a receipt on `/judge`, with its hash opened. Never fake it, and never speed up a confirmation.

Final URL: {{VIDEO_URL}} · Live app: https://humanline.credit · Repo: https://github.com/rajkaria/humanline

---

## Before you record

**Chain state**
- The Aave repay proof has landed (`seed-demo-repay` row in `evidence/seed-demo.jsonl`) and `CreditHistory.boostOf(human 2) > 0`. If it has not, cut the words "and repaid" from beat 6.
- `/relay` has a mainnet root from the last hour at the top.
- `/judge` → *Live refusals* reads **12/12 refused** when it loads. Reload once before recording so it is warm.

**Wallets**
- **Wallet A**: a fresh CC3 wallet with tCTC, not yet a human. This is the one you verify live.
- **Wallet B**: the seeded demo human with an open line and hUSD, for the borrow beat.
- World ID simulator open in its own tab on the staging environment. If Raj's Orb test has passed, use the World App on your phone for beat 4 instead and say "Orb-verified". Otherwise say "staging tree".

**Tabs, left to right**
1. `https://humanline.credit` (landing)
2. `https://humanline.credit/relay`
3. `https://humanline.credit/app`
4. World ID simulator
5. `https://humanline.credit/judge`
6. Blank tab for Etherscan and Blockscout clicks

**Read these off the live pages at record time, never from this file:** roots relayed, humans registered, attestor count, and the security budget figure.

---

## The 2:40 cut

### 1 · 0:00 to 0:15 · Hook

**Show.** Landing hero, holding still for two seconds. Scroll slowly to the section titled *"A wallet is not a person."*

**Say.**
> "Creditcoin exists to give credit history to people banks can't see. But every credit score on this chain scores a wallet, and a wallet is free. Open ten, repay yourself ten times, then default on the eleventh at full size."

### 2 · 0:15 to 0:30 · The idea

**Show.** Keep scrolling to the *Wallet passports vs Humanline* table. Hover over the rows "Cost to reset the score" and "A default".

**Say.**
> "Humanline scores the person. You prove you're human once with World ID. Your credit line, your history, and your defaults all attach to that proof, not to a key. Resetting your score doesn't take a new wallet. It takes a second iris."

### 3 · 0:30 to 0:55 · Attestcoin carries World ID across

**Show.** Open `/relay` and point at the top row: Ethereum tx, Creditcoin tx, pre root to post root, lag. Click the **Ethereum hash**, and Etherscan shows `registerIdentities` on World's identity manager. Go back. Click the **Creditcoin hash**, and Blockscout shows the relay call with the same post root. Keep the root on screen for a full second.

**Say.**
> "The problem is that World ID lives on Ethereum, and Creditcoin can't see it. So every identity-tree update World makes arrives here as an Attestcoin proof. On the left is World's own transaction on Ethereum. On the right is the same root on Creditcoin, checked by the BlockProver precompile in the transaction that adopts it. There's no bridge, no oracle, and no admin key."

### 4 · 0:55 to 1:20 · Become a human, live

**Show.** Open `/app` and connect **Wallet A**. The status card reads not verified. Click verify. The IDKit widget opens. Switch to the simulator tab, hold there for one second, and approve. Back in the app, the registration transaction confirms and the card flips to **Human** with a short nullifier. Click the transaction link, and Blockscout shows `HumanRegistered`.

**Say.**
> "Now I become a human. That's a zero-knowledge proof, and it's verified on Creditcoin itself, on the bn128 precompiles, against a root Attestcoin delivered. This wallet is now bound to a nullifier, and the nullifier is the person."

*(While the confirmation runs, let it breathe. If it takes more than 20 seconds, cut straight to the Blockscout tab.)*

### 5 · 1:20 to 1:40 · One human, one credit line

**Show.** Switch to **Wallet B**. On the credit panel, show the starting limit, the ceiling, and the fee. Borrow 20. The balance updates and the *Due in* countdown starts. Scroll down to the *Lender pool* security budget bar.

**Say.**
> "One human gets one credit line, with no collateral. I borrow twenty. Repay on time and the limit grows. Default and it freezes. And the pool can never lend more than the Attestcoin attestors have bonded, a number this contract reads live from the chain on every draw."

### 6 · 1:40 to 2:05 · Credit history from Ethereum

**Show.** On `/app`, scroll to the *Ethereum history* panel. Show *Linked wallets* and *Verified Aave repayments*. Then go to `/judge` → *What has already happened* and show the HumanLinks row plus the Sepolia and Creditcoin hash pairs for the Aave borrow and repay. Open one Sepolia hash on Etherscan so the Aave Pool `Repay` event is visible.

**Say.**
> "Your history isn't stuck on one chain either. Link an Ethereum wallet with a signature, and a real Aave loan you borrowed and repaid on Ethereum gets proven to Creditcoin through Attestcoin and raises your limit here. You can even repay a Creditcoin loan by paying on Ethereum. Nobody vouches for any of it. The proof does."

### 7 · 2:05 to 2:20 · A default follows the person

**Show.** Stay in *What has already happened* and scroll to the default block: *Wallet that defaulted* → *New wallet, same human* → *Borrow from the new wallet*, which reads **refused**. Open the default transaction's hash on Blockscout so the frozen line is visible.

**Say.**
> "Here's what no wallet-based score can do. This human defaulted, moved to a brand new wallet, and tried to borrow again. The chain refused, because the default is attached to the person, and the person came along."

### 8 · 2:20 to 2:32 · Twelve attacks, refused by name

**Show.** Scroll to *Live refusals*. Twelve rows, each with a named error. Hold on `ThinQuorum` and `WrongSourceChain`.

**Say.**
> "And don't take our word for any of this. This page just fired twelve attacks at the live contracts: a forged proof, a decoy event, a replay, the wrong chain. Every one is refused by name, and a cron job re-runs them every six hours."

### 9 · 2:32 to 2:40 · Close

**Show.** Cut back to the landing page's *Live protocol readout*. Hold for three seconds. Then show an end card with `humanline.credit`, `github.com/rajkaria/humanline`, and `npm i @humanline/sdk`.

**Say.**
> "Eighteen contracts, no owner, no pause, and nobody to trust, including us. One human, one credit line."

---

## Optional 20-second insert (use it if you're under 2:40)

Place it between beats 8 and 9.

**Show.** `/vote` shows the HumanPoll results. Then the `packages/sdk` README on GitHub, showing the `HumanGated` modifier.

**Say.**
> "Personhood is a primitive, so we shipped it as one: an SDK, a public API, and a Solidity modifier. The first app built on it is a one person, one vote poll."

---

## 60-second cut (for X and the DoraHacks thumbnail)

Same footage, beats 1, 3, 4, 7 and 9.

| Time | Show | Say |
|---|---|---|
| 0:00–0:10 | Landing hero, then *A wallet is not a person* | "Every credit score on Creditcoin scores a wallet. A wallet is free. Open ten, and default on the eleventh." |
| 0:10–0:25 | `/relay` row, Etherscan then Blockscout | "Humanline brings World ID from Ethereum to Creditcoin through Attestcoin. There's no bridge and no oracle, just a proof the chain verifies itself." |
| 0:25–0:40 | Verify in `/app`, card flips to Human | "Prove you're human once, and one person gets one uncollateralized credit line." |
| 0:40–0:52 | `/judge` default block, refused borrow | "Default, switch wallets, and try again. The chain refuses, because the default follows the person." |
| 0:52–1:00 | Live readout, end card | "Nobody to trust, including us. One human, one credit line." |

---

## Capture notes

- **Pronouns and wording.** Say "yourself", "the borrower", and "this human". Don't gender the borrower.
- **Numbers.** Say only what's on screen. Don't round anything up. If the counter says 41 roots, say 41 or say nothing.
- **"Orb" versus "staging".** Say "Orb-verified" only if the live verify in beat 4 used a real Orb identity. The simulator is the staging tree, so say so.
- **Aave beat.** It needs both the borrow and repay rows to be live. If you record before the repay proof lands, say "a real Aave borrow on Ethereum, proven to Creditcoin" and drop "and repaid".
- **Failed takes.** If a transaction fails on camera, keep rolling and redo the beat. Splice at the tab switch.
- **Upload.** Use YouTube, unlisted is fine, then replace `{{VIDEO_URL}}` here and in `docs/SUBMISSION.md`.
