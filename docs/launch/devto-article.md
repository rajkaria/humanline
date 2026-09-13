---
title: "A wallet is not a person: uncollateralized credit on Creditcoin with World ID and Attestcoin"
published: false
tags: blockchain, zeroknowledge, solidity, web3
canonical_url: https://github.com/rajkaria/humanline
---

<!-- Draft. Not posted. Publishing is the maintainer's call; tag @Creditcoin and @worldcoin when it goes out. -->

Every on-chain credit score I have seen scores a wallet. A wallet costs nothing, so the score costs
nothing to reset: open ten wallets, repay yourself ten times, default on the eleventh loan at full
size. That is why "uncollateralized" lending keeps quietly asking for collateral.

[Humanline](https://humanline.credit) scores the person instead. It is live on Creditcoin CC3 testnet,
and this post is about the one piece of plumbing that makes it possible without trusting anyone: moving
World ID's identity tree from Ethereum to Creditcoin with the Attestcoin Protocol.

## The problem with "just bridge the root"

World ID keeps its identity tree on Ethereum. Every tree update is a `registerIdentities` or
`deleteIdentities` transaction to World's identity manager, which emits
`TreeChanged(preRoot, kind, postRoot)`. To verify a World ID proof on another chain you need that root
there. The usual ways across are a bridge operator or an oracle signer, which is exactly the kind of
trusted party a credit system for the unbanked should not rest on.

Attestcoin gives Creditcoin a precompile, `0x0FD2`, that verifies an inclusion and continuity proof for
an Ethereum transaction against blocks Creditcoin's attestors have signed. So the root can arrive as a
proof of the real transaction that produced it.

## What Attestcoin proves, and what you still have to check

The precompile proves "this transaction, with this receipt, is in an attested block". Everything else
is the application's job, and it is where most of the design went. `AttestedWorldID` adopts a root only
if:

1. the proof is for the source chain this relay mirrors;
2. the receipt status is 1;
3. the transaction called World's identity manager;
4. exactly one `TreeChanged` log came from that manager (a decoy from another contract is skipped);
5. the calldata, decoded independently, agrees with the log's roots;
6. `preRoot` is a root we already hold, so roots only move along World's own chain;
7. the block is 32 attested blocks deep, read from ChainInfo `0x0FD3`;
8. at least three attestors are bonded for the chain, read from AttestorStash `0x0FD4`.

`0x0FD4` does one more job: the credit pool caps total outstanding principal at
bonded attestors × minimum bond × a per-CTC ratio, read on every draw. If the attestor set thins, the
pool lends less, immediately.

## One human, one line

A person proves World ID membership with a Semaphore proof, verified on Creditcoin on the bn128
precompiles against a root that arrived through Attestcoin. `HumanRegistry` binds the proof's nullifier
to the caller's wallet. `CreditLine` keys everything by that nullifier: one line per human, a limit
that grows 25% on each on-time repayment, and a freeze on default that follows the person to any wallet
they will ever hold.

## Watching the guards work

Tests against mocks are necessary and not convincing. So `bun run worker/src/cli.ts attack` fires twelve
attacks at the deployed contracts as read-only `eth_call`s, with real Sepolia transactions and real
proofs, and prints what the chain answered:

```
REFUSED  Forged Merkle proof                  Error: Merkle proof validation failed
REFUSED  Wrong contract called                NotIdentityManager(0x1c7D…7238)
REFUSED  Reverted source transaction          SourceTxReverted
REFUSED  Replay an adopted root               QueryAlreadyProcessed(0x46ce…46bc)
REFUSED  Roots out of order                   BatchOutOfOrder
REFUSED  Unattested block height              Error: Continuity proof does not match attestation or checkpoint
REFUSED  Below the attestor floor             ThinQuorum(7, 1000)
REFUSED  Wrong source chain                   WrongSourceChain(1, 3)
REFUSED  Decoy TreeChanged log                Error: Merkle proof validation failed
REFUSED  Oversize batch (11)                  BatchTooLarge(11)
REFUSED  Root from before the history         UnknownPreRoot(…)
REFUSED  One human, a second registration     SameWallet
```

The attestor-floor row is the interesting one: the live deployment has seven bonded attestors, so the
attack runs the *deployed relay bytecode* at a scratch address through an `eth_call` state override with
one immutable raised to 1,000. The refusal still comes from deployed code reading the real `0x0FD4`.

The judge page fires the same calls while it loads, with no wallet, and CI repeats them every six hours.
That schedule has already paid for itself: it caught a recorded proof that had silently gone stale when
the attestation bound moved on, which is why recorded inputs now keep only checkpoint-anchored proofs.

## Numbers

From `docs/MEASUREMENTS.md`, all reproducible by one command each:

- 93.6% line and 93.5% branch coverage, 12 stateful invariants with anti-vacuity guards, a 95.8%
  mutation score over every guard in the contracts (the 8 survivors are equivalent mutants), Slither
  triaged.
- Relay gas ≈ 170k + 100k per World ID update + 471 per continuity root (R² 0.994 over every relay
  since deployment); a full batch of ten fits about thirty times in one CC3 block.
- Median time from an Ethereum block to its root landing on Creditcoin: about half an hour.

## Build on it

`HumanGated.sol` gives any contract `onlyHuman` and `oncePerHuman(scope)`. `@humanline/sdk` wraps the
reads for viem and React, a CORS-open API answers "is this wallet a human" over HTTP, and
[`/vote`](https://humanline.credit/vote) is a one-person-one-vote poll built on nothing else.

Code, tests and the full write-up: [github.com/rajkaria/humanline](https://github.com/rajkaria/humanline).
