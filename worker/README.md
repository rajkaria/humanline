# Humanline worker — the root relay

Relays World ID identity-tree roots from Ethereum onto Creditcoin CC3 through the
Attestcoin Protocol. It watches `TreeChanged` on the World ID identity managers, obtains
inclusion + continuity proofs from the Attestcoin proof builder, and calls `execute` /
`executeBatch` on the matching `AttestedWorldID` instance.

```
Ethereum mainnet  (chainKey 3, manager 0xf7134CE1…bddEa)  ─┐
                                                           ├─ proofs ─▶ AttestedWorldID on CC3
Ethereum Sepolia  (chainKey 1, manager 0xb2ead588…7076)   ─┘
```

Everything runs on Bun. `node` is not used anywhere.

## Quick start

```bash
cd worker
bun install                       # already done at the repo root workspace
bun run src/cli.ts check          # no wallet or deployment needed
bun test                          # 156 tests, no network
```

## Commands

| Command | What it does |
|---|---|
| `check` | Probes all three Attestcoin precompiles, lists supported chains with attested tips and bonded attestor counts, sanity-checks the bn128 precompiles the Semaphore verifier needs, prints the relayer balance and both `AttestedWorldID` instances' `latestRoot` / `rootCount`. |
| `bootstrap --source <s> [--tx <hash>]` | Seeds the first root for a source chain. Without `--tx` it walks backwards from the head for the most recent `TreeChanged`. Refuses to run once `rootCount > 0`. |
| `prove <txHash> --source <s>` | One-off: wait for attestation, fetch the proof, replay every contract guard locally, verify against the precompile, then `execute`. |
| `relay --source <mainnet\|sepolia\|all>` | Continuous relay (poll every 60 s). `--once` for a single pass, `--from <block>` to raise the starting block. |
| `status` | Cursor, per-transaction counts, failed transactions with their reasons, on-chain root state, and the tail of the evidence log. |

Global flags: `--env-file`, `--deployments`, `--db`, `--evidence-file`.

### `--dry-run`

`prove` and `relay` accept `--dry-run`: they do everything except send the transaction, and
print the exact calldata size plus a read-only `verifySingle` / `verifyBatch` result from
the `0x0FD2` precompile. This is the whole relay path minus the write, so it works before
the contracts are deployed and needs no wallet.

```bash
bun run src/cli.ts prove 0x81ece311…dc7e3 --source mainnet --dry-run
bun run src/cli.ts relay --source sepolia --once --dry-run
```

## Configuration

Copy `.env.example` to `.env`, or put `CREDITCOIN_WALLET_PRIVATE_KEY` in the repo-root
`.secrets.env`. The CLI loads `--env-file`, then `worker/.env`, then `../.secrets.env`,
never overriding a variable that is already set, and never printing a value.

Deployment addresses come from `DEPLOYMENTS_FILE` (default `../deployments/cc3-testnet.json`):

```json
{
  "chainId": 102031,
  "contracts": {
    "AttestedWorldIDMainnet": "0x…", "AttestedWorldIDSepolia": "0x…",
    "HUSD": "0x…", "HumanRegistry": "0x…", "CreditLine": "0x…", "HumanGate": "0x…"
  }
}
```

When that file is missing, every command that would write on-chain prints a "not deployed
yet" message and **exits 2**. `check` and the `--dry-run` paths still work.

### RPC endpoints

The documented default for mainnet (`https://ethereum-rpc.publicnode.com`) rejects
`eth_getLogs` outright — "Archive requests require a personal token". The worker therefore
keeps a fallback list per source and rotates to the next endpoint on failure, logging each
switch. Set `ETH_MAINNET_RPC` to your own archive node for production; a comma-separated
list is accepted and is tried in order before the built-in fallbacks.

## How the relay works

1. **Cursor.** `max(sqlite cursor, last on-chain `RootRelayed` sourceBlock + 1, --from)`.
   Chain state beats local state, so a fresh worker — or the GitHub Actions cron, which has
   no disk — resumes correctly. The scan is also clamped to
   `min(head, attestedTip − FINALITY_DEPTH)`, the highest block the contract's finality
   guard could accept right now, so a pass never blocks on blocks that cannot land yet.
2. **Scan.** `eth_getLogs` for `TreeChanged` from the manager, in ≤ 5,000-block windows,
   ordered by `(blockNumber, logIndex)`, one entry per transaction. Never reordered.
3. **Skip what is done.** `queryId = keccak(uint256 chainKey ‖ uint64 blockHeight ‖
   uint256 txIndex)` is computed locally (identical to `ASCBase._computeQueryId`) and
   checked against `processedQueries` before any proof is fetched.
4. **Batch.** Consecutive transactions are grouped while `maxBlock − minBlock ≤ 1000` and
   size ≤ 10, so one continuity proof covers the whole batch.
5. **Prove.** `waitUntilHeightAttested`, then `getBatchProof`; if the batch call fails the
   worker falls back to per-transaction `getProof` + `execute`.
6. **Replay the guards locally.** `src/evmv1.ts` decodes the Attestcoin EvmV1 payload in
   pure TypeScript and re-checks the contract's steps 1–6 — source chain, receipt status,
   `to == IDENTITY_MANAGER`, exactly one `TreeChanged` from the manager (decoy logs from
   other contracts are skipped, not fatal), known selector, and calldata-vs-log agreement
   on `preRoot`/`postRoot`. A mismatch is recorded instead of burning gas.
7. **Verify read-only,** then estimate gas and submit `execute` / `executeBatch`, waiting
   one confirmation.
8. **Retry policy.** `Query already processed` → done. `NotFinal` / `ThinQuorum` /
   `UnknownPreRoot` → stays pending for the next pass. A stale proof or an unrecognised
   revert → refetch the proof and retry once, then record as failed. Permanent guard
   failures are recorded immediately. **Nothing is ever dropped**: every transaction keeps
   a row in sqlite and shows up in `status`.
9. **Evidence.** One JSON line per relayed transaction appended to
   `evidence/relay-log.jsonl`:

```json
{"source":"sepolia","txHash":"0x…","sourceBlock":11687163,"txIndex":58,"preRoot":"0x…",
 "postRoot":"0x…","kind":0,"humansAdded":100,"cc3TxHash":"0x…","gasUsed":"421337",
 "attestationLagSec":612,"at":"2026-09-12T10:00:00.000Z"}
```

`attestationLagSec` is measured end to end: source block timestamp → CC3 inclusion
timestamp.

## Files

| File | Role |
|---|---|
| `src/cli.ts` | commander entry point for all five commands |
| `src/config.ts` | env loading, source definitions, deployment resolution, the exit-2 gate |
| `src/abi.ts` | `contracts/abi/AttestedWorldID.json` when present, hand-written fragments otherwise |
| `src/cc3.ts` | CC3 provider/signer, precompile reads, `computeQueryId`, `computeTxIndex`, revert decoding |
| `src/sources.ts` | `LogSource` with RPC failover, window planning, `TreeChanged` ordering |
| `src/proofs.ts` | proof fetching and the `execute` / `executeBatch` argument mapping |
| `src/evmv1.ts` | pure-TS EvmV1 decoder + off-chain replay of the contract guards |
| `src/relay.ts` | cursor derivation, batching, retry policy, the submission pipeline |
| `src/store.ts` | `bun:sqlite` cursor and per-transaction status |
| `src/evidence.ts` | evidence line formatting and the append-only JSONL |
| `src/spike.ts` | the original SDK spike that produced the test fixtures |

## Tests

`bun test` — no network, no wallet. Argument mapping and guard replay run against the real
proof fixtures in `contracts/test/fixtures/`; the retry policy is driven through mocked
submissions.

## CI

`.github/workflows/relay.yml` runs every 30 minutes and on manual dispatch: `bun install`,
`check`, `relay --source all --once`, `status`, then commits `evidence/relay-log.jsonl`
back with `[skip ci]`. Secrets: `CREDITCOIN_WALLET_PRIVATE_KEY`, `ETH_MAINNET_RPC`,
`ETH_SEPOLIA_RPC`.

## Prover independence

The hosted proof builder is a convenience. Proofs can be built locally from any Ethereum RPC with
usc-sdk's `RawProofBuilder` + `SimpleBlockProvider` (`src/local-proof.ts`, behind a block cache):

```bash
# Build a proof locally, recheck inclusion, and confirm its continuity digest is attested on CC3
bun run src/cli.ts local-proof 0x2e34a9030ece366901a54228bed260f20cedfd6db22253d005b0aaeb27e8c7cb --source sepolia

# Build locally, fetch from the hosted prover, compare byte for byte; appends evidence/proof-diff.jsonl
bun run src/cli.ts proof-diff 0x2e34…c7cb 0xf377…67cb --source sepolia
```

Inclusion (transaction bytes, index, Merkle path) must be identical. A continuity proof can differ
when the two were built against different attestation bounds (a hosted proof may be cached); that
difference is accepted only if the local chain folds to a digest ChainInfo `0x0FD3` reports as
attested or checkpointed. `proveWithFallback` builds locally and falls back to the hosted prover.
