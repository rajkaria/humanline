# Draft: "World ID roots via Attestcoin" for gluwa/attestcoin-protocol-examples

Status: **drafted, not opened.** Opening a pull request on Gluwa's repository is an external action
for the maintainer of this project to take. Everything below is ready to paste.

## Pull request title

Add example: relay World ID identity-tree roots from Ethereum with `verifyAndEmit`

## Pull request body

This example shows a pattern the existing examples do not cover: using Attestcoin to import **another
protocol's state root** rather than a token transfer, and then using that root as a trust anchor for a
zero-knowledge proof verified on Creditcoin.

World ID keeps its identity tree on Ethereum. Every tree update is a `registerIdentities` or
`deleteIdentities` transaction to the identity manager, which emits `TreeChanged(preRoot, kind,
postRoot)`. The example contract accepts an Attestcoin proof of that transaction and adopts
`postRoot` only after checking, in order:

1. the proof is for the configured source chain key;
2. the receipt status is 1;
3. the transaction called the identity manager (not a lookalike);
4. exactly one `TreeChanged` log from the manager itself (decoy logs from other emitters are skipped);
5. the calldata's pre- and post-root agree with the log;
6. `preRoot` is the current tip (or already known, for a gap fill), so roots only advance along the chain;
7. the source block is buried `FINALITY_DEPTH` blocks under the tip from ChainInfo `0x0FD3`;
8. at least `MIN_ATTESTORS` bonded attestors back the chain, from AttestorStash `0x0FD4`.

It also demonstrates `executeBatch` over the batch `verifyAndEmit` overload (one continuity proof for up
to ten transactions) and replay protection keyed by `calculateTxIndex`.

A production deployment of the same code runs on CC3 testnet:

- Ethereum mainnet roots (chainKey 3): `0x1122ef3fa4ab0693809e42a00b2476efcf4468ad`
- Sepolia staging roots (chainKey 1): `0x3a7c3cc67034197208923587b8dc5c4674cbcef7`

and twelve adversarial calls against it are refused by name (forged proof, decoy log, wrong chain,
replay, out-of-order batch, below the attestor floor and more); see `docs/MEASUREMENTS.md` in
github.com/rajkaria/humanline.

## Files

```
world-id-roots/
  README.md                     the pattern, the eight checks, how to run
  contracts/WorldIdRoots.sol    trimmed AttestedWorldID: relay + root history, no Semaphore verifier
  test/WorldIdRoots.t.sol       fixture-based tests with a real mainnet proof, plus the negative paths
  test/fixtures/mainnet.json    proof of Ethereum tx 0x81ece311…, identical to Humanline's fixture
  scripts/relay.ts              fetch the proof from the CC3 proof builder and call executeBatch
```

The source for every file is in the Humanline repository today: `contracts/src/AttestedWorldID.sol`,
`contracts/test/AttestedWorldID.t.sol`, `contracts/test/fixtures/mainnet-0x81ece311.json` and
`worker/src/cli.ts prove`. The trimmed contract drops the `WorldIDBridge` inheritance and the Semaphore
verifier so the example reads in one sitting.

## Checklist before opening

- [ ] Maintainer approval to open the PR under their GitHub account
- [ ] Re-run the fixture tests against the examples repository's pinned `@gluwa/asc-contracts`
- [ ] Confirm the examples repository's license and contribution guidelines
