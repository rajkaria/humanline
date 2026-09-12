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
- Vercel: **LIVE at https://humanline-alpha.vercel.app** (stable production alias; the project URL `humanline-rajkaria67-1831s-projects.vercel.app` aliases the same deployment). Project `humanline` linked from `web/` (`.vercel/` git-ignored), env vars set for production and preview. Deploy with `cd web && bun x vercel deploy --prod --yes` (cloud build). Do NOT use `--prebuilt`: bun's symlinked `node_modules` breaks the upload (`@swc/helpers` ENOENT). `next.config.ts` pins `outputFileTracingRoot` to `__dirname` when `VERCEL` is set — with `..` the build output landed at `/vercel/path0/path0/.next` and the deploy failed.
- Deployment protection: the project still reports `ssoProtection: enabled (all_except_custom_domains)` even though anonymous loads of every route return 200. Re-check before submitting (Vercel dashboard → Settings → Deployment Protection → Vercel Authentication = Off); a judge hitting a login wall is a dead submission.
- GitHub: public repo https://github.com/rajkaria/humanline, `main` pushed.
- Docs: SPEC, PLAN, research, competitor ratings (87 rivals), VISION, DECK.md + `docs/deck.pdf`, VIDEO_SCRIPT, SUBMISSION, SECURITY, ARCHITECTURE, ATTESTCOIN_INTEGRATION, README, CHANGELOG. Screenshots: `docs/screenshots/hero.png`, `relay.png` (dev server; retake from production URL).
- `{{LIVE_URL}}` is filled everywhere (the one left in `docs/DECK.md` is the line that names the tokens). Still unfilled: `{{VIDEO_URL}}`, `{{LOGO_URL}}`, `{{TEAM_*}}` (need Raj's team block), deck counters `{{ROOTS}}/{{HUMANS}}/{{CREDIT}}` (rebuild deck via `docs/deck-build.js`).
- Site metadata: `metadataBase` + `app/opengraph-image.tsx` (the OG/Twitter card), `app/icon.svg`, real `favicon.ico` (was Next's default logo) and `apple-icon.png`. `NEXT_PUBLIC_SITE_URL` overrides the base when a custom domain lands.
- **Landing page redesigned** (2026-09-12). The font variables had been declared on `<body>` while `html { font-family: var(--font-sans) }` consumed them in the `<html>` scope — every page had been rendering in the UA serif. Fixed, and the display face is now Space Grotesk (`--font-heading`), body Inter, data JetBrains Mono. New logo (`components/wordmark.tsx`): a human dot inside two broken proof rings with one credit line leaving through the gap; the gradient is defined once by `BrandGradientDefs` in the root layout and every mark references it. Theme gained a three-step elevation scale (`--surface`, `--surface-2`, `--hairline`) and the `panel` / `panel-brand` / `surface-dots` / `display-xl` / `live-dot` utilities; `ui/card.tsx` uses `panel` so every page matches. The landing page is rebuilt around hero + live readout (`components/live-panel.tsx`, replaces the deleted `live-counters.tsx`), a four-point proof strip, a "wallet is not a person" problem section, a numbered timeline over the architecture diagram, the comparison, personas, a "check it yourself" section and the closing CTA. Icons and the OG card were regenerated from the new mark.
- Live counters as of the production screenshots: 4 roots (Ethereum) + 5 (Sepolia), 1 human registered, **0.00 hUSD outstanding** of 60.20 in the pool. A zero credit counter is the weakest number on the landing page — run `web/scripts/e2e-credit.ts` against CC3 to leave a real borrow outstanding before recording the video.

## Recent changes — files touched and why
- `web/**` — full app (implementer), plus in-flight fix round 1 edits.
- `docs/*.md`, `README.md`, `CHANGELOG.md` — pitch and technical docs; addresses and real test names filled; repo URL filled.
- `docs/screenshots/*` — Playwright captures (`bun x playwright@1.55.0 screenshot ...`, Chromium installed).

## Key decisions — choices and trade-offs
- Track: DeFi. Positioning: "every credit passport can be forged by a new wallet; ours cannot, the nullifier is the human." Depth of Attestcoin use is the core scoring criterion (see `docs/ATTESTCOIN_INTEGRATION.md`).
- Demo uses the staging tree + simulator so judges can reproduce; production Orb path is wired (`NEXT_PUBLIC_WORLD_ENV=production`) but needs an Orb-verified user.
- Cloud verify endpoint is never a gate; on-chain `HumanRegistry.register` is the verification.

## Next steps — specific, actionable
1. Confirm Vercel Authentication is off for the project (see above), then decide the custom domain. Recommended: `humanline.credit` ($11.99/yr on Vercel). Point it at the project, set `NEXT_PUBLIC_SITE_URL`, and re-run the `{{LIVE_URL}}` fill.
2. Scoped re-review of the web fix commit against `.superpowers/sdd/PLAN/task-4-review.md`, then ledger `Task 4: complete`.
3. Run the 7-judge simulation from the hackathon skill against the live deployment; fix Critical/Important; repeat to 9+.
4. Seed a non-zero credit position (`web/scripts/e2e-credit.ts`) so the landing counters read well at judging time.
5. Collect from Raj: team block, whether he has an Orb-verified World ID, then he records the 3-minute video from `docs/VIDEO_SCRIPT.md`; fill `{{VIDEO_URL}}` and `{{LOGO_URL}}`; rebuild deck counters; submit on DoraHacks per `docs/SUBMISSION.md` before 2026-09-13 23:59 ET.
