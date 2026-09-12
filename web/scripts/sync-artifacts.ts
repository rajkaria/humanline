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
 * Run automatically by `bun run dev` and `bun run build`; safe to run any time.
 */

import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const outDir = join(webRoot, "lib", "generated");

mkdirSync(outDir, { recursive: true });

function write(name: string, value: unknown) {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
