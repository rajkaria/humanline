---
feature: web-and-submission
globs:
  - web/**
  - docs/**
  - README.md
  - CHANGELOG.md
updated: 2026-09-12
---

# Web app and hackathon submission

## Current state — what's working, deployed, broken
- Next.js 15 app in `web/` (bun): `/` landing, `/app` (World ID verify + credit line + lender panel), `/relay` (live root feed from both AttestedWorldID instances, precompile guard readouts), `/judge` (addresses, commands, evidence, prove-it widget), `/docs`. 122 tests, build clean. Dev server was running on :3000 (`cd web && bun run dev`; `.env.local` holds the World config and the RP signer key copied from the git-ignored `.secrets.env`).
- World ID: app `app_87b24915fcf733f10df1b0c46dd1f783`, RP `rp_84b02642423cadf5` (registered prod+staging), action `humanline-register`; IDKit 4.2 `IDKitRequestWidget` + `orbLegacy` preset + `allow_legacy_proofs`, rp_context signed in `web/app/api/world/rp-context/route.ts`. End-to-end proven with the simulator (Identity #0) via `web/scripts/e2e-worldid.ts`; credit loop via `web/scripts/e2e-credit.ts`.
- Web review round 1 (1 Critical: invented Foundry test names on /judge; 6 Important) is FIXED and committed (202 tests, build/lint/typecheck clean; details in `.superpowers/sdd/PLAN/task-4-report.md` "Fix round 1"). Still owed: the scoped re-review against `.superpowers/sdd/PLAN/task-4-review.md` (diff range: the commit "fix(web): review round 1"), then ledger `Task 4: complete`.
- Vercel: project `humanline` linked from `web/` (`.vercel/` git-ignored), env vars set for production and preview (World app/env/RP/action + sensitive signer key). Not deployed yet. `web/lib/generated/*` artifacts are tracked so a Vercel build works; prefer `cd web && bun x vercel build && bun x vercel deploy --prebuilt --prod --yes`.
- GitHub: public repo https://github.com/rajkaria/humanline, `main` pushed.
- Docs: SPEC, PLAN, research, competitor ratings (87 rivals), VISION, DECK.md + `docs/deck.pdf`, VIDEO_SCRIPT, SUBMISSION, SECURITY, ARCHITECTURE, ATTESTCOIN_INTEGRATION, README, CHANGELOG. Screenshots: `docs/screenshots/hero.png`, `relay.png` (dev server; retake from production URL).
- Unfilled tokens: `{{LIVE_URL}}`, `{{VIDEO_URL}}`, `{{LOGO_URL}}`, `{{TEAM_*}}` (need Raj's team block), deck counters `{{ROOTS}}/{{HUMANS}}/{{CREDIT}}` (rebuild deck via `docs/deck-build.js`).

## Recent changes — files touched and why
- `web/**` — full app (implementer), plus in-flight fix round 1 edits.
- `docs/*.md`, `README.md`, `CHANGELOG.md` — pitch and technical docs; addresses and real test names filled; repo URL filled.
- `docs/screenshots/*` — Playwright captures (`bun x playwright@1.55.0 screenshot ...`, Chromium installed).

## Key decisions — choices and trade-offs
- Track: DeFi. Positioning: "every credit passport can be forged by a new wallet; ours cannot, the nullifier is the human." Depth of Attestcoin use is the core scoring criterion (see `docs/ATTESTCOIN_INTEGRATION.md`).
- Demo uses the staging tree + simulator so judges can reproduce; production Orb path is wired (`NEXT_PUBLIC_WORLD_ENV=production`) but needs an Orb-verified user.
- Cloud verify endpoint is never a gate; on-chain `HumanRegistry.register` is the verification.

## Next steps — specific, actionable
1. Scoped re-review of the web fix commit, ledger Task 4 complete, then deploy to Vercel and fill `{{LIVE_URL}}` in README/docs/SUBMISSION; retake screenshots from the live URL; push.
2. Run the 7-judge simulation from the hackathon skill against the live deployment; fix Critical/Important; repeat to 9+.
3. Collect from Raj: team block, whether he has an Orb-verified World ID, then he records the 3-minute video from `docs/VIDEO_SCRIPT.md`; fill `{{VIDEO_URL}}`; rebuild deck counters; submit on DoraHacks per `docs/SUBMISSION.md` before 2026-09-13 23:59 ET.
