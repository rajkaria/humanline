# Humanline: Demo Video Script

Target length 3:00. Delivery is calm and flat, about 150 words per minute. Total voiceover below is roughly 440 words, which leaves room to breathe on the transaction confirmations. Record the screen at 1920x1080, browser at 100 percent zoom, dark theme, no browser chrome except the URL bar.

Follow SPEC §11. Every claim on screen must be a real transaction, and every transaction must be clicked through to an explorer at least once.

Final URL: {{VIDEO_URL}} · Live app: https://humanline.credit · Repo: https://github.com/rajkaria/humanline

---

## Pre-roll checklist

- Relay worker running, with at least one mainnet root relayed in the last hour so `/relay` has a fresh row at the top.
- Two Creditcoin CC3 wallets funded with tCTC, both with hUSD from the faucet. Wallet A is unregistered. Wallet B is unregistered.
- World simulator open in a second tab, staging environment, ready to approve.
- `CreditLine` deployed with demo terms (`TERM` 600 seconds, `GRACE` 300 seconds) so a full borrow and repay cycle fits inside the video.
- Lender pool already funded, so `openLine` and `borrow` do not fail on liquidity.
- Terminal open at the repo root with the negative-path command copied, ready to paste.
- Browser tabs pre-opened in order: `/relay`, `/app`, Etherscan, Blockscout, `/judge`.

---

## 3:00 cut

### 0:00 to 0:12 · Hook

**On screen.** Cold open on the landing page hero. The one-liner is visible. Slow cursor move to the live counter block: roots relayed, humans registered, credit extended.

**Voiceover.** "Creditcoin exists to give credit history to people the banking system cannot see. But every credit score on this chain scores a wallet. A wallet is free. One person can hold ten of them."

### 0:12 to 0:28 · The problem

**On screen.** Scroll to the comparison block on the landing page: wallet passports on the left, Humanline on the right. Hold on the line "every other passport can be forged by generating a new wallet".

**Voiceover.** "So a borrower repays himself ten times, mints ten perfect histories, and defaults on the eleventh loan at full size. Proof of personhood fixes that, but World ID lives on Ethereum. Creditcoin cannot see it, and a bridge or an oracle means trusting someone."

### 0:28 to 0:45 · Real roots landing on Creditcoin

**On screen.** Navigate to `/relay`. The table is already populated. Point at the top row: source Ethereum mainnet, Ethereum transaction hash, Creditcoin transaction hash, pre root to post root, humans added, attestation lag.

**Voiceover.** "This is the World ID root feed. World's sequencer updates the identity tree on Ethereum mainnet about once an hour. Each update is a real transaction, and each one arrives here as an Attestcoin proof."

### 0:45 to 1:05 · Click through both sides

**On screen.** Click the Ethereum transaction hash. Etherscan opens, showing `registerIdentities` on the World ID identity manager and the `TreeChanged` event. Back. Click the Creditcoin transaction hash. Blockscout opens, showing the `execute` call and the `RootRelayed` event with the same post root.

**Voiceover.** "Left side, World's own transaction on Ethereum. Right side, the same root on Creditcoin, verified by the BlockProver precompile inside this transaction. No bridge, no oracle, no operator. The finality depth and the attestor quorum are checked on chain against the ChainInfo and AttestorStash precompiles."

### 1:05 to 1:25 · Become a human

**On screen.** Navigate to `/app`. Connect wallet A. Status card reads "Not verified". Click "Verify you're human". The IDKit widget opens. Switch to the World simulator tab and approve.

**Voiceover.** "Now the other direction. I connect a Creditcoin wallet. It is not a human yet. I prove personhood with World ID. This is the staging tree and the World simulator, so you can reproduce it without an Orb. The production path is identical."

### 1:25 to 1:45 · The proof verifies on Creditcoin

**On screen.** The registration transaction is submitted. One block later it confirms. The status card flips to "Human" with a shortened nullifier. Click the transaction link to Blockscout, show `HumanRegistered`.

**Voiceover.** "That is a Semaphore zero-knowledge proof, verified on Creditcoin itself, on the bn128 precompiles, against a root that Attestcoin put there. The wallet is now bound to a nullifier. The nullifier is the human."

### 1:45 to 2:05 · Open a line and borrow

**On screen.** Click "Open line". Limit shows 25 hUSD. Borrow 20. Balance updates. Countdown to the due date starts.

**Voiceover.** "One human, one credit line. It opens at twenty five dollars, uncollateralized. I borrow twenty. Nothing was locked, nothing was staked. The only thing backing this is that there is exactly one of me."

### 2:05 to 2:25 · Repay and grow

**On screen.** Approve hUSD, repay the full balance. `Repaid` and `LimitChanged` events appear in the history table. Limit ticks up to 31.25 hUSD.

**Voiceover.** "Repay on time and the limit grows by a quarter. Repay late and it halves. Miss the grace window entirely and the line freezes, permanently, on the nullifier."

### 2:25 to 2:40 · The line follows the person

**On screen.** Disconnect. Connect wallet B. Verify with the same simulated identity. The registration re-binds. The credit panel loads with the same limit, the same history, the same nullifier. Attempt "Open line" and show the `LineExists` revert in the toast.

**Voiceover.** "New wallet, same person. The identity re-binds and the whole history follows. A second line is refused. This is the part no other credit passport can do, and it is the part that makes a default mean something."

### 2:40 to 2:52 · Every attack, by name

**On screen.** Navigate to `/judge`. Paste the negative-path command in the terminal and run it. Test names scroll past in green: forged root, decoy `TreeChanged`, replayed query, out of order root, wrong source chain, reverted transaction, proof bound to another wallet, double registration, borrow over limit, frozen after re-bind.

**Voiceover.** "Attestcoin proves inclusion and continuity. Everything else is our job. Forged roots, decoy events, replays, out of order roots, proofs bound to another wallet. Every one is rejected by a named error, and every one has a test."

### 2:52 to 3:00 · Close on the counter

**On screen.** Cut back to the landing page counter block. The three numbers are live and reading from chain. Hold. Fade to the repo URL and the contract addresses.

**Voiceover.** "Right now: N real World ID roots relayed from Ethereum mainnet, M humans in the registry, and zero trusted parties anywhere in the path. One human, one credit line."

---

## 60 second cut

Same footage, tighter. Roughly 150 words of voiceover.

### 0:00 to 0:10 · Hook

**On screen.** Landing hero, then the comparison block.

**Voiceover.** "Every credit score on Creditcoin scores a wallet. A wallet is free. One person can hold ten, repay themselves ten times, and default on the eleventh."

### 0:10 to 0:25 · Real roots

**On screen.** `/relay` top row, then a fast cut between the Etherscan tab and the Blockscout tab showing the same post root.

**Voiceover.** "Humanline brings World ID's identity tree from Ethereum to Creditcoin through the Attestcoin Protocol. World's real transaction on the left. The same root on Creditcoin on the right, verified by the BlockProver precompile. No bridge, no oracle."

### 0:25 to 0:40 · Become a human, get credit

**On screen.** `/app`, verify with the simulator, registration confirms, status flips to Human. Cut straight to open line, borrow 20, repay, limit grows to 31.25.

**Voiceover.** "A Semaphore zero-knowledge proof, verified on Creditcoin itself. The wallet is now bound to a nullifier. One human, one line. Twenty five dollars uncollateralized, growing a quarter every time it is repaid on time."

### 0:40 to 0:52 · The line follows the person

**On screen.** Second wallet, same identity, history follows, `LineExists` revert on the second open attempt.

**Voiceover.** "New wallet, same person. The history follows, and so does a default. That is what no other credit passport can do."

### 0:52 to 1:00 · Close on the counter

**On screen.** Landing counter block, live. Fade to repo URL.

**Voiceover.** "N real World ID roots relayed from Ethereum mainnet, M humans in the registry, zero trusted parties. One human, one credit line."

---

## Capture notes

- Replace N and M in the closing line with the live counter values at record time. Read them off the page rather than from a script, and do not round up.
- Do not speed up any transaction confirmation. Creditcoin blocks are about fifteen seconds. If a confirmation runs long, cut on the block explorer instead of on the app.
- The attestation lag column on `/relay` should be visible at least once. It is the honest number and it makes the rest of the claims credible.
- Keep the World simulator tab visible for a full second before approving, so a judge can see it is the staging environment and not a mock we wrote.
- No music. No transitions except hard cuts.
