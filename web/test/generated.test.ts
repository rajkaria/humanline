/**
 * The committed snapshots in `lib/generated/` must match the repo's own sources.
 *
 * `scripts/sync-artifacts.ts` regenerates them before every `dev`, `build` and
 * `test`, so Vercel always ships fresh ones — but the files are also committed
 * so that a clean checkout can import them, and a committed snapshot can go
 * stale. It did: after a redeploy the checked-in `deployments.json` still named
 * six dead contracts, and nothing failed. Anyone running `next start` on the
 * tree, or simply reading it, was pointed at contracts that no longer existed.
 *
 * So staleness is a failing test. `bun run sync:check` enforces the same thing
 * from CI without booting the test runner.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import abi from "@/lib/generated/abi.json";
import deployments from "@/lib/generated/deployments.json";
import { CONTRACT_LIST } from "@/lib/contracts";
import { EVIDENCE } from "@/lib/evidence";

const repoRoot = join(import.meta.dir, "..", "..");
const deploymentsPath = join(repoRoot, "deployments", "cc3-testnet.json");
const evidencePath = join(repoRoot, "evidence", "relay-log.jsonl");
const abiDir = join(repoRoot, "contracts", "abi");

describe("lib/generated/deployments.json", () => {
  const hasSource = existsSync(deploymentsPath);

  test.skipIf(!hasSource)("is byte-identical to deployments/cc3-testnet.json", () => {
    const source: unknown = JSON.parse(readFileSync(deploymentsPath, "utf8"));
    expect(
      deployments,
      "snapshot is stale — run `bun run sync` and commit lib/generated/",
    ).toEqual(source as typeof deployments);
  });

  test.skipIf(!hasSource)("resolves every contract to the deployed address", () => {
    const source = JSON.parse(readFileSync(deploymentsPath, "utf8")) as {
      contracts?: Record<string, string>;
    };
    const live = new Set(
      Object.values(source.contracts ?? {}).map((a) => a.toLowerCase()),
    );
    expect(live.size).toBeGreaterThan(0);

    for (const contract of CONTRACT_LIST) {
      expect(contract.address, `${contract.name} did not resolve`).toBeDefined();
      expect(
        live.has(contract.address!.toLowerCase()),
        `${contract.name} resolves to ${contract.address}, which is not in deployments/cc3-testnet.json`,
      ).toBe(true);
    }
  });
});

describe("lib/generated/abi.json", () => {
  const hasSource = existsSync(abiDir);

  test.skipIf(!hasSource)("carries every compiled artifact", () => {
    const names = Object.keys(abi as Record<string, unknown>);
    for (const expected of [
      "AttestedWorldID",
      "HumanRegistry",
      "CreditLine",
      "HUSD",
      "HumanGate",
    ]) {
      expect(names, `${expected} missing from the ABI snapshot`).toContain(expected);
    }
  });
});

describe("lib/generated/evidence.json", () => {
  const hasSource = existsSync(evidencePath);

  test.skipIf(!hasSource)("has one entry per line of relay-log.jsonl", () => {
    const lines = readFileSync(evidencePath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(EVIDENCE).toHaveLength(lines.length);
  });

  test.skipIf(!hasSource)("parses every entry into a linkable row", () => {
    for (const entry of EVIDENCE) {
      // Without a chainKey the row cannot pick an explorer, and without a source
      // tx hash `/relay` silently falls back to linking the block.
      expect(
        [1, 3].includes(entry.chainKey ?? -1),
        `unmapped source label in ${JSON.stringify(entry.raw)}`,
      ).toBe(true);
      expect(entry.sourceTxHash, "no source tx hash").toBeDefined();
      expect(entry.creditcoinTxHash, "no Creditcoin tx hash").toBeDefined();
      expect(entry.postRoot).toBeDefined();
      expect(entry.timestamp, "no parseable timestamp").toBeDefined();
    }
  });
});
