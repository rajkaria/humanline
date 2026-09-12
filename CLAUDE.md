# Humanline — project context index

One human, one credit line: World ID proof of personhood on Creditcoin via the Attestcoin Protocol. BUIDL CTC 2026 Fall submission (deadline 2026-09-13 23:59 ET). Full spec: `docs/SPEC.md`. Execution ledger with every ruling: `.superpowers/sdd/PLAN/progress.md`.

Tooling notes: use `bun` for everything (`node` is blocked as a bare command); Foundry binaries are in `.tools/` (`.tools/forge`, `.tools/cast`); `forge script` cannot target CC3, deploy with `contracts/script/deploy-cc3.sh`; secrets live only in the git-ignored `.secrets.env` (never copy them into docs).

## Context docs

| Doc | Covers |
|-----|--------|
| `docs/context/protocol-and-relay.md` | Solidity contracts, Foundry tests, deployments, the Bun relay worker, evidence, GitHub Actions relayer |
| `docs/context/web-and-submission.md` | Next.js app, World ID/IDKit wiring, Vercel, docs/pitch/deck/video, DoraHacks submission checklist |
