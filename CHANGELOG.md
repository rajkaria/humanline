# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-12

The submission becomes something a stranger can use, not only something a judge can inspect.

### Added

- **A second deployment on World's Ethereum mainnet Orb tree** — `HumanRegistry`
  `0x53fcba2c…`, `CreditLine` `0x86e38ce7…` (30-day term, 7-day grace), `HumanGate`
  `0x544264e5…`, all Blockscout-verified. `/app` switches between it and the Sepolia-staging
  deployment at runtime (`?profile=production`), moving the registry, the credit line and the
  World ID environment together, because a proof against one tree can only revert against the
  other's registry. Both share one hUSD and both read the same relayed `AttestedWorldID`
  instances.
- **A root-freshness check before the register transaction.** World mints a proof against the
  identity tree's newest root, which the relayer may not have carried to Creditcoin yet; the
  verify card now asks `isValidRoot` first and explains the wait instead of letting
  `register` revert after the user has paid gas.
- **`/api/gas`**, a CC3 gas drip for first-time humans. `register` binds the proof to
  `msg.sender`, so a wallet with no tCTC cannot use Humanline however good its proof is. Guarded
  by an on-chain balance check and a per-IP bucket; the card only appears when the connected
  wallet cannot pay.
- **`contracts/script/verify-blockscout.sh`**, which re-encodes constructor arguments from the
  deployment file itself, and `REUSE`/`REUSE_FROM` in `deploy-cc3.sh` for deploying a second
  profile against already-relayed contracts. **`scripts/seed-pool.sh`** seeds a lender pool
  through the hUSD faucet's per-address daily limit; both pools now hold real liquidity.
- **The relayer runs in CI**, every 15 minutes, committing its evidence rows back to `main` —
  so relaying no longer depends on a laptop staying awake. Evidence rows now record the
  `AttestedWorldID` instance that received the root, and `evidence/README.md` documents the
  schema.

### Fixed

- **Every API route on the deployed site answered 500** (`Cannot find module
  'next/dist/compiled/source-map'`): the build traced only `web/`, but bun hoists this
  workspace's dependencies — the Next runtime included — into the repo root. That had taken
  World ID verification down with it.
- **A fresh clone could not build or test the contracts**: `forge-std` was committed as a bare
  gitlink with no `.gitmodules`, the contracts' own `bun install` was undocumented, and the
  README told judges to run a Foundry binary the repo does not ship. Verified end to end from a
  clean clone.
- **`bun.lock` was untracked**, so `bun install --frozen-lockfile` in the relay workflow would
  have failed on every run.
- **Relay state is now bound to its contract address.** A cursor from a previous deployment
  claimed the new instance's roots were already handled; the store resets that source's state
  when the address changes instead of relying on someone remembering to delete the database.

## [0.1.0] - 2026-09-12

First public release: the BUIDL CTC 2026 Fall submission. Everything below is live on Creditcoin CC3
testnet (chainId 102031) and verified on Blockscout. Addresses are in
[`deployments/cc3-testnet.json`](deployments/cc3-testnet.json).

### Added

- **`AttestedWorldID`**, a World ID root mirror on Creditcoin whose only trusted input is an
  Attestcoin proof. It inherits `ASCBase` from `@gluwa/asc-contracts` and World's `WorldIDBridge`,
  so every root arrives through `verifyAndEmit` on the BlockProver precompile at `0x0FD2`, and the
  resulting contract is an ordinary `IWorldID` that any existing World ID integration can consume.
  No owner, no pause, no upgrade path; every parameter is an immutable set at construction.
- **A custom `executeBatch`** using the batch `verifyAndEmit` overload, so up to 10 source
  transactions inside a 1,000-block window share one continuity proof. Batch size, array lengths and
  non-decreasing block heights are enforced on chain, and each member is deduplicated individually
  against the same `processedQueries` mapping the single path uses.
- **Everything Attestcoin does not prove**, checked in `AttestedWorldID` in order: source chain key,
  receipt status, callee binding to the World ID identity manager, `TreeChanged` log filtered by
  emitter (a decoy from another contract is skipped rather than fatal), independent calldata
  decoding of the `registerIdentities` and `deleteIdentities` word layouts cross-checked against the
  log, root chaining against `latestRoot` or a known historical root, a finality guard reading
  ChainInfo `0x0FD3`, a bonded-attestor quorum floor reading AttestorStash `0x0FD4`, and one-time
  processing keyed by the `calculateTxIndex`-derived query id.
- **`HumanRegistry`**, binding a World ID nullifier to a Creditcoin wallet after verifying a
  Semaphore Groth16 proof natively on CC3 over the bn128 precompiles. The signal is `msg.sender`, so
  a proof lifted from the mempool is useless to anyone else; the external nullifier is fixed at
  construction from the app id and the action `humanline-register`. Re-registering from a new wallet
  moves the binding and never mints a second human.
- **`CreditLine`**, a lender-funded pool opening exactly one revolving line per nullifier. Borrow,
  repay with a 1% term fee, grow the limit by 1.25x on an on-time full repayment (capped at 2,000
  hUSD), halve it on a late one, and freeze the human permanently on default with the pool absorbing
  the write-off pro rata. All state is keyed by the human, so a wallet re-bind carries the limit,
  the balance and the freeze.
- **`HUSD`**, a six-decimal test stablecoin with a 24-hour per-address faucet, and **`HumanGate`**,
  the whole integration pattern in twenty lines: one claim per human, not per wallet.
- **Relay worker** (`worker/`): a Bun CLI with `check`, `bootstrap`, `prove`, `relay` and `status`.
  It derives its cursor from chain state so a fresh process or a CI runner resumes correctly, clamps
  its scan to the finality ceiling, batches within the protocol's limits, replays every contract
  guard off chain in pure TypeScript before spending gas, verifies read-only against `0x0FD2`, and
  appends one evidence line per relayed transaction. It holds no privilege beyond paying for gas.
- **Web app** (`web/`): landing page, borrower and lender app with IDKit verification, a live relay
  feed showing both `AttestedWorldID` instances and the precompile guard values, a `/judge` page that
  reproduces every claim without a wallet, and integrator docs.
- **Serverless relay fallback** in `.github/workflows/relay.yml`: a 30-minute cron that runs a
  preflight, relays whatever is outstanding, and commits `evidence/relay-log.jsonl` back to the repo.
- **`contracts/script/deploy-cc3.sh`**, a `cast`-based deployment path, because `forge script` cannot
  target CC3 (see Known issues).
- **Documentation**: [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md) (the required
  technical write-up, with a code excerpt per protocol surface, the live evidence table, gas figures,
  reproduction commands and the threat-to-test map), plus `docs/SPEC.md`, `docs/ARCHITECTURE.md`,
  `docs/SECURITY.md`, `docs/VISION.md`, `docs/SUBMISSION.md` and the pitch deck.

### Review round 1: contracts

Five findings from the contracts review, all fixed with covering tests. Contract test count went
from 94 to 101.

- **Fixed: a write-off that emptied the pool could brick it.** Share pricing moved to an
  OpenZeppelin-style virtual offset, `shares = assets * (totalShares + 1e3) / (totalAssets() + 1)`
  and the inverse. The `+ 1` removes the divide-by-zero, so a new deposit re-seeds an emptied pool
  instead of reverting with an unnamed arithmetic panic, and the wiped-out shares stay worthless
  rather than diluting the rescuer.
- **Fixed: first-depositor donation attack.** The same `+ VIRTUAL_SHARES` term bounds it. An
  attacker who opens with one unit and then donates forfeits most of the donation to the virtual
  tranche: measured, the attacker spends 1,000.000001 hUSD and recovers 500.125032 while the victim
  keeps 999.749938 of 1,000, a 0.025% rounding loss.
- **Fixed: the term fee was booked as pool income at draw time.** A lender could exit ahead of a
  default carrying interest that had never been paid. `totalAssets()` is now
  `idle balance + totalPrincipal`, where `totalPrincipal` is the ex-fee amount still out on loan, so
  a draw no longer moves the share price. A repayment clears the ex-fee principal first and anything
  on top is realized fee income; a default writes off only the ex-fee principal. `totalBorrowed()`
  became a view with the same selector and return type, and `principalOf(human)` was added.
- **Fixed: relayed roots were dated by arrival, which made the one-week history expiry
  meaningless under a permissionless relay.** Anyone could have side-filled a year-old genuine World
  root and handed it a fresh week of validity. Roots are now stamped
  `now - (attestedTip - sourceBlock) * SOURCE_BLOCK_TIME`, using the attested tip already read for
  the finality guard, floored at 1. A root older than the expiry arrives already expired;
  `latestRoot` stays unconditionally valid, per World's own semantics. `SOURCE_BLOCK_TIME` is a new
  immutable constructor argument (12 for both Ethereum chains) and is recorded in the deployment
  file.
- **Fixed: the bn128 fork test proved nothing.** `staticcall` reports success on any EVM, codeless
  address or not. It is now a known-answer test over `eth_call` against the live node: `0x08` with
  empty input returns 1, and `0x06` and `0x07` on the point at infinity return 64 zero bytes. An
  absent precompile returns no data and fails.

### Review round 1: worker

Six review findings (two critical, four important), plus one item from the coordinator and one bug
the live deployment exposed. Worker test count went from 162 to 195.

- **Fixed (critical): `QueryAlreadyProcessed(bytes32)` was classified as an unknown revert.** The
  batch path reverts with the custom error while `ASCBase` reverts with the string
  `"Query already processed"`. Both mean the query is already recorded, which is success. The
  classifier now matches both spellings, and the error was added to the fallback ABI fragments so
  the classification also works without the artifact. Previously this cost a wasted proof refetch
  and a second reverting submission before reaching the right answer.
- **Fixed (critical): the cursor could advance into a block still holding unsettled work.** It now
  advances only across the leading run of settled batches **and** is clamped below the first block
  any unsettled batch touches, so a block shared by a settled and a failed batch is rescanned rather
  than skipped.
- **Fixed: a retry could resubmit the wrong work.** When `getBatchProof` degraded to per-transaction
  proofs mid-retry, the refetch hook submitted the first proof as if it were the whole batch. It now
  scopes the refetch to the submission in flight and throws rather than guessing, so the
  transactions are recorded as failed and the cursor does not advance. Nothing is dropped and
  nothing is double-relayed.
- **Fixed: `RootRelayed` events were matched by source block alone.** Two transactions in one source
  block overwrote each other's roots in the evidence log. Events are now keyed by
  `(sourceBlock, sourceTxIndex)`.
- **Fixed: `FINALITY_DEPTH` was hard-coded at 32 in the worker.** It is now read from the deployed
  contract and memoized, used by both the attestation wait and the scan ceiling, and reported in the
  scan line. The source default is used only when no contract address is reachable.
- **Fixed: `worker/.env.example` and `web/.env.example` were caught by the `.env.*` ignore rule.**
  Both are deliverables, not secrets, and are now explicitly un-ignored.
- **Fixed: `NoRootsSeen()` was treated as a failed read rather than "not bootstrapped yet".**
  `check` and `status` now say so plainly and print the exact `bootstrap` command, and the scan path
  treats it as an empty on-chain cursor.
- **Fixed: cursor recovery timed out against CC3.** The `RootRelayed` backward scan walked 50,000-block
  windows over a 2,000,000-block lookback against a 10-second server-side query timeout, on contracts
  that had been deployed 36 blocks earlier. The scan floor now comes from the deployment transaction
  recorded in the deployments file, the window dropped from 50,000 to 10,000 blocks, and the query
  halves its span and retries down to 500 blocks on a retryable RPC complaint.
- **Fixed** during live testing, before review: the cursor could jump past a failed batch when
  outcomes interleaved, and the per-transaction fallback returned only the last outcome, so three of
  four mainnet transactions vanished from the outcome list. Both paths now return and account for
  every member.

### Deployed

- Contracts deployed to CC3 testnet with the `demo` profile (600-second term, 300-second grace) and
  verified on Blockscout. Both `AttestedWorldID` instances were bootstrapped and have relayed real
  World ID roots from Ethereum mainnet and from the Sepolia staging tree, single and batched. The
  transaction hashes, gas and attestation lag for each are in
  [`evidence/relay-log.jsonl`](evidence/relay-log.jsonl).
- The pre-review deployment of the same six contracts is preserved in
  `deployments/cc3-testnet.v1.json`, so the earliest evidence rows stay attributable. The redeploy
  was required because the contracts review changed the `AttestedWorldID` constructor (adding
  `SOURCE_BLOCK_TIME`) and the `CreditLine` share math.

### Known issues

- **Foundry cannot open a CC3 RPC as an EVM environment.** CC3 is a Substrate and Frontier chain
  whose block headers carry no `mixHash`, so revm rejects the environment over `prevrandao` before
  any script or test body runs. This affects `forge script --rpc-url` and `forge test --fork-url`
  alike, with or without `--skip-simulation`. Workarounds in place: deployment goes through
  `cast send --create` in `contracts/script/deploy-cc3.sh`, and the fork tests read the live chain
  over `vm.rpc("cc3", ...)`.
- **Public Ethereum mainnet RPCs are hostile to `eth_getLogs`.** The documented default rejects
  archive requests outright, so the worker fails over through a list and logs each switch. Set
  `ETH_MAINNET_RPC` to a real archive endpoint for sustained relaying.
- **The prover's batch endpoint returned HTTP 500 once** for an uncached mainnet range during
  testing. The per-transaction fallback recovered cleanly, at the cost of more calldata and more gas.
- **Bootstrap is permissionless by design.** The first relayer decides where local root history
  begins. A griefer who bootstraps a very old genuine root would force expensive side-fills before
  modern roots chain; the attack costs liveness, not soundness, since every root involved is genuine.
- **A garbage Groth16 proof is an expensive revert.** The vendored Semaphore verifier's failure path
  consumes a great deal of gas before reverting with `ProofInvalid`, so clients should let
  `register` estimate rather than hard-coding a gas limit.

[0.2.0]: https://github.com/rajkaria/humanline
[0.1.0]: https://github.com/rajkaria/humanline/releases/tag/v0.1.0
