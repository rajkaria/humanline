---
feature: protocol-and-relay
globs:
  - contracts/**
  - worker/**
  - deployments/**
  - evidence/**
  - .github/workflows/**
updated: 2026-09-12
---

# Protocol and relay (contracts + worker)

## Current state — what's working, deployed, broken
- Contracts (Solidity 0.8.28, Foundry, via_ir) deployed on Creditcoin CC3 testnet, demo profile (TERM 600 s, GRACE 300 s), all six Blockscout-verified. Addresses in `deployments/cc3-testnet.json` (v2; v1 kept in `cc3-testnet.v1.json`). Tests: 101 (94 unit + 7 live fork-style via `vm.rpc`); run `cd contracts && ../.tools/forge test`, live ones with `CC3_FORK=1`.
- AttestedWorldID (mainnet chainKey 3 and Sepolia chainKey 1 instances) relays real World ID roots through Attestcoin: `execute` (ASCBase) and `executeBatch` (batch `verifyAndEmit`), calldata+log cross-check, root chaining, 0xFD3 finality guard, 0xFD4 quorum guard, proof-dated timestamps. rootCount 4 each at save time, more arriving hourly.
- Worker (Bun, `@gluwa/usc-sdk` 0.18): `check | bootstrap | prove | relay | status`, 195 tests. A continuous daemon is running with `nohup` (`worker`, `relay --source all`, log `evidence/relay-daemon.log`, cursor store `worker/data/relay.db`). It dies with the machine; restart it from `worker/` with the relayer key exported from the git-ignored `.secrets.env`.
- Live evidence in `evidence/relay-log.jsonl` (rows 1–5 are the v1 deployment), `evidence/e2e-worldid-staging.md` (real staging proof verified on CC3, register tx 0x930a22eb…), `evidence/e2e-credit-loop.log` (borrow/repay loop, limit 25→31.25).
- Known gaps: worker cursor store is keyed per source, not per contract address (after a redeploy delete `worker/data/relay.db`); publicnode mainnet RPC rejects `eth_getLogs`, Tenderly failover is used, set `ETH_MAINNET_RPC` to an archive endpoint for GitHub Actions; `forge script` cannot target CC3 (no `mixHash`), deploy with `contracts/script/deploy-cc3.sh` (bash 3.2 compatible).

## Recent changes — files touched and why
- `contracts/src/AttestedWorldID.sol`, `HumanRegistry.sol`, `CreditLine.sol`, `HUSD.sol`, `examples/HumanGate.sol`, `interfaces/*` — the product; review round 1 added virtual-offset share math, ex-fee pool accounting (`totalPrincipal`, `principalOf`), `_receiveRootAt` timestamps from attested-tip distance, `SOURCE_BLOCK_TIME` constructor arg.
- `contracts/test/*` — unit suites with real proof fixtures (`test/fixtures/*.json`) and fork-style tests; harness stubs guards.
- `contracts/script/deploy-cc3.sh` — cast-based deployer writing `deployments/cc3-testnet.json`.
- `worker/src/*` — relay pipeline; round 1 fixed batch already-processed detection, cursor clamp across shared blocks, scoped refetch, per-tx event keys, on-chain `FINALITY_DEPTH()`, `NoRootsSeen` handling, deployment-block scan floor.
- `.github/workflows/relay.yml` — 30-minute cron fallback relayer (needs secrets `CREDITCOIN_WALLET_PRIVATE_KEY`, `ETH_MAINNET_RPC`, `ETH_SEPOLIA_RPC`).

## Key decisions — choices and trade-offs
- World ID 3.0 Semaphore path (Orb, groupId 1) with `allow_legacy_proofs`; 4.0 proofs verify only on World Chain and are the roadmap ("Periscope": OP-Stack output roots through Ethereum).
- Bootstrap records preRoot and postRoot; side-fills never move the tip; unknown preRoot reverts. No owner, no pause, no upgrade anywhere.
- FEE_BPS 100 per draw (not APR); on-time repayment ×1.25 limit, late ÷2, default freezes the nullifier forever.
- Two AttestedWorldID instances (mainnet Orb tree for production evidence, Sepolia staging for judge-reproducible proofs via World's simulator). HumanRegistry points at the Sepolia instance on the demo deployment.
- SDD ledger with all rulings: `.superpowers/sdd/PLAN/progress.md`; deferred Minor findings live in `task-*-review.md`.

## Next steps — specific, actionable
1. Keep the relay daemon alive through judging (restart after reboot); refresh the evidence table in `docs/ATTESTCOIN_INTEGRATION.md` from `evidence/relay-log.jsonl` before submission.
2. Final whole-branch review (most capable model) over `b247f99..HEAD`, then triage deferred Minors (worker M1 batch-error classification; contracts M-8 zero-asset withdraw error; cursor keyed per contract).
3. Optional depth: repay-from-Ethereum via Attestcoin (second protocol surface) if time allows.
