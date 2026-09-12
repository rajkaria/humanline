# Humanline — web

The Humanline front end: landing page, borrower + lender app, live Attestcoin relay
feed, judge reproducibility page, and integrator docs.

Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · wagmi v2 + viem ·
`@worldcoin/idkit` 4.x. Dark theme, Inter for UI and JetBrains Mono for anything
that is a hash.

---

## Quick start

`node` is blocked as a bare command in this repo — use `bun` for everything.

```bash
cd web
cp .env.example .env.local     # then paste WORLD_RP_SIGNER_PRIVATE_KEY from ../.secrets.env
bun install                    # or `bun install` from the repo root; web is a workspace member
bun run dev                    # http://localhost:3000
```

```bash
bun run build      # production build — must pass with zero type errors
bun run lint       # eslint
bun run typecheck  # tsc --noEmit
bun test           # unit tests for lib/worldid.ts and lib/format.ts
```

`dev` and `build` both run `scripts/sync-artifacts.ts` first. See
[Build-time artifacts](#build-time-artifacts).

---

## Routes

| Route | What it is |
|---|---|
| `/` | Landing page. The positioning, the "wallet passports vs Humanline" comparison, the architecture diagram as inline SVG, and four live counters read from CC3. |
| `/app` | Connect → status card → World ID verification → credit line (borrow, repay, faucet, history) → lender pool (deposit, withdraw, utilisation). |
| `/relay` | Live `RootRelayed` feed across both `AttestedWorldID` instances, header cards per instance, and the 0x0FD3 / 0x0FD4 precompile guard values. Refreshes every 15s. |
| `/judge` | Addresses, copy-paste verification commands, the negative-path table, a live "prove any Ethereum transaction" widget, and the relay evidence log. Works with no wallet. |
| `/docs` | Lender integration guide, the Attestcoin integration write-up, the security model, and the known limitations. |
| `/api/world/rp-context` | Signs an IDKit 4.x proof request server-side. |
| `/api/attestcoin/proof` | Proxies the CC3 proof builder (it sends no CORS headers). |
| `/api/attestcoin/attested-height` | Proxies the proof builder's attested-height endpoint. |

---

## World ID

IDKit 4.x requires every proof request to carry an `rp_context`: a nonce and
timestamp pair signed by the relying party's key. That key is a secret, so the
signing happens in `app/api/world/rp-context/route.ts` and only the signature
reaches the browser.

The widget is configured as documented at
<https://docs.world.org/world-id/idkit/integrate>:

```tsx
<IDKitRequestWidget
  app_id={WORLD_APP_ID}                       // app_87b24915fcf733f10df1b0c46dd1f783
  action={WORLD_ACTION}                       // humanline-register
  rp_context={rpContext}                      // signed by /api/world/rp-context
  allow_legacy_proofs                         // accept World ID 3.0 proofs
  environment={WORLD_ENV}                     // "staging" by default
  preset={orbLegacy({ signal: address })}     // 3.0 Semaphore proof, signal = wallet
  onSuccess={handleResult}
/>
```

`allow_legacy_proofs` plus the `orbLegacy` preset is what makes the widget return a
World ID **3.0** response — `merkle_root`, `nullifier` and `proof` as an
ABI-encoded `uint256[8]` — which is exactly what the on-chain Groth16 verifier on
Creditcoin consumes. `lib/worldid.ts` decodes `proof` with viem's
`decodeAbiParameters` and calls `HumanRegistry.register(root, nullifierHash, proof)`.

The proof is **not** sent to World's cloud verify endpoint to decide anything.
`register` on Creditcoin is the verification. If a 4.0-only credential comes back,
the card says so plainly instead of failing silently.

`signal` is the connected wallet address, so the proof's `signalHash` equals the
registry's `hashToField(abi.encodePacked(msg.sender))` and the proof cannot be
replayed from another wallet. `test/worldid.test.ts` asserts our `hashSignalAddress`
matches IDKit's own `hashSignal` for the same address.

**Testing on staging:** set `NEXT_PUBLIC_WORLD_ENV=staging` and scan the QR code
with the [World ID Simulator](https://simulator.worldcoin.org) rather than World
App.

---

## Contract addresses

Resolution order, per contract, in `lib/contracts.ts`:

1. `deployments/cc3-testnet.json` at the repo root, snapshotted into the build.
2. `NEXT_PUBLIC_*_ADDRESS` environment variables (see `.env.example`).
3. Nothing — the view renders a "Not deployed yet" banner naming the environment
   variable it wants.

The build never fails and no page crashes when the deployments file is missing.
The parser accepts a flat `{ Name: "0x…" }` map, a nested `{ contracts: { … } }`,
or `{ Name: { address, block } }` entries, matched case- and
separator-insensitively — the deploy script and this app are written by different
tasks, and this is the cheap way to make them agree.

ABIs are hand-written from the `Interfaces` section of `docs/PLAN.md` in
`lib/abi.ts` as viem `as const` tuples, so argument and return types are inferred
end to end. When `contracts/abi/*.json` lands, those artifacts and this file must
agree; a mismatch is a bug in one of them.

---

## Build-time artifacts

`scripts/sync-artifacts.ts` snapshots repo files into `lib/generated/` before every
`dev` and `build`:

| Source | Snapshot | Used by |
|---|---|---|
| `deployments/cc3-testnet.json` | `lib/generated/deployments.json` | contract addresses everywhere |
| `evidence/relay-log.jsonl` | `lib/generated/evidence.json` | `/judge` evidence table, and source tx hashes on `/relay` |
| `docs/ATTESTCOIN_INTEGRATION.md` | `lib/generated/docs.json` | `/docs`, rendered as React elements |

Each snapshot is committed with an empty default, so importing it is always safe.
Importing the repo files directly would hard-fail the build whenever a sibling task
had not run yet — and on Vercel, where the build root may be `web/`, they may not
be present at all.

Markdown is rendered by `lib/markdown.ts` + `components/markdown.tsx`, a small
parser for the subset we author. It emits a node tree that React renders as
elements; there is no `dangerouslySetInnerHTML` anywhere in this app.

---

## Layout

```
app/
  page.tsx                     landing
  app/                         borrower + lender app (app-client.tsx is the client half)
  relay/                       Attestcoin relay feed
  judge/                       reproducibility page (server-rendered, dynamic)
  docs/                        integration guide + security model
  api/world/rp-context/        signs IDKit proof requests (server only)
  api/attestcoin/              proof builder proxies
  error.tsx global-error.tsx not-found.tsx loading.tsx
components/
  ui/                          shadcn/ui primitives
  verify-card.tsx              IDKit widget + register transaction
  credit-panel.tsx             borrow / repay / faucet
  lender-panel.tsx             deposit / withdraw / utilisation
  prove-it-widget.tsx          prove any Ethereum tx via 0x0FD2, no wallet
  hash-link.tsx                every hash on the site: truncated, copyable, linked
  error-boundary.tsx           per-panel boundaries
lib/
  abi.ts chains.ts contracts.ts worldid.ts format.ts logs.ts evidence.ts
  hooks/                       use-human, use-credit-line, use-relay-feed, use-tx, …
test/                          bun test
```

### Conventions

- **Every hash, address and root** renders through `<HashLink>`: monospace,
  truncated, with a copy button and a link to the right explorer — Blockscout for
  Creditcoin, Etherscan for Ethereum, Sepolia Etherscan for staging.
- **Every write** goes through `useTx`, so signing, pending and confirmation
  feedback is identical everywhere and every toast carries the Blockscout link.
- **Every data view** has a skeleton and an error boundary. A value we could not
  read shows an em dash, never a zero.
- **Unavailable data is stated, not faked.** No placeholder addresses, no sample
  rows, no lorem ipsum.

---

## Tests

`bun test` covers the two pure modules where a silent bug would be expensive:

- `test/worldid.test.ts` — `hashToField` is `uint256(keccak256(b)) >> 8`,
  recomputed from `@noble/hashes` independently of the implementation;
  `hashSignalAddress` hashes 20 address bytes (not a padded word, not the text of
  the address) and is cross-checked against IDKit's own `hashSignal`;
  `externalNullifierHash` packs the app-id hash as a full `uint256` word followed
  by the raw action bytes, in that order.
- `test/format.test.ts` — fixed-point formatting and parsing (truncating, never
  rounding), durations, relative and absolute timestamps, and viem error
  flattening.

---

## Deploying

Vercel, root directory `web`. Set the environment variables from `.env.example`;
`WORLD_RP_SIGNER_PRIVATE_KEY` must be a server-side secret, not a `NEXT_PUBLIC_`
one.

`outputFileTracingRoot` is pinned to the repo root in `next.config.ts` because
`web` is a bun workspace member and there are lockfiles at both levels.

### Notes for whoever wires the deployment together

- `lib/negative-paths.ts` lists each attack from `docs/SPEC.md` §9 with the custom
  error it reverts with (exact, from `docs/PLAN.md`) and the Foundry test name that
  covers it (conventional `test_RevertWhen_*`). If the contract suite names them
  differently, update that one file.
- `RootRelayed` carries the source block and Attestcoin's derived `txIndex`, not
  the source transaction hash. `/relay` links the source **block** on Etherscan and
  upgrades the cell to a direct transaction link for any row the worker recorded in
  `evidence/relay-log.jsonl`. Recording `sourceTxHash` (or `txHash`) there is what
  turns every row into a one-click Etherscan link.
