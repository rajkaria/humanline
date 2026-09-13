# Relay evidence

Every file here is produced by the relay worker, not written by hand.

## `relay-log.jsonl`

One JSON object per relayed World ID root, append-only, stable key order:

| Field | Meaning |
|---|---|
| `source` | `mainnet` (Ethereum, Attestcoin chainKey 3) or `sepolia` (chainKey 1) |
| `txHash` | the `registerIdentities` transaction on the source chain |
| `sourceBlock`, `txIndex` | where that transaction sits — the pair an Attestcoin proof is bound to |
| `preRoot`, `postRoot` | the tree root before and after; `preRoot` must already be known on Creditcoin |
| `kind` | `0` insertion, `1` deletion, as `TreeChanged` reports it |
| `humansAdded` | identity commitments in the batch |
| `cc3TxHash` | the Creditcoin transaction that carried it, verified by the `0x0FD2` precompile |
| `gasUsed` | gas on Creditcoin |
| `attestationLagSec` | seconds between the source block and the Creditcoin transaction |
| `at` | when the relayer wrote the row |
| `contract` | the `AttestedWorldID` instance that received the root |

**Rows without a `contract` field predate that field.** Rows 1–5 were relayed to the
first deployment (v1), which was replaced after the contract review round; every row
after them belongs to the deployment recorded in
[`deployments/cc3-testnet.json`](../deployments/cc3-testnet.json). The live feed at
[humanline.credit/relay](https://humanline.credit/relay) reads the chain directly, so it
only ever shows the current instances — the log is the historical record of what the
relayer did, including against contracts that are no longer current.

Rows are appended by `bun run worker/src/cli.ts relay`, which runs both as a long-lived
daemon and as the 15-minute GitHub Actions cron in
[`.github/workflows/relay.yml`](../.github/workflows/relay.yml). The workflow commits new
rows back to `main`, so the file's git history is the relayer's uptime record.

## `self-relay.jsonl`

One JSON object per self-relay transaction, written by
[`web/scripts/self-relay.ts --send`](../web/scripts/self-relay.ts), which runs the same plan,
proof and `executeBatch` code as the verify card's *Relay it now from your wallet* button.

| Field | Meaning |
|---|---|
| `kind` | always `self-relay` |
| `relayer`, `freshWallet` | the sending address, and whether it was generated for this run and funded only by the gas faucet |
| `cc3TxHash`, `status`, `gasUsed` | the Creditcoin `executeBatch` transaction |
| `sourceTxHashes`, `postRoots` | the World ID updates it carried, oldest first |
| `roots` | `RootRelayed` events in the receipt |
| `vault`, `rewardedRoots`, `rewardPaidWei`, `netBalanceChangeWei` | when sent through `RelayReward`: the vault, roots it paid for, the reward, and the relayer's balance change net of gas |
| `chainKey`, `contract`, `at` | source chain, receiving `AttestedWorldID`, and when |

## `seed-demo.jsonl`

Demo activity on the reproducible (staging-tree) deployment, written by
[`web/scripts/seed-demo.ts`](../web/scripts/seed-demo.ts). These are Humanline's own wallets, not
users. Each one went through the real product path: a World ID Simulator identity proved itself
against a Sepolia root relayed through Attestcoin, `HumanRegistry.register` verified the Groth16
proof on Creditcoin, and the new human opened a CreditLine v3 line, borrowed 20 hUSD, and repaid
it on time.

| Field | Meaning |
|---|---|
| `kind` | `seed-demo-human` (one human's register-and-borrow cycle) or `seed-demo-poll` (the first `HumanPoll` poll and a vote from each seeded human) |
| `wallet`, `human` | the fresh wallet, and the nullifier bound to it |
| `simulatorIdentity` | which World ID Simulator identity produced the proof |
| `txs` | gas funding from the deployer, `register`, `openLine`, `borrow`, the hUSD faucet claim for the 1% fee, `approve`, `repay` |
| `pollId`, `createTx`, `votes` | the poll and one vote per seeded human |

## The rest

| File | What it is |
|---|---|
| `e2e-worldid-staging.md`, `e2e-worldid-staging-result.json` | a real World ID proof from the simulator, registered on Creditcoin — transaction hash, gas, the resulting nullifier |
| `e2e-credit-loop.log` | faucet → deposit → openLine → borrow → repay against the live contracts, with the limit moving 25 → 31.25 hUSD |
| `relay-daemon.log` | stdout of the long-lived relayer, kept as a liveness record |
| `relay-v1-store.sqlite.bak` | the v1 relay cursor store, kept so the v1 rows above can be traced |
