# Humanline Vision

> One human, one credit line. World ID proof of personhood reaches Creditcoin through the Attestcoin Protocol, a zero-knowledge proof is verified on Creditcoin itself, and a verified human receives an uncollateralized credit line that follows the person, not the wallet.

Live: {{LIVE_URL}} · Repo: https://github.com/rajkaria/humanline · Demo: {{VIDEO_URL}}

---

## What We Built (hackathon scope)

Three contracts and one worker, deployed on Creditcoin CC3 testnet and running unattended.

**`AttestedWorldID`** (0x1122ef3fa4ab0693809e42a00b2476efcf4468ad for Ethereum mainnet, 0x3a7c3cc67034197208923587b8dc5c4674cbcef7 for Sepolia staging) is World's own bridged-root contract from `world-id-state-bridge` (MIT), with the trusted state bridge cut out and the Attestcoin Protocol put in its place. Roots arrive as proofs of the real `registerIdentities` and `deleteIdentities` transactions on Ethereum, verified by the `0x0FD2` BlockProver precompile inside the same Creditcoin transaction that stores them. The contract still exposes `IWorldID.verifyProof`, so every existing World ID integration pattern works against it unchanged.

**`HumanRegistry`** (0x62c2fd99ea587e4b466175ad248468782bd5298d) verifies a Semaphore Groth16 proof on Creditcoin, against a root that Attestcoin put there, and binds a World ID nullifier to a Creditcoin wallet. bn128 precompiles `0x06`, `0x07` and `0x08` answer correctly on CC3, so the zero-knowledge verification is native. One human, one registration. Re-binding to a new wallet moves the identity and the history with the person. Any contract on Creditcoin can call `isHuman(address)` and `humanOf(address)`.

**`CreditLine`** (0x1bd40163e41e44d2f139d95de88b640f6ea461f7) is a lender-funded pool that opens exactly one line per human. Borrow, repay, grow the limit by 25 percent per on-time term, halve it on a late one. Miss the grace window and the line freezes on every wallet the human will ever hold. All state is keyed by nullifier, never by address. Events mirror Credal's loan lifecycle so a Creditcoin lender can index them with the code they already have.

**The worker** tails both Ethereum mainnet and Sepolia for `TreeChanged` events, batches up to 10 Attestcoin proofs behind one continuity proof, and relays them in order. Nothing in the system trusts it. A forged proof reverts at the precompile, a root out of sequence reverts at the chain rule, a replayed query reverts at `ASCBase`. There is no owner, no pause and no upgrade path. Anyone can run the worker, and if nobody does, the contracts simply stop advancing.

`HumanGate` (0xa3e021de49cec8819ea1bd37a8b5a9df005b776c) is the twenty-line example that shows a third party how to gate anything on personhood. `hUSD` (0x4bd7f4c6648deb8f107932572ce7e85aca259640) is the test stablecoin the pool lends, six decimals so amounts read like dollars.

That is the whole hackathon build. It is deployed, it is verified on Blockscout, and the relay has been running without a human touching it.

## What This Becomes

Creditcoin exists to give credit history to people the banking system cannot see. The protocol has the ledger. Credal has the lender integrations. Aella has more than a million users in Nigeria running BNPL on top of it. What none of them has is an answer to the oldest question in unsecured lending: is this the same person who borrowed last time, and is there exactly one of them.

Every credit passport in this hackathon, and there are about thirty of them, scores a wallet. A wallet is free. A borrower opens ten of them, repays himself ten times, mints ten spotless histories, and defaults on the eleventh loan at full size. The score is real. The person behind it is not.

Humanline makes the borrower's identity the thing that carries the debt. The nullifier is derived from an Orb iris scan and it is the same nullifier whatever wallet the person uses, whatever chain they move to, whatever key they lose. A default attaches to it permanently. That is the property that makes uncollateralized lending underwritable at all, and it is the property Creditcoin has been missing.

The endpoint is not a lending app. It is the personhood layer for Creditcoin: a public `IHumanRegistry` that any lender, DAO, airdrop, payroll contract or governance module on the chain reads for free, funded by the credit business that sits on top of it. Humanline's own `CreditLine` is the reference implementation and the proof that the registry is good enough to lend against.

## Roadmap

### Month 1: make the registry a public good

Deploy `AttestedWorldID` and `HumanRegistry` to Creditcoin mainnet with the same code, the same lack of an owner and the same relay. Publish the integration guide and the ABI as a package so a lender integration is a single interface import. Land the first one: a Creditcoin lender using `isHuman` and `humanOf` as a sybil check on an existing loan book through Credal, which needs no change to their underwriting and no change to their contracts. Harden the relay into two independent workers run by different parties, because a single relayer is a liveness dependency even when it is not a trust dependency.

Success looks like: mainnet roots relayed continuously, one lender reading the registry in production, and the first thousand humans registered.

### Month 3: make the line fundable and repayable from anywhere

Lines funded by third-party liquidity rather than our own testnet pool, starting with PenguinSwap LPs, so the pool has a real cost of capital and a real yield to quote. Turn on repay-from-Ethereum: a USDC transfer on Ethereum proven through Attestcoin and credited to the human's line on Creditcoin. This is the second Attestcoin surface and it reuses the relay pipeline exactly, which is the point. Add BSC as a source chain when `chainKey 8` reaches testnet, because remittance corridors into Africa and Southeast Asia settle on BSC far more than on Ethereum. Begin the World ID 4.0 path: World Chain output roots posted to Ethereum, proven on Ethereum through Attestcoin, so Humanline keeps working when the 3.0 Semaphore tree eventually stops being the primary one.

Success looks like: a borrower in Nairobi repaying from an Ethereum or BSC wallet with no bridge, no wrapped asset and no custodian anywhere in the path.

### Month 6: the pilot

A supervised lending pilot in Kenya and Argentina with a Creditcoin lending partner. Both are World ID Orb markets and both are Creditcoin markets. Real money, small tickets, the 25 dollar starting line growing to a few hundred over a handful of on-time cycles. Instrument everything: default rate by cohort, limit-growth curve, what fraction of registered humans ever draw, what fraction of frozen humans try to come back with a new wallet and get caught. That last number is the entire thesis, and nobody has ever been able to measure it, because until now there was no way to know.

Success looks like: a published loss curve from real borrowers that a lender can underwrite against, and the registry carrying more integrations than Humanline itself.

## Why Each Integration Deepens Over Time

### Attestcoin Protocol

Today Attestcoin carries one payload type: World ID root updates from two source chains, roughly hourly from Ethereum mainnet. The `0x0FD2` BlockProver verifies inclusion, `EvmV1Decoder` pulls the `TreeChanged` log and the `registerIdentities` calldata out of the receipt, `0x0FD3` ChainInfo enforces a finality depth, and `0x0FD4` AttestorStash enforces a quorum floor. Remove any one of them and there is no root, so there is no human, so there is no credit.

Every step of the roadmap adds Attestcoin volume rather than replacing it. Repay-from-Ethereum in month 3 is a second proof per repayment, not a second protocol. BSC as a source chain multiplies the root and repayment traffic by the number of corridors we cover. The World ID 4.0 path adds a third payload type, OP-Stack output roots, proven the same way. A registry that many contracts read makes the root relay worth paying for, and the relay is pure Attestcoin usage.

The honest version of the arithmetic: a relay transaction costs about 0.0002 CTC and mainnet roots arrive about hourly, so a year of continuous mainnet relay is on the order of 2 CTC. That is tiny, and it is meant to be. The depth here is not spend, it is dependency. Attestcoin is not a feature of Humanline, it is the reason Humanline can exist without a trusted operator.

### World ID

World ID's identity tree lives on Ethereum and Creditcoin cannot see it. The only alternatives to Attestcoin are a trusted bridge or a trusted oracle, which is the exact thing the Attestcoin Protocol was built to remove. Humanline is the first path from World ID into Creditcoin that does not add an operator.

The relationship deepens because World's Orb footprint and Creditcoin's lending footprint are the same map. Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia are Orb markets and they are the markets Creditcoin's mission describes. Every new Orb verification in those countries is a potential Humanline borrower who needs no new onboarding, no new app and no new KYC. We are not asking World to do anything. We consume their public tree the way any integrator does, through `IWorldID.verifyProof`, which is why the port was a change of root source and nothing else.

### Credal and Creditcoin lenders

Credal is how lenders already write loans to Creditcoin. Humanline does not ask them to move their book, change their contracts or trust us. It asks them to add one read: is this borrower a unique human, and what is their Humanline history. `CreditLine` emits a loan lifecycle shaped like Credal's, so a lender indexing Credal events can index Humanline events with the same code.

The value compounds in one direction. The first lender gets sybil resistance. The second lender gets sybil resistance plus the defaults the first lender reported, because a freeze attaches to the nullifier and is visible to everyone. Ten lenders sharing one personhood layer is a shared credit bureau that no single party operates, which is close to Creditcoin's founding description of itself. Aella alone runs BNPL for more than a million users on Creditcoin. That is the first integration we want, and it is a read call, not a migration.

### PenguinSwap

`CreditLine` is a pool with shares, and right now the shares belong to us. PenguinSwap is where CTC and the ecosystem's liquidity already sits, and where ATC is launching. A lending pool whose borrowers are cryptographically unique humans is a genuinely different risk asset from every other yield venue on the chain, because its loss distribution is bounded by the number of humans rather than by the number of keys. That is a product an LP can price. As the pool grows, the CTC needed to relay roots, register humans and settle loans grows with it, which puts Humanline's volume on the same side as the network's.

## Revenue Model

Three lines, in the order they turn on.

**1. Personhood verification fee.** A lender or dApp that reads `isHuman` for an underwriting decision pays a per-verification fee, 0.10 USD equivalent in CTC, charged at registration and at re-bind rather than per read, so reads stay free and integration stays trivial. This is the month 1 line.

**2. Origination.** 1 percent of each draw, paid by the borrower at borrow time. This is a planned line and is not in the deployed contract, which charges the pool fee below and nothing else.

**3. Spread.** The pool charges 1 percent per 30-day term on the drawn amount, which is the deployed `FEE_BPS` of 100 and works out near 12 percent annualized. LPs take the majority. Humanline keeps a spread, modeled here at 30 percent of the fee.

### Rough unit economics

These are modeled from the parameters shipped in the contracts, not measured from borrowers. Treat them as assumptions to be tested in the month 6 pilot, not as results.

One human, first year, assuming a starting limit of 25 hUSD (the deployed `INITIAL_LIMIT`), growth of 25 percent per on-time term (the deployed rule), a 30-day term, and six draws in the year at the full available limit:

| Term | Limit at draw | Drawn | Pool fee at 1% (deployed) | Humanline share at 30% |
|---|---|---|---|---|
| 1 | 25.00 | 25.00 | 0.25 | 0.08 |
| 2 | 31.25 | 31.25 | 0.31 | 0.09 |
| 3 | 39.06 | 39.06 | 0.39 | 0.12 |
| 4 | 48.83 | 48.83 | 0.49 | 0.15 |
| 5 | 61.04 | 61.04 | 0.61 | 0.18 |
| 6 | 76.29 | 76.29 | 0.76 | 0.23 |
| **Year 1** | | **281.47** | **2.81** | **0.84** |

Everything in that table exists on chain today except the split, which is a policy choice we have not made yet. Add the planned 1 percent origination fee and Humanline's take on this borrower goes from 0.84 to 3.66. Add the one-time 0.10 verification fee and a well-behaved first-year borrower is worth roughly 3.76 USD on 281 USD of cumulative origination. Marginal cost to serve is the on-chain gas, which is a rounding error at Creditcoin's fees, plus a share of the relay.

The number that decides whether this works is the default rate, and the whole design exists to move it. In wallet-scored lending the ceiling on a sybil attack is the attacker's patience. In Humanline it is the number of Orbs the attacker can get in front of, with a different iris each time. We are not claiming a default rate. We are claiming the attack that makes the default rate unknowable has been removed, and that a real one can now be measured.

At the month 6 target of 100,000 humans with active lines, the same per-human arithmetic implies roughly 28 million USD of cumulative origination and roughly 376,000 USD of annual revenue, against a pool that never lent a dollar to a duplicate. Those are targets derived from the table above, not forecasts.

## What the Hackathon Validated

Four things we did not know for certain when we started, and now do.

**Groth16 verifies on Creditcoin.** The bn128 precompiles at `0x06`, `0x07` and `0x08` answer correctly on CC3, so a Semaphore proof can be checked natively in one transaction. Nothing in this field of 87 submissions had tried it. Zero-knowledge on Creditcoin was an open question and it is now a deployed contract.

**World's own bridge code ports cleanly onto Attestcoin.** `WorldIDBridge` from `world-id-state-bridge` expects roots to be handed to it by a trusted state bridge. Replacing that single entry point with `ASCBase.execute` plus a proof from `0x0FD2` was enough. The rest of the contract, including `rootHistory`, the one-week expiry and `verifyProof`, is unmodified MIT code. That means any protocol with a bridged-root design can be de-trusted the same way, which is a much larger claim than Humanline.

**Attestcoin's readability set is sufficient for identity, not just for payments.** The protocol proves that a transaction was included in an attested block, plus its full receipt. That turns out to be exactly enough to track a Merkle tree: the `TreeChanged` log gives the roots, the `registerIdentities` calldata cross-checks them and gives the number of humans added, the receipt status rejects reverted transactions, and `calculateTxIndex` gives an ordering key and a replay key. We needed no state proof, no storage proof and no absence proof, which is fortunate, because none of those exist.

**Chaining matters more than proving.** Attestcoin proves that a root update happened. It does not prove that it was the next one. The `preRoot == latestRoot` rule is what turns a set of proven events into a tree you can trust, and the finality and quorum guards from `0x0FD3` and `0x0FD4` are what stop a reorg or a thin attestor set from being the weak link. The lesson generalizes: readability proofs are a primitive, and a correct application still has to supply its own ordering, its own emitter binding and its own replay key. Our security model documents ten such checks layered on top of the protocol's two.

## The Ask (CEIP)

We are asking Credit Labs for the CEIP fast-track and, through it, three things.

**Capital for a 6-month supervised pilot in Kenya and Argentina.** Small tickets, a real Creditcoin lending partner, and full instrumentation of the loss curve. The deliverable is a published cohort loss curve for uncollateralized, personhood-gated lending. Nobody has one. A lender cannot underwrite this asset class without one, and once it exists every lender on Creditcoin can use it.

**A lender introduction.** The registry is a read call away from being useful to a book that already exists. An introduction to Aella, or to any Credal lender, turns month 1 from a build into a deployment.

**Engineering support to bring World Chain under Attestcoin.** World ID 4.0 verification lives on World Chain, an OP-Stack rollup. Its output roots are posted to Ethereum, which Attestcoin already attests. Proving a World Chain state root through its Ethereum posting would give Attestcoin reach into every OP-Stack rollup, not just World Chain. Humanline is the first application that needs it, and it is a general capability for the protocol. We would build it with the Creditcoin team rather than around them.

What we bring in return is a piece of infrastructure the ecosystem does not have, with no owner key, no upgrade path and no operator, that makes every other credit product on Creditcoin harder to defraud.
