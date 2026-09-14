# Humanline: long-form form answers

Use these when a DoraHacks field allows about 960 words. The short versions, for 300- and 400-word limits, are in `docs/SUBMISSION.md`. Each block below stays under 960 words (check with `wc -w`).

## Project Description

```
One human, one credit line.

Humanline gives a verified human an uncollateralized credit line on Creditcoin that follows the person, not the wallet. You prove you are a person once with World ID. The Attestcoin Protocol carries World ID's identity tree from Ethereum to Creditcoin with no bridge and no oracle in between, the zero-knowledge proof is verified on Creditcoin itself, and your credit limit, repayment history and any default are keyed to you as a human, on every wallet you will ever hold.

THE PROBLEM

Creditcoin's mission is credit history for people the banking system cannot see. What that still leaves unanswered is the oldest question in unsecured lending: is this the same person who borrowed last time, and is there exactly one of them?

Every uncollateralized credit design on the chain scores a wallet, and a wallet is free. A borrower opens ten wallets, repays themselves ten times, mints ten spotless credit passports, and defaults on the eleventh loan at full size. The score was real. The person behind it was not. When we surveyed the BUIDL CTC gallery, about thirty submissions were credit passports built on this pattern, and every one of them can be forged by generating a new wallet.

THE INSIGHT

A World ID nullifier is derived from an Orb iris scan and an action string. It reveals nothing about the person, and it stays the same whatever wallet they use and whatever key they lose. Humanline keys every piece of credit state to that nullifier and never to an address. Resetting a wallet-scored passport costs one new keypair. Resetting a Humanline identity costs a second iris. Moving to a new wallet keeps the same borrower, the same limit and the same history. A default freezes the line on the person, on every wallet, for good.

World ID's Orb-verified population is concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia, the same map Creditcoin's mission describes. The obstacle was never adoption. It was plumbing: World ID's tree lives on Ethereum, and the only ways to bring it to another chain were a trusted bridge or a trusted oracle. Attestcoin removes both, which is why Humanline is built on Creditcoin.

WHAT WE BUILT

Eighteen contracts, all verified on Blockscout, across two live deployments on Creditcoin CC3 testnet, plus a relay worker, a web app, a public API and an npm package.

AttestedWorldID is World's own WorldIDBridge and SemaphoreVerifier, vendored unmodified, with the trusted state bridge replaced by Attestcoin proofs. One instance mirrors the Ethereum mainnet Orb tree, one mirrors World's Sepolia staging tree.

HumanRegistry verifies a Semaphore Groth16 proof natively on Creditcoin's bn128 precompiles against an Attestcoin-delivered root, and binds the nullifier to the caller's wallet.

CreditLine opens one revolving line per nullifier from an open lender pool: 25 hUSD to start, x1.25 per on-time term, halved when late, capped at 2,000. Total outstanding principal is capped by the attestors' bonded stake, read from the AttestorStash precompile on every draw.

HumanLinks, CreditHistory and EthRepay extend the credit identity back into Ethereum: link your Ethereum wallets to your human, import proven Aave V3 borrow and repay history for a limit boost, and repay a Creditcoin line by sending USDC on Ethereum.

RelayReward is a permissionless vault that pays anyone who relays a fresh World ID root. HumanGated.sol, @humanline/sdk and a CORS-open public API make personhood a primitive, and HumanPoll, one person one vote, is the first app built only on them.

Two deployments share the same relayed roots. The reproducible one verifies against World's staging tree with 10-minute terms, so any judge can register with the World ID Simulator and run a full borrow and repay cycle with no Orb. The real one verifies against the Orb tree with 30-day terms, for people who hold an Orb-verified World ID.

NOTHING ASKS FOR TRUST

No contract has an owner, a pause or an upgrade path. Anyone can relay, from their own wallet inside the app or through the vault that pays them, and an always-on relay runs every five minutes with a watchdog. Twelve named attacks, including a forged proof, a decoy log, a replay, a wrong source chain and an oversize batch, are fired at the deployed contracts on every load of the judge page, refused by name, and re-run every six hours.

The rigor is published, not asserted: 877 tests including 12 stateful invariants and 14 live fork tests against the real precompiles, 93.6% line coverage, a 95.8% mutation score, Slither, CodeQL and gitleaks in CI, and a daily check that every cited address and URL resolves. At the time of writing, 77 World ID roots carrying 2,700 identity commitments have been relayed.

WHERE THIS GOES

The endpoint is not a lending app. It is the personhood layer for Creditcoin: a public registry that any lender, DAO, airdrop or payroll contract reads for free, funded by the credit business on top. Month 1: the same ownerless contracts on Creditcoin mainnet, a first Credal lender using isHuman as a sybil check, and two independent relayers. Month 3: pools funded by PenguinSwap LPs, and BSC as a source chain for remittance corridors. Month 6: a supervised pilot in Kenya and Argentina with a Creditcoin lending partner, and the first published loss curve for personhood-gated uncollateralized credit.

WHAT WE DO NOT CLAIM

hUSD is a test stablecoin and lender deposits are testnet funds. Attestcoin cannot prove a negative, so a default is declared from a passed deadline and the absence of repayment in Creditcoin's own state. Sybil resistance is exactly World ID's. The World ID roots, the proofs and the on-chain verification are real.

Live: https://humanline.credit
Judge page, no wallet needed: https://humanline.credit/judge
Code: https://github.com/rajkaria/humanline
```

## USC Integration Summary

```
Humanline uses USC (Universal Smart Contracts, the Attestcoin Protocol) as its foundation, not as a feature. Remove it and there is no World ID root on Creditcoin, therefore no verified human, therefore no credit. There is no admin setter, no oracle fallback and no degraded mode. By a strict count USC is load-bearing in 22 separate places, each documented with file:line and a test in docs/ATTESTCOIN_INTEGRATION.md.

WHAT WE PROVE

World ID's identity tree lives on Ethereum. Roughly every hour, World's sequencer calls registerIdentities on the WorldIDIdentityManager, which emits TreeChanged(preRoot, kind, postRoot). Humanline carries each of those transactions to Creditcoin as a USC proof. AttestedWorldID, World's own WorldIDBridge with the trusted state bridge cut out, accepts a new root only when the BlockProver precompile at 0x0FD2 verifies, inside the same Creditcoin transaction, that the Ethereum transaction and its receipt sit in a block Creditcoin's attestors have signed. A root arrives as a proof of the real transaction that produced it, and nobody vouches for it.

Roots enter two ways. Singly, through ASCBase.execute and verifyAndEmit. In batches, through a custom executeBatch that exposes the batch overload of verifyAndEmit, which ASCBase does not use: up to 10 updates under one shared continuity proof, with the protocol's 10-transaction and 1,000-block limits enforced on chain.

WHAT USC DOES NOT PROVE, AND HOW WE CLOSE EACH GAP

USC proves inclusion and continuity, and deliberately nothing else. verifyAndEmit returning true does not mean the transaction succeeded, called the right contract, emitted the right event or carries the next root. Each of those is Humanline's job, enforced with a named revert:
- The source transaction succeeded: receipt status must be 1, or SourceTxReverted.
- It called World's identity manager: the decoded to address must match, or NotIdentityManager.
- TreeChanged came from that manager: logs are filtered by emitter and exactly one must survive; decoys from other emitters are skipped, or NoTreeChange and AmbiguousTreeChange.
- The calldata agrees with the log: EvmV1Decoder independently decodes registerIdentities and deleteIdentities and cross-checks the selector and both roots, or CalldataLogMismatch.
- The root is next in sequence: preRoot must be a root already held, or UnknownPreRoot, so roots only advance along World's own chain.
- It was not relayed before: calculateTxIndex builds the query id, recorded once across both entry points, or QueryAlreadyProcessed.

ALL THREE PRECOMPILES IN THE HOT PATH

ChainInfo at 0x0FD3 supplies finality: a root is accepted only when the attested tip is 32 blocks above its block, or NotFinal.

AttestorStash at 0x0FD4 supplies two economic guards. First, a floor of three bonded attestors per source chain, or ThinQuorum. Second, something no other project does: the attestors' bonded stake becomes a lending parameter. The deepest assumption under every loan is the attestor quorum, because a quorum that attested a fake Ethereum block could mint a fake human and borrow. So CreditLine caps total outstanding principal at attestor count x minimum bond x 10 hUSD per CTC, read live on every draw. A thinning set lowers the ceiling and a set reporting zero stops new draws, while repayments and withdrawals are never blocked.

FOUR KINDS OF PROVEN PAYLOAD

The same precompile carries four kinds of Ethereum evidence, each with its own replay key, through a shared ProvenSource base that enforces 0x0FD2 inclusion, 0x0FD3 finality, 0x0FD4 quorum, receipt status and the chain id the transaction was signed for:
1. World ID tree updates (AttestedWorldID).
2. Wallet-link self-sends, so a person's Ethereum wallets belong to their human (HumanLinks).
3. Aave V3 Borrow and Repay events, following the official Loan Flow template, with anti-wash rules, turned into a limit boost (CreditHistory).
4. USDC transfers on Ethereum that repay a Creditcoin line (EthRepay).
All three cross-chain flows are tested against real Sepolia transactions the live 0x0FD2 accepts.

TWO SOURCE CHAINS, ONE CODE PATH

Ethereum mainnet (chainKey 3) carries World's Orb tree for real humans. Sepolia (chainKey 1) carries World's staging tree, so any judge can reproduce personhood end to end with the World ID Simulator. Identical bytecode, both live on humanline.credit/relay.

NO SINGLE PROVER, NO SINGLE RELAYER

The worker builds proofs locally with usc-sdk from any Ethereum RPC and matches the hosted prover byte for byte. Before a user relays from their own wallet, the browser recomputes every Merkle path and continuity fold, matches it against ChainInfo, and dry-runs it with the precompile's free verify view. Anyone can relay: from the app, from the command line, through RelayReward (an ownerless vault that pays relayers), or through the always-on relay that runs every five minutes behind a watchdog. A wallet created seconds earlier, holding only faucet tCTC, has relayed a root through the vault and been paid.

TESTED AGAINST THE REAL THING

Fourteen live fork tests read the real 0x0FD2, 0x0FD3 and 0x0FD4 on CC3. Twelve attacks built from real transactions and real USC proofs, including a forged Merkle proof, a decoy log, a replayed root, a wrong source chain and an oversize batch of 11, are fired at the deployed contracts on every load of the judge page and refused by name.

MEASURED FROM CHAIN DATA

Gas per relay is about 169,639 + 99,959 per update + 470.6 per continuity root (R-squared 0.994). The batch cap was probed live: 11 updates revert, 10 pass. Since the always-on relay went live, a fresh World ID root has been usable on Creditcoin a median 15.6 minutes after its Ethereum block, mostly Ethereum finality plus attestation depth.

WHAT WE DO NOT CLAIM

USC cannot prove absence, so defaults come from Creditcoin's own state, never from a cross-chain absence claim. The attestor set is the deepest assumption, and Humanline bounds it with a quorum floor, a 32-block depth and a credit ceiling tied to bonded stake.

Full write-up: https://github.com/rajkaria/humanline/blob/main/docs/ATTESTCOIN_INTEGRATION.md
Live relay: https://humanline.credit/relay
Live attacks: https://humanline.credit/judge
```
