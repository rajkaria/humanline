# Humanline: Pitch Deck

BUIDL CTC 2026 Fall · Track: DeFi · Creditcoin & Credit Labs

Twelve slides. Each H2 is one slide. The `visual:` line describes the graphic for that slide. The PDF built from this file is `docs/deck.pdf`.

Live: https://humanline.credit · Repo: https://github.com/rajkaria/humanline

The live counters on slide 12 were read off the deployed landing page on 2026-09-12 and are not
rounded up. They keep rising while the relayer cron runs, so re-read them and rebuild before
sending the PDF if it has been a while.

Rebuild: `bun add pptxgenjs && bun run docs/deck-build.js docs/deck.pptx && soffice --headless --convert-to pdf --outdir docs docs/deck.pptx`. The editable source is `docs/deck.pptx`.

---

## 1. A wallet is not a person

- Creditcoin was built to give credit history to people the banking system cannot see.
- Every uncollateralized lending design on the chain scores a wallet.
- A wallet costs nothing. One person can hold ten, repay themselves ten times, and default on the eleventh loan at full size.
- Humanline makes the borrower the thing that carries the debt, not the key.
- One human, one credit line. Proven with zero-knowledge, on Creditcoin, with no operator in the path.

visual: One human silhouette on the left. Ten wallet icons fanning out to the right, each with a green "score: 800" badge. A single red arrow from the human to an eleventh wallet labeled "default". Underneath, the line "a wallet is not a person" in large type.

## 2. The problem: uncollateralized credit needs a unique borrower

- Aella runs BNPL for more than a million users and records loans on Creditcoin through Credal.
- A lender extending credit without collateral has exactly one question: will this person come back, and is there one of them.
- On-chain history answers the first question. Nothing on Creditcoin answers the second.
- Proof of personhood exists. World ID has Orb-verified humans concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia, which are Creditcoin's markets.
- But World ID's identity tree lives on Ethereum. Creditcoin cannot see it.
- The only ways across today are a trusted bridge or a trusted oracle, which is the exact thing the Attestcoin Protocol exists to remove.

visual: Two-panel map. Left panel: Ethereum, with the World ID tree and the Orb identity manager address. Right panel: Creditcoin, with a lender and a borrower. Between them a broken bridge, with the two available planks labeled "trusted bridge" and "trusted oracle", both struck through in red.

## 3. The 30-passport trap

- When we surveyed the gallery on 2026-09-12 it held 87 submissions. About 30 were credit passports built on the same pattern: read loan repayments on Sepolia, mint a score.
- Ten are AI guardrails. Nine are escrow-on-proof. Zero touch identity. Zero use zero-knowledge proofs. Zero do proof of personhood.
- The entire field scores an address, and an address is free.
- Every one of those passports can be forged by generating a new wallet. Not hacked. Generated.
- That is the trap: a perfect score that means nothing, because the thing being scored is not the thing that owes the money.

visual: A grid of 87 small tiles, 30 tinted one color and labeled "credit passport", the rest gray. One tile at the edge is highlighted and labeled "Humanline". A caption band across the grid reads "0 identity · 0 ZK · 0 proof of personhood".

## 4. The insight: the nullifier is the human

- A World ID nullifier is derived from an Orb iris scan and an action string. It is the same value whatever wallet the person uses.
- Bind the nullifier, not the address. Keep every piece of state keyed by it.
- Re-bind to a new wallet and the identity, the limit and the history all move with the person.
- Default, and the freeze attaches to the nullifier. It survives a new wallet, a new key, a new device, forever.
- The forgery that breaks every other credit passport costs nothing. Forging a Humanline identity costs a second iris.

visual: A single nullifier hash in monospace at the center. Three wallet addresses orbiting it, one grayed out and labeled "unbound", one current, one future. A red "FROZEN" stamp across all three, anchored to the hash rather than to any address.

## 5. How it works

- World's sequencer calls `registerIdentities` on Ethereum mainnet roughly hourly, emitting `TreeChanged(preRoot, kind, postRoot)`.
- Our worker builds an Attestcoin proof of that transaction and calls `execute` on `AttestedWorldID` on Creditcoin.
- The `0x0FD2` BlockProver precompile verifies inclusion. `EvmV1Decoder` pulls the log and the calldata out of the receipt. The contract cross-checks them, chains `preRoot` to the last known root, and stores the new root.
- A user proves personhood with World App or the simulator. `HumanRegistry` verifies the Semaphore Groth16 proof natively on Creditcoin against that root, using the bn128 precompiles at `0x06`, `0x07` and `0x08`.
- `CreditLine` opens one line per nullifier. Borrow, repay on time, the limit grows 25 percent. Repay late, it halves. Miss the grace window and it freezes.
- No owner, no pause, no upgrade, anywhere in the system.

visual: Left-to-right flow in five boxes. Ethereum mainnet (World ID manager) into Worker (Attestcoin proof) into AttestedWorldID on Creditcoin (0x0FD2 / 0x0FD3 / 0x0FD4 badges) into HumanRegistry (ZK badge, bn128) into CreditLine (limit meter). A dotted line drops from the user's phone into HumanRegistry labeled "Semaphore proof".

## 6. Attestcoin depth: every surface load-bearing

| Surface | Where it runs | Why it is load-bearing |
|---|---|---|
| `verifyAndEmit` (`0x0FD2`) | `ASCBase.execute` | No root reaches the verifier without it |
| Batch verification | Worker `getBatchProof`, on-chain `executeBatch` | Up to 10 proofs under one continuity proof |
| Calldata decoding | `decodeCommonTxFields(tx).data` | Yields `postRoot` and the count of humans added |
| Log decoding | `getLogsByEventSignature` on `TreeChanged` | The root itself |
| Emitter and status binding | `to == manager`, `log.address_ == manager`, `status == 1` | Rejects look-alike events and reverted transactions |
| `calculateTxIndex` | `queryId` and `sourceTxIndex` | Replay key and ordering evidence |
| ChainInfo (`0x0FD3`) | Finality depth guard | A root is accepted only 32 blocks behind the attested tip |
| AttestorStash (`0x0FD4`) | Quorum floor and credit ceiling | Refuses roots attested by a thin set; caps total credit at the attestors' bonded stake, read on every draw |
| Two source chains | mainnet `chainKey 3`, Sepolia `chainKey 1` | Production and judge-reproducible paths |
| Zero-knowledge on top | Semaphore over an Attestcoin-anchored root | Without Attestcoin the verifier has no trusted root |
| Local proofs, browser verification | usc-sdk `RawProofBuilder`; Merkle path and continuity fold matched to ChainInfo | No dependence on one prover; nothing unverified is ever signed |

- Remove Attestcoin and Humanline has no roots, no humans and no credit. There is no degraded mode.
- Measured, not asserted: 93.6% line coverage, 12 invariants, a scripted mutation score, and twelve attacks refused by name against the deployed contracts (`docs/MEASUREMENTS.md`).

visual: The rows as a vertical stack of chips on the left, each drawing a line into a single block on the right labeled "AttestedWorldID". Below the block, three dependent boxes: roots, humans, credit, each grayed out with the caption "without Attestcoin".

## 7. What is real

- Real: Ethereum mainnet World ID roots, produced by World's own sequencer about once an hour, relayed unattended into Creditcoin.
- Real: an Attestcoin proof verified by the `0x0FD2` precompile inside every single relay transaction. No mock, no fixture, no replay of a canned proof.
- Real: Groth16 Semaphore verification executing on Creditcoin CC3, on the bn128 precompiles, in one block.
- Real: Sepolia staging roots and World simulator proofs, so a judge can reproduce the whole flow without an Orb.
- Testnet only: `hUSD` is a test stablecoin we mint, lender deposits are testnet funds, and the demo deployment uses minute-long loan terms so a full cycle fits in a video.
- Not claimed: Attestcoin cannot prove a payment did not happen. Default is declared from a passed deadline plus the absence of a repayment on Creditcoin, which is native state, not a cross-chain absence claim.

visual: Two columns, green and amber. Green column lists the four real items with a Blockscout or Etherscan transaction hash beside each. Amber column lists the testnet-only and not-claimed items. No third column.

## 8. Demo

- `/relay`: a real Ethereum root landing on Creditcoin. Click through to the Ethereum transaction and the Creditcoin transaction, and read the humans-added count decoded from the calldata.
- `/app`: connect a Creditcoin wallet, verify with the World simulator, watch the registration confirm in one block. The wallet becomes a human.
- Credit: open a line at 25 hUSD, borrow 20, repay, watch the limit grow to 31.25. Every action links to the explorer.
- Re-bind: a second wallet, the same simulated identity. The line and the history follow the person. A second line is refused with `LineExists`.
- `/judge`, no wallet: twelve attacks fired at the deployed contracts as the page loads, each refused by name (`ThinQuorum(7, 1000)`, `WrongSourceChain(1, 3)`, `BatchTooLarge(11)` …).
- `/vote`: `HumanPoll`, one person one vote, built only on the SDK's `HumanGated`. A second wallet does not buy a second ballot.
- Close on the counter: N real World ID roots relayed, M humans in the registry, zero trusted parties.

visual: Six screenshot placeholders in a two-by-three grid, each captioned with the step above and the on-chain artifact it produces. Bottom-right tile is the live counter block from the landing page.

## 9. Security: what Attestcoin proves, and what we add

- Attestcoin proves two things: this transaction was included in an attested block, and this receipt belongs to it. That is all it proves, and it is enough.
- Everything else is our job. Ten checks sit on top: receipt status, source contract, emitter binding, selector and calldata agreement with the log, root chaining, finality depth, attestor quorum, replay by `queryId`, root-history expiry, and nullifier uniqueness.
- A decoy `TreeChanged` emitted by an unrelated contract is skipped, not fatal. Two genuine ones in the same transaction revert as ambiguous.
- Out-of-order roots revert. Replayed queries revert. Proofs bound to a different wallet revert, because the signal is the caller.
- A frozen human stays frozen across a re-bind. That test exists and it is the one that matters.
- The same attacks run against the live deployment, not just mocks, and the answers are recorded: 12 of 12 refused.
- No admin keys. Every constant is an immutable. Anyone can relay, and the contracts do not care who does.

visual: A layered shield diagram. Inner core labeled "Attestcoin: inclusion + continuity". A ring around it split into ten labeled segments, one per check. Around the outside, four attack arrows (forged root, decoy log, replay, sybil wallet) bouncing off specific segments with the error name printed on each arrow.

## 10. Market and business

- Creditcoin's mission is the market: uncollateralized credit for people without a bank file, in exactly the countries World has been sending Orbs to.
- The product is a personhood layer with a lending business on top, not a lending app with an identity feature.
- Three revenue lines: a 0.10 USD equivalent verification fee paid by the integrating lender, a spread on the deployed 1 percent per-term pool fee, and a planned 1 percent origination fee on each draw.
- A well-behaved first-year borrower draws about 281 USD cumulatively across six growing terms and returns roughly 3.76 USD. Modeled from the deployed contract parameters, not measured.
- The compounding asset is the shared default record. One lender gets sybil resistance. Ten lenders sharing one registry get a credit bureau that nobody operates.
- Every integration, every repayment and every root is Attestcoin volume.

visual: A limit-growth staircase chart, 25 to 31.25 to 39.06 to 48.83 to 61.04 to 76.29 across six terms, with the cumulative draw and cumulative revenue called out at the end. Inset: three stacked revenue bars labeled verification, origination, spread.

## 11. Roadmap, and Periscope

- Built already: a public read API and loan-lifecycle feed, `@humanline/sdk` with `HumanGated.sol`, a relayer reward vault, and the cross-chain contracts (Ethereum wallet links, Aave repayment history, repay-from-Ethereum) tested against real Sepolia proofs.
- Month 1: `AttestedWorldID` and `HumanRegistry` on Creditcoin mainnet. The cross-chain contracts deployed. First Creditcoin lender using `isHuman` as a sybil check through Credal.
- Month 3: lines funded by PenguinSwap LPs. BSC as a source chain when `chainKey 8` ships.
- Month 6: supervised pilot in Kenya and Argentina with a lending partner, and a published cohort loss curve for personhood-gated credit. Nobody has one.
- **Periscope**: World ID 4.0 verification lives on World Chain, an OP-Stack rollup whose output roots are posted to Ethereum. Attestcoin already attests Ethereum. Prove the posting and you have proven the rollup.
- Periscope is not a Humanline feature. It gives Attestcoin reach into every OP-Stack rollup through a chain it already covers. Humanline is just the first application that needs it.

visual: A timeline across the bottom with three milestone markers. Above the month 6 marker, a periscope diagram: Creditcoin at the bottom looking up through Ethereum (attested) into World Chain and a row of other OP-Stack rollups, each grayed out and labeled "reachable".

## 12. The ask

- The top three teams enter the CEIP fast-track. We are asking for that, and for three specific things through it.
- **Capital** for a 6-month supervised pilot in Kenya and Argentina, with the deliverable being a published loss curve every Creditcoin lender can underwrite against.
- **A lender introduction**, to Aella or any Credal lender. The registry is one read call from being useful to a loan book that already exists.
- **Engineering support** to build Periscope with the Creditcoin team, bringing World Chain and every other OP-Stack rollup under Attestcoin.
- What we bring: infrastructure with no owner key, no upgrade path and no operator, that makes every other credit product on Creditcoin harder to defraud.
- One human, one credit line. Live at https://humanline.credit.

visual: Three ask cards side by side (capital, introduction, engineering), each with a one-line deliverable. Below them, the live counter block: roots relayed, humans registered, credit extended, and the line "zero trusted parties" in the position where a disclaimer usually goes.
