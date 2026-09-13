/**
 * The hand-written ABIs in `lib/abi.ts` must match the compiled artifacts.
 *
 * `lib/abi.ts` is written by hand as viem `as const` tuples so argument and
 * return types are inferred end to end — a JSON import cannot do that. The cost
 * of that choice is that the two can drift, and a drifted ABI does not fail the
 * build: it fails at demo time, as a revert with no reason.
 *
 * So: `scripts/sync-artifacts.ts` snapshots `contracts/abi/*.json` into
 * `lib/generated/abi.json`, and this test asserts that every function, event and
 * error we declare exists in the artifact with the identical signature.
 *
 * The test is skipped — loudly — when the artifacts have not been built yet, so
 * a fresh checkout is not blocked on the contracts task.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  attestedWorldIdAbi,
  creditHistoryAbi,
  creditLineAbi,
  ethRepayAbi,
  humanLinksAbi,
  humanGateAbi,
  humanRegistryAbi,
  husdAbi,
  relayRewardAbi,
} from "@/lib/abi";
import artifacts from "@/lib/generated/abi.json";
import { NEGATIVE_PATHS, NEGATIVE_PATH_FILTER } from "@/lib/negative-paths";

type AbiParam = { type: string; components?: AbiParam[] };
type AbiEntry = {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
};

/** `foo(uint256,(bytes32,bool)[])` — the canonical selector-defining form. */
function paramType(param: AbiParam): string {
  if (!param.type.startsWith("tuple")) return param.type;
  const inner = (param.components ?? []).map(paramType).join(",");
  return `(${inner})${param.type.slice("tuple".length)}`;
}

function signatureOf(entry: AbiEntry): string {
  return `${entry.name ?? ""}(${(entry.inputs ?? []).map(paramType).join(",")})`;
}

function outputsOf(entry: AbiEntry): string {
  return (entry.outputs ?? []).map(paramType).join(",");
}

const ARTIFACTS = artifacts as Record<string, AbiEntry[] | undefined>;
const hasArtifacts = Object.keys(ARTIFACTS).length > 0;

const PAIRS: Array<{ artifact: string; ours: readonly unknown[] }> = [
  { artifact: "AttestedWorldID", ours: attestedWorldIdAbi },
  { artifact: "HumanRegistry", ours: humanRegistryAbi },
  { artifact: "RelayReward", ours: relayRewardAbi },
  { artifact: "CreditLine", ours: creditLineAbi },
  { artifact: "HUSD", ours: husdAbi },
  { artifact: "HumanGate", ours: humanGateAbi },
  { artifact: "HumanLinks", ours: humanLinksAbi },
  { artifact: "CreditHistory", ours: creditHistoryAbi },
  { artifact: "EthRepay", ours: ethRepayAbi },
];

describe("hand-written ABIs match the compiled artifacts", () => {
  test("artifacts are present", () => {
    // Not an assertion about the web app — a reminder that this whole file is
    // inert until `contracts/abi/*.json` exists and `bun run sync` has run.
    if (!hasArtifacts) {
      console.warn(
        "[abi.test] contracts/abi/*.json not snapshotted — run `bun run sync` after building the contracts.",
      );
    }
    expect(typeof hasArtifacts).toBe("boolean");
  });

  for (const pair of PAIRS) {
    describe(pair.artifact, () => {
      const artifact = ARTIFACTS[pair.artifact];
      const ours = pair.ours as AbiEntry[];

      test.skipIf(!artifact)("every function we declare exists with the same signature", () => {
        const theirs = new Map(
          artifact!.filter((e) => e.type === "function").map((e) => [signatureOf(e), e]),
        );

        for (const entry of ours.filter((e) => e.type === "function")) {
          const signature = signatureOf(entry);
          const match = theirs.get(signature);
          expect(match, `${pair.artifact}.${signature} is missing from the artifact`).toBeDefined();
          expect(outputsOf(match!), `${pair.artifact}.${signature} return types differ`).toBe(
            outputsOf(entry),
          );
        }
      });

      test.skipIf(!artifact)("every event we declare exists with the same signature", () => {
        const theirs = new Set(
          artifact!.filter((e) => e.type === "event").map((e) => signatureOf(e)),
        );
        for (const entry of ours.filter((e) => e.type === "event")) {
          expect(
            theirs.has(signatureOf(entry)),
            `event ${pair.artifact}.${signatureOf(entry)} is missing from the artifact`,
          ).toBe(true);
        }
      });

      test.skipIf(!artifact)("indexed flags agree, because topics depend on them", () => {
        const theirs = new Map(
          artifact!.filter((e) => e.type === "event").map((e) => [signatureOf(e), e]),
        );
        for (const entry of ours.filter((e) => e.type === "event")) {
          const match = theirs.get(signatureOf(entry));
          if (!match) continue;
          const mine = (entry.inputs ?? []).map((i) => Boolean((i as { indexed?: boolean }).indexed));
          const yours = (match.inputs ?? []).map((i) => Boolean((i as { indexed?: boolean }).indexed));
          expect(mine, `event ${pair.artifact}.${signatureOf(entry)} indexed flags differ`).toEqual(
            yours,
          );
        }
      });

      test.skipIf(!artifact)("every custom error we declare exists", () => {
        const theirs = new Set(
          artifact!.filter((e) => e.type === "error").map((e) => signatureOf(e)),
        );
        for (const entry of ours.filter((e) => e.type === "error")) {
          expect(
            theirs.has(signatureOf(entry)),
            `error ${pair.artifact}.${signatureOf(entry)} is missing from the artifact`,
          ).toBe(true);
        }
      });
    });
  }
});

/**
 * `/judge` advertises a named custom error next to each attack in the security
 * model. Advertising an error the contracts do not raise would be worse than
 * saying nothing, so every one of them is checked against the artifact.
 */
describe("the /judge negative-path table names real custom errors", () => {
  for (const path of NEGATIVE_PATHS) {
    const artifact = ARTIFACTS[path.suite];
    test.skipIf(!artifact || !path.error)(`${path.suite}: ${path.error ?? path.threat}`, () => {
      const declared = new Set(
        artifact!.filter((e) => e.type === "error").map((e) => signatureOf(e)),
      );
      expect(
        declared.has(path.error!),
        `${path.suite} does not declare ${path.error} (listed for "${path.threat}")`,
      ).toBe(true);
    });
  }
});

/**
 * The `test` column on `/judge` must name Foundry tests that actually exist.
 *
 * The first version of this table used a plausible-looking `test_RevertWhen_*`
 * convention that the suite does not use — 26 invented names on the one page
 * whose premise is "check it yourself", plus a `--match-test` filter that
 * matched nothing. This reads the Solidity sources directly (no snapshot to go
 * stale) and fails if any advertised name is missing, or if the filter the page
 * prints would not select it.
 */
describe("the /judge negative-path table names real Foundry tests", () => {
  const testDir = join(import.meta.dir, "..", "..", "contracts", "test");
  const available = new Map<string, Set<string>>();

  if (existsSync(testDir)) {
    for (const file of readdirSync(testDir)) {
      if (!file.endsWith(".t.sol")) continue;
      const source = readFileSync(join(testDir, file), "utf8");
      const names = new Set(
        [...source.matchAll(/function\s+(test[A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]),
      );
      available.set(file.replace(/\.t\.sol$/, ""), names);
    }
  }

  const haveSources = available.size > 0;
  const filter = new RegExp(NEGATIVE_PATH_FILTER);

  test("the Foundry sources are readable", () => {
    if (!haveSources) {
      console.warn(`[abi.test] no contracts/test/*.t.sol found at ${testDir}`);
    }
    expect(haveSources).toBe(true);
  });

  for (const path of NEGATIVE_PATHS) {
    test.skipIf(!haveSources)(`${path.suite}.t.sol :: ${path.test}`, () => {
      const names = available.get(path.suite);
      expect(names, `no ${path.suite}.t.sol among ${[...available.keys()].join(", ")}`).toBeDefined();
      expect(
        names!.has(path.test),
        `${path.suite}.t.sol does not define ${path.test} (listed for "${path.threat}")`,
      ).toBe(true);
    });
  }

  test.skipIf(!haveSources)("the printed --match-test filter selects every listed test", () => {
    for (const path of NEGATIVE_PATHS) {
      expect(
        filter.test(path.test),
        `--match-test "${NEGATIVE_PATH_FILTER}" would not select ${path.test}`,
      ).toBe(true);
    }
  });

  test.skipIf(!haveSources)("the filter does not select happy-path tests", () => {
    // A filter that matched everything would be useless as a "negative paths"
    // command. Spot-check the suite's clearly-positive tests.
    for (const positive of [
      "test_RelaysTheRealMainnetRoot",
      "test_FullLifecycleRepaidOnTimeRaisesTheLimit",
      "test_FaucetMintsOneHundred",
    ]) {
      expect(filter.test(positive), `${positive} should not match the filter`).toBe(false);
    }
  });
});
