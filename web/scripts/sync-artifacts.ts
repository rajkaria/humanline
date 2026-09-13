#!/usr/bin/env bun
/**
 * Copy repo-root build artifacts into the web bundle before `next build`.
 *
 * `deployments/cc3-testnet.json` and `evidence/relay-log.jsonl` are produced by
 * the deploy and relay tasks, which may not have run yet — and on Vercel the
 * build root may not even contain them. So instead of importing across the repo
 * boundary (which hard-fails the build when a file is absent) we snapshot them
 * into `web/lib/generated/*.json`, which always exist and are committed with
 * empty defaults.
 *
 * Run automatically by `bun run dev`, `bun run build` and `bun run test`; safe to
 * run any time. `--check` regenerates into memory and exits non-zero if the
 * committed snapshots differ, so a stale snapshot — which would silently point
 * the app at dead contracts — is a build failure rather than a demo failure.
 * `test/generated.test.ts` asserts the same thing inside `bun test`.
 */

import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const outDir = join(webRoot, "lib", "generated");

const checkOnly = process.argv.includes("--check");
const stale: string[] = [];

mkdirSync(outDir, { recursive: true });

function write(name: string, value: unknown) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const path = join(outDir, name);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === next) return;
  if (checkOnly) {
    stale.push(name);
    return;
  }
  writeFileSync(path, next, "utf8");
}

// ---------------------------------------------------------------- deployments
const deploymentsPath = join(repoRoot, "deployments", "cc3-testnet.json");
if (existsSync(deploymentsPath)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(deploymentsPath, "utf8"));
    write("deployments.json", parsed);
    console.log(`[sync-artifacts] deployments  ← ${deploymentsPath}`);
  } catch (error) {
    console.warn(
      `[sync-artifacts] deployments file is not valid JSON, keeping previous snapshot: ${String(error)}`,
    );
  }
} else {
  if (!existsSync(join(outDir, "deployments.json"))) write("deployments.json", {});
  console.log("[sync-artifacts] deployments  — not found, using empty snapshot");
}

// The production-path deployment: the same contracts verifying against the Ethereum
// mainnet (Orb) AttestedWorldID instance instead of the Sepolia staging one. `/app`
// lets a real Orb-verified human switch to it; see `lib/profiles.ts`.
const productionDeploymentsPath = join(repoRoot, "deployments", "cc3-testnet.production.json");
if (existsSync(productionDeploymentsPath)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(productionDeploymentsPath, "utf8"));
    write("deployments.production.json", parsed);
    console.log(`[sync-artifacts] deployments(prod) ← ${productionDeploymentsPath}`);
  } catch (error) {
    console.warn(
      `[sync-artifacts] production deployments file is not valid JSON, keeping previous snapshot: ${String(error)}`,
    );
  }
} else {
  if (!existsSync(join(outDir, "deployments.production.json"))) {
    write("deployments.production.json", {});
  }
  console.log("[sync-artifacts] deployments(prod) — not found, using empty snapshot");
}

// ----------------------------------------------------------------------- ABIs
// `lib/abi.ts` is hand-written so viem can infer argument and return types end to
// end. The compiled artifacts are snapshotted alongside it purely so
// `test/abi.test.ts` can prove the two agree — a drift between them is a real bug
// and should fail `bun test`, not surface as a mystery revert during a demo.
const abiDir = join(repoRoot, "contracts", "abi");
const abis: Record<string, unknown> = {};
if (existsSync(abiDir)) {
  for (const file of readdirSync(abiDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      abis[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(abiDir, file), "utf8"));
    } catch (error) {
      console.warn(`[sync-artifacts] abi/${file} is not valid JSON: ${String(error)}`);
    }
  }
  console.log(`[sync-artifacts] abi          ← ${abiDir} (${Object.keys(abis).length} files)`);
} else {
  console.log("[sync-artifacts] abi          — not found, using empty snapshot");
}
if (Object.keys(abis).length > 0 || !existsSync(join(outDir, "abi.json"))) {
  write("abi.json", abis);
}

// ------------------------------------------------------------------ documents
// `/docs` renders the Attestcoin integration write-up. It is authored in the
// repo, not here, so snapshot whatever exists at build time.
const DOCS: Array<{ file: string; key: string }> = [
  { file: "ATTESTCOIN_INTEGRATION.md", key: "attestcoinIntegration" },
];

const docs: Record<string, string> = {};
for (const doc of DOCS) {
  const docPath = join(repoRoot, "docs", doc.file);
  if (existsSync(docPath)) {
    docs[doc.key] = readFileSync(docPath, "utf8");
    console.log(`[sync-artifacts] docs/${doc.file} ← ${docPath}`);
  } else {
    console.log(`[sync-artifacts] docs/${doc.file} — not found`);
  }
}
write("docs.json", docs);

// -------------------------------------------------------------- e2e evidence
// The live proof-of-personhood and credit-loop runs. `/judge` renders these as
// "this actually happened", with explorer links, so they must travel with the
// build the same way the relay log does.
const E2E: Array<{ file: string; key: string; json?: boolean }> = [
  { file: "e2e-worldid-staging.md", key: "worldIdStaging" },
  { file: "e2e-worldid-staging-result.json", key: "worldIdStagingResult", json: true },
  { file: "e2e-credit-loop.log", key: "creditLoop" },
  { file: "seed-demo.jsonl", key: "seedDemo" },
];

const e2e: Record<string, unknown> = {};
for (const entry of E2E) {
  const path = join(repoRoot, "evidence", entry.file);
  if (!existsSync(path)) {
    console.log(`[sync-artifacts] e2e/${entry.file} — not found`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  if (entry.json) {
    try {
      e2e[entry.key] = JSON.parse(text);
    } catch (error) {
      console.warn(`[sync-artifacts] e2e/${entry.file} is not valid JSON: ${String(error)}`);
      continue;
    }
  } else {
    e2e[entry.key] = text;
  }
  console.log(`[sync-artifacts] e2e/${entry.file} ← ${path}`);
}
write("e2e.json", e2e);

// ------------------------------------------------------------------- evidence
const evidencePath = join(repoRoot, "evidence", "relay-log.jsonl");
if (existsSync(evidencePath)) {
  const entries = readFileSync(evidencePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  write("evidence.json", entries);
  console.log(`[sync-artifacts] evidence     ← ${evidencePath} (${entries.length} entries)`);
} else {
  if (!existsSync(join(outDir, "evidence.json"))) write("evidence.json", []);
  console.log("[sync-artifacts] evidence     — not found, using empty snapshot");
}

// ------------------------------------------------------------- self-relay wallets
// `web/scripts/self-relay.ts --fresh` relays from wallets it generates on the spot. They
// are Humanline's own test wallets, not strangers, so `/relay` must not count their roots
// as carried by "wallets that are not Humanline's".
const selfRelayPath = join(repoRoot, "evidence", "self-relay.jsonl");
const selfRelayers = existsSync(selfRelayPath)
  ? [
      ...new Set(
        readFileSync(selfRelayPath, "utf8")
          .split("\n")
          .flatMap((line) => {
            try {
              const relayer = (JSON.parse(line) as { relayer?: unknown }).relayer;
              return typeof relayer === "string" && /^0x[0-9a-fA-F]{40}$/.test(relayer) ? [relayer.toLowerCase()] : [];
            } catch {
              return [];
            }
          }),
      ),
    ].sort()
  : [];
write("self-relayers.json", selfRelayers);
console.log(`[sync-artifacts] self-relay   ← ${selfRelayPath} (${selfRelayers.length} wallets)`);

// ---------------------------------------------------------------- live attacks
// `/judge` re-fires the recorded attacks on page load; it needs the inputs (real proofs) and shows
// the last recorded run as the fallback when CC3 is unreachable.
const attacks: Record<string, unknown> = {};
for (const [key, file] of [
  ["inputs", "attack-inputs.json"],
  ["recorded", "attacks.json"],
] as const) {
  const path = join(repoRoot, "evidence", file);
  if (!existsSync(path)) continue;
  try {
    attacks[key] = JSON.parse(readFileSync(path, "utf8"));
    console.log(`[sync-artifacts] attacks/${file} ← ${path}`);
  } catch (error) {
    console.warn(`[sync-artifacts] evidence/${file} is not valid JSON: ${String(error)}`);
  }
}
write("attacks.json", attacks);

// ---------------------------------------------------------------- measurements
// `/judge` shows the headline numbers; the per-transaction records and latency series stay in the
// evidence file (they only grow), so the bundle carries the summaries.
const measurementsPath = join(repoRoot, "evidence", "measurements.json");
if (existsSync(measurementsPath)) {
  try {
    const { relayTxs, latency, ...rest } = JSON.parse(readFileSync(measurementsPath, "utf8")) as {
      relayTxs?: unknown[];
      latency?: { series?: unknown[] } & Record<string, unknown>;
    } & Record<string, unknown>;
    write("measurements.json", {
      ...rest,
      relayTxCount: relayTxs?.length ?? 0,
      latency: latency ? { ...latency, series: undefined } : undefined,
    });
    console.log(`[sync-artifacts] measurements ← ${measurementsPath}`);
  } catch (error) {
    console.warn(`[sync-artifacts] evidence/measurements.json is not valid JSON: ${String(error)}`);
  }
} else if (!existsSync(join(outDir, "measurements.json"))) {
  write("measurements.json", {});
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(
      `[sync-artifacts] STALE: ${stale.join(", ")} — run \`bun run sync\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log("[sync-artifacts] snapshots are up to date");
}
