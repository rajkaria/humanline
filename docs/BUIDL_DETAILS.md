![Humanline: one human, one credit line](https://raw.githubusercontent.com/rajkaria/humanline/main/docs/screenshots/hero.png)

# Humanline

### One human, one credit line.

**Humanline gives a verified human an uncollateralized credit line on Creditcoin that follows the person, not the wallet.** World ID proof of personhood travels from Ethereum to Creditcoin through the Attestcoin Protocol, with no bridge and no oracle in between. Its zero-knowledge proof is checked on Creditcoin itself.

**[Live app](https://humanline.credit/app)** · **[Judge page, no wallet needed](https://humanline.credit/judge)** · **[Live relay feed](https://humanline.credit/relay)** · **[One person, one vote](https://humanline.credit/vote)** · **[Public API](https://humanline.credit/api)** · **[GitHub](https://github.com/rajkaria/humanline)** · **[Attestcoin write-up](https://github.com/rajkaria/humanline/blob/main/docs/ATTESTCOIN_INTEGRATION.md)** · **[Deck](https://github.com/rajkaria/humanline/blob/main/docs/deck.pdf)** · **[npm: @humanline/sdk](https://www.npmjs.com/package/@humanline/sdk)**

---

## The 30-second version

- **Every uncollateralized credit design on Creditcoin scores a wallet, and wallets cost nothing.** Open ten, repay yourself ten times, then default on the eleventh at full size. Humanline scores the person instead.
- **The person is a World ID nullifier**, derived from an Orb iris scan. It stays the same on every wallet the person will ever hold. Limits, repayments and defaults are all keyed to it, so a new keypair doesn't make a new borrower.
- **World ID's identity tree lives on Ethereum, where Creditcoin can't see it.** Humanline copies it over with Attestcoin. Each root arrives as a proof of the real Ethereum transaction that produced it, and the `0x0FD2` precompile verifies that proof in the same transaction that adopts the root.
- **The Semaphore Groth16 proof is verified on Creditcoin itself**, using the bn128 precompiles. Real World ID proofs have been verified on CC3.
- **Attestcoin is load-bearing in 22 ways.** One no one else has tried: the credit pool can never lend more than the attestors' bonded stake, read live from `0x0FD4` on every draw.
- **Nothing asks for trust.** The contracts have no owner, no pause and no upgrade path. Anyone can relay a root. Every time the judge page loads, 12 named attacks are fired at the deployed contracts and all 12 are refused.

---

## The problem: a wallet is not a person

Creditcoin exists to give credit history to people the banking system can't see. The ledger is there, Credal lets lenders write loans to it, and Aella runs BNPL on top of it. What's still missing is the oldest question in unsecured lending: *is this the same person who borrowed last time, and is there exactly one of them?*

When we surveyed the BUIDL CTC gallery, about thirty submissions were credit passports built the same way: read repayments, mint a score. Every one of them can be forged by **generating a new wallet**. No hack is needed.

Proof of personhood already exists, and it's already in Creditcoin's markets. World ID's Orb-verified users are concentrated in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia. Adoption was never the obstacle. Plumbing was: World ID's tree lives on Ethereum, and the only ways to reach another chain were a trusted bridge or a trusted oracle. **Attestcoin removes both.** That's why Humanline is built on Creditcoin and not somewhere else.

## The insight: the nullifier is the human

| | Wallet-scored credit passports | Humanline |
|---|---|---|
| What gets scored | an address | a human |
| Cost to reset your score | one new keypair, free | a second iris |
| Moving to a new wallet | new borrower, clean slate | same borrower, same limit, same history |
| A default | erased by the next wallet | frozen on the person, on every wallet, for good |
| A second line from a second wallet | granted | refused with `LineExists` |
| Who vouches for the identity data | a bridge operator or oracle | an Attestcoin proof verified on-chain |
| Admin keys | usually | none, anywhere |

The single most important test in the repo is `test_DefaultSurvivesAWalletRebind`.

---

## How it works

```
ETHEREUM MAINNET (chainKey 3)             CREDITCOIN CC3 TESTNET (chainId 102031)
┌──────────────────────────────┐          ┌──────────────────────────────────────────────┐
│ WorldIDIdentityManager (Orb) │          │ 0x0FD2 BlockProver   0x0FD3 ChainInfo         │
│ registerIdentities() ~hourly │  proofs  │ 0x0FD4 AttestorStash 0x06/07/08 bn128         │
│ emits TreeChanged(pre,post)  │ ───────▶ ├──────────────────────────────────────────────┤
└──────────────────────────────┘  anyone  │ AttestedWorldID                               │
ETHEREUM SEPOLIA (chainKey 1)             │  · verifyAndEmit, decode calldata + log       │
┌──────────────────────────────┐          │  · preRoot must chain to a known root         │
│ World ID staging tree        │ ───────▶ │  · finality (0x0FD3) + quorum (0x0FD4) guards │
└──────────────────────────────┘          │  · IWorldID.verifyProof (Semaphore, bn128)    │
                                          ├──────────────────────────────────────────────┤
   World App / IDKit / Simulator ──ZK──▶  │ HumanRegistry   nullifier ⇄ wallet            │
                                          │ CreditLine      one line per nullifier,       │
   Linked Ethereum wallets ──proofs──▶    │                 capped by attestor bonds      │
   (self-send, Aave V3, USDC)             │ HumanLinks · CreditHistory · EthRepay         │
                                          │ RelayReward · HumanGated → HumanPoll          │
                                          └──────────────────────────────────────────────┘
```

1. **World updates its identity tree on Ethereum** about once an hour.
2. **Anyone relays the new root to Creditcoin.** `AttestedWorldID` is World's own `WorldIDBridge`, vendored unmodified, with its trusted state bridge replaced by Attestcoin proofs. Each root is checked by `0x0FD2`, then by Humanline's own guards.
3. **The user proves personhood** with World App, IDKit or the World ID Simulator. `HumanRegistry` verifies the Groth16 proof natively and binds the nullifier to the caller's wallet. The wallet is the proof's signal, so a proof can't be lifted from the mempool.
4. **`CreditLine` opens one line per human.** It starts at 25 hUSD, grows ×1.25 per on-time term, is halved when late, and caps at 2,000. A default freezes the line on the nullifier, on every wallet.
5. **The credit identity reaches back into Ethereum.** `HumanLinks` ties a person's Ethereum wallets to them. `CreditHistory` imports proven Aave V3 borrow and repay history to raise the limit. `EthRepay` settles a Creditcoin line from a proven USDC transfer on Ethereum.

![App](https://raw.githubusercontent.com/rajkaria/humanline/main/docs/screenshots/app.png)

---

## Why this is a deep Attestcoin integration

Take Attestcoin out of Humanline and there's no root, so no verified human, so no credit. There's no fallback, no admin setter and no degraded mode.

Attestcoin proves **inclusion** and **continuity** and nothing else. Everything else is Humanline's job, and each check has a named revert:

| Attestcoin does not prove | Humanline checks | Reverts with |
|---|---|---|
| The source transaction succeeded | receipt status must be 1 | `SourceTxReverted` |
| It called World's identity manager | decoded `to` must be the manager | `NotIdentityManager` |
| `TreeChanged` came from that manager | filter logs by emitter, exactly one left (decoys skipped) | `NoTreeChange`, `AmbiguousTreeChange` |
| Calldata agrees with the log | selector and both roots cross-checked | `CalldataLogMismatch` |
| The root is next in sequence | `preRoot` must be a root we already hold | `UnknownPreRoot` |
| The block is final | `0x0FD3` tip at least 32 attested blocks deeper | `NotFinal` |
| A real attestor set backed it | `0x0FD4` bonded attestors ≥ 3 | `ThinQuorum` |
| It wasn't relayed before | `calculateTxIndex` query id, recorded once across both entry points | `QueryAlreadyProcessed` |

**What nobody else does with Attestcoin:**

- **`0x0FD4` becomes a lending parameter.** The deepest assumption under every loan is the attestor quorum. So total outstanding principal can never exceed `attestors × minimum bond × 10 hUSD per CTC`, read live on every draw. If the set thins, the ceiling drops. Repayments are never blocked.
- **Another protocol's state root, not a token transfer.** The receipt log gives the roots, the calldata cross-checks them and counts the humans, and `calculateTxIndex` gives ordering and replay protection.
- **Batching.** `executeBatch` exposes the batch overload of `verifyAndEmit`: up to 10 updates under one continuity proof, with the protocol's 10-transaction limit enforced on-chain.
- **Four kinds of proven payload through one precompile:** World ID tree updates, wallet-link self-sends, Aave V3 events and USDC transfers.
- **Two source chains, one code path.** Ethereum mainnet carries the Orb roots, Sepolia carries World's staging tree.
- **Prover independence.** Proofs built locally with `usc-sdk` match the hosted prover byte for byte. The browser recomputes every Merkle path and checks it against `0x0FD3` before a wallet signs.

The full table of 22 load-bearing surfaces, each with `file:line`, what it decides and the test that proves it, is in [ATTESTCOIN_INTEGRATION.md](https://github.com/rajkaria/humanline/blob/main/docs/ATTESTCOIN_INTEGRATION.md).

---

## A relay nobody has to trust or wait for

A relayer is a liveness dependency even when it isn't a trust dependency, so Humanline removes it three ways:

- **Self-relay from the app.** If your proof's root hasn't reached Creditcoin yet, the app plans the missing updates, builds the proof, dry-runs it and lets your own wallet send it. A wallet created seconds earlier, holding only faucet tCTC, has done this live.
- **`RelayReward` pays strangers to relay.** It's a permissionless vault that pays 0.002 tCTC per fresh root a call actually recorded. It has no owner and no withdrawal function, and farming it is impossible by construction.
- **An always-on relay, measured from chain data.** A Vercel Cron job runs every 5 minutes, with GitHub Actions as backup and a `200`/`503` watchdog at `/api/relay/health`.

![Relay](https://raw.githubusercontent.com/rajkaria/humanline/main/docs/screenshots/relay.png)

Live at the time of writing: **77 World ID roots relayed** (30 from Ethereum mainnet, 47 from Sepolia) carrying **2,700 identity commitments**. Since the 5-minute relay went live, a fresh root has been usable on Creditcoin a **median 15.6 minutes** after its Ethereum block, most of that being Ethereum finality plus the 32-block attestation depth. Over the same period, uptime is **100%**.

---

## Proof, not promises

### Twelve live attacks, refused by name

[humanline.credit/judge](https://humanline.credit/judge) fires these as read-only calls at the deployed contracts every time the page loads, using real Sepolia transactions and real Attestcoin proofs. Vercel Cron repeats them every six hours and alerts if one gets through.

| Attack | Refused with |
|---|---|
| Forged Merkle proof | `Merkle proof validation failed` (`0x0FD2`) |
| Wrong contract called (a real USDC transfer) | `NotIdentityManager` |
| Reverted source transaction | `SourceTxReverted` |
| Replay an adopted root | `QueryAlreadyProcessed` |
| Roots out of order | `BatchOutOfOrder` |
| Unattested block height | `Continuity proof does not match` (`0x0FD2`) |
| Below the attestor floor | `ThinQuorum` |
| Sepolia root into the Ethereum relay | `WrongSourceChain(1, 3)` |
| Decoy `TreeChanged` appended to a real receipt | `Merkle proof validation failed` (`0x0FD2`) |
| Oversize batch of 11 | `BatchTooLarge(11)` |
| Root from before the relay's history | `UnknownPreRoot` |
| One human, a second registration | `SameWallet` |

![Judge page](https://raw.githubusercontent.com/rajkaria/humanline/main/docs/screenshots/judge.png)

### Rigor

| | |
|---|---|
| Tests | **877** in total: 234 Foundry (unit, fuzz, 12 invariants, 14 live fork tests against the real precompiles), 216 worker, 417 web, 10 SDK |
| Line coverage | **93.6%** |
| Mutation score | **95.8%** (183 of 191 killed; the 8 survivors are shown to be equivalent, one by one) |
| Static analysis | Slither (every High and Medium triaged), CodeQL and gitleaks on every push |
| Contracts | **18** deployed on CC3 testnet, all verified on Blockscout |
| Submission check | runs daily in CI; every cited address, transaction and URL must resolve |

### Measured from chain data, not typed by hand

- **Gas per relay**, fitted live: ≈ 169,639 + 99,959 · updates + 470.6 · continuity roots (R² 0.994).
- **The batch cap** was probed live: 11 updates fail with `BatchTooLarge`, 10 pass. The cap is exactly 10.
- **`0x0FD2` verify gas** ≈ 11,135 + 48 · continuity roots (R² 1.000).

All in [MEASUREMENTS.md](https://github.com/rajkaria/humanline/blob/main/docs/MEASUREMENTS.md).

---

## Build on it

We think the most valuable thing Humanline can be for Creditcoin is not a lending app. It's the `isHuman` call every other lending app makes. So personhood ships as a primitive, published on npm as **[`@humanline/sdk`](https://www.npmjs.com/package/@humanline/sdk)**.

```bash
npm install @humanline/sdk viem
```

```ts
import { createHumanlineClient, isHuman, profileOf } from "@humanline/sdk";

const client = createHumanlineClient();       // CC3 testnet, no wallet needed
await isHuman(client, "0x…");                 // is this wallet a verified human?
const profile = await profileOf(client, "0x…"); // nullifier, limit, principal, due date, repaid and late counts
```

```solidity
import {HumanGated} from "@humanline/sdk/contracts/HumanGated.sol";

contract Airdrop is HumanGated {
    constructor(address registry) HumanGated(registry) {}
    function claim() external oncePerHuman("airdrop-1") {} // one claim per human, any wallet
}
```

There's also a **CORS-open public API** (OpenAPI 3.1) at [humanline.credit/api](https://humanline.credit/api), including a loan-lifecycle feed shaped like Credal's. **`HumanPoll`** is the first app built only on the SDK: one person, one vote, and a new wallet doesn't buy a second ballot.

![One person, one vote](https://raw.githubusercontent.com/rajkaria/humanline/main/docs/screenshots/vote.png)

---

## Try it yourself in two minutes

**No wallet:**
1. Open [humanline.credit/judge](https://humanline.credit/judge) and watch all 12 attacks get refused live.
2. Open [humanline.credit/relay](https://humanline.credit/relay) and click any root through to Etherscan and Blockscout.
3. From a terminal:
   ```bash
   git clone --recurse-submodules https://github.com/rajkaria/humanline && cd humanline && bun install
   bun run worker/src/cli.ts check    # all three Attestcoin precompiles, live
   bun run worker/src/cli.ts attack   # 12 named attacks against the deployed contracts
   ```

**With a wallet:** open [humanline.credit/app](https://humanline.credit/app) and verify with the [World ID Simulator](https://simulator.worldcoin.org), no Orb needed. Then borrow, repay and watch your limit grow. First-time wallets get CC3 gas automatically. If you hold an Orb-verified World ID, use [the real deployment](https://humanline.credit/app?profile=production) with 30-day terms.

---

## Two deployments, same relayed roots

| Deployment | Verifies proofs against | Who can register | Terms |
|---|---|---|---|
| [Reproducible](https://humanline.credit/app) | World's Sepolia staging tree | anyone, via the World ID Simulator | 10-minute term, 5-minute grace |
| [Real](https://humanline.credit/app?profile=production) | World's Ethereum mainnet Orb tree | anyone with an Orb-verified World ID | 30-day term, 7-day grace |

**Key addresses** (Creditcoin CC3 testnet, chainId 102031, all verified on [Blockscout](https://creditcoin-testnet.blockscout.com)):

| Contract | Address |
|---|---|
| `AttestedWorldID` (Ethereum mainnet roots) | [`0x1122ef3fa4ab0693809e42a00b2476efcf4468ad`](https://creditcoin-testnet.blockscout.com/address/0x1122ef3fa4ab0693809e42a00b2476efcf4468ad) |
| `AttestedWorldID` (Sepolia roots) | [`0x3a7c3cc67034197208923587b8dc5c4674cbcef7`](https://creditcoin-testnet.blockscout.com/address/0x3a7c3cc67034197208923587b8dc5c4674cbcef7) |
| `HumanRegistry` | [`0x62c2fd99ea587e4b466175ad248468782bd5298d`](https://creditcoin-testnet.blockscout.com/address/0x62c2fd99ea587e4b466175ad248468782bd5298d) |
| `CreditLine` v3 | [`0xbb97982f1138f36bfa3ba4706dad5134a10556d9`](https://creditcoin-testnet.blockscout.com/address/0xbb97982f1138f36bfa3ba4706dad5134a10556d9) |
| `RelayReward` | [`0x9766480a872ad7df2a5cf86f9e307804a3f7afe0`](https://creditcoin-testnet.blockscout.com/address/0x9766480a872ad7df2a5cf86f9e307804a3f7afe0) |
| `HumanLinks` | [`0xbbf6f64c3aff6715c42711329e3292b3c967781c`](https://creditcoin-testnet.blockscout.com/address/0xbbf6f64c3aff6715c42711329e3292b3c967781c) |
| `CreditHistory` | [`0xa4833b1b667a729e80248004ac91cfa3a2ff3404`](https://creditcoin-testnet.blockscout.com/address/0xa4833b1b667a729e80248004ac91cfa3a2ff3404) |
| `EthRepay` | [`0x231ce1ceb88edefad482fc6dfd49a8454cd1fc48`](https://creditcoin-testnet.blockscout.com/address/0x231ce1ceb88edefad482fc6dfd49a8454cd1fc48) |
| `HumanPoll` | [`0xd7854346fea444f6ac966d2ce764a4f029e013bc`](https://creditcoin-testnet.blockscout.com/address/0xd7854346fea444f6ac966d2ce764a4f029e013bc) |

All 18 addresses, including the Orb-tree set, are in the [README](https://github.com/rajkaria/humanline#live-addresses).

---

## Where this goes

The endpoint is **the personhood layer for Creditcoin**: a public `IHumanRegistry` that any lender, DAO, airdrop or payroll contract reads for free, paid for by the credit business on top of it.

| Horizon | Milestone |
|---|---|
| Month 1 | The same ownerless contracts on Creditcoin mainnet. A first Credal lender using `isHuman` as a sybil check on an existing loan book. Two independent relayers run by different parties. |
| Month 3 | Lines funded by PenguinSwap LPs. BSC as a source chain for remittance corridors. Periscope, which proves World Chain output roots through their Ethereum postings, so World ID 4.0 works too. |
| Month 6 | A supervised pilot in Kenya and Argentina with a Creditcoin lending partner: small tickets, real money, and the first published loss curve for personhood-gated uncollateralized credit. |

Every lender that plugs in makes it stronger for the next one. A default recorded by the first lender is visible to the second, because it's attached to the human. Ten lenders sharing one personhood layer adds up to a shared credit bureau that no single party runs.

---

## What is testnet-only, and what we don't claim

- **The World ID roots are real.** They come from World's own sequencer on Ethereum. There's no mock verifier, canned proof or replayed fixture anywhere in the deployed path.
- **hUSD is a test stablecoin we mint**, and lender deposits are testnet funds. The reproducible deployment shortens terms to minutes so a full cycle fits in a demo.
- **Attestcoin can't prove a negative.** A default is declared from a passed deadline plus no repayment in Creditcoin's own state, never from a cross-chain absence claim.
- **Roots lag** by Ethereum finality plus a 32-block attestation depth. The lag is shown on `/relay`, and self-relay means nobody waits longer than the protocol requires.
- **Sybil resistance is exactly World ID's:** one World ID, one line.
- **A freeze is permanent** and there's nobody to appeal to. A production version would add a lender-controlled cure path.

---

**Built by Raj Karia** ([X @rajkaria_](https://x.com/rajkaria_) · [GitHub @rajkaria](https://github.com/rajkaria)). BUIDL CTC 2026 Fall · Creditcoin CC3 testnet · MIT licensed.

**One human, one credit line. Zero trusted parties. Come and check.**
