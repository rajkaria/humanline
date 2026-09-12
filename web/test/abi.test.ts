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

import {
  attestedWorldIdAbi,
  creditLineAbi,
  humanGateAbi,
  humanRegistryAbi,
  husdAbi,
} from "@/lib/abi";
import artifacts from "@/lib/generated/abi.json";
import { NEGATIVE_PATHS } from "@/lib/negative-paths";

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
  { artifact: "CreditLine", ours: creditLineAbi },
  { artifact: "HUSD", ours: husdAbi },
  { artifact: "HumanGate", ours: humanGateAbi },
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
