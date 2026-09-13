#!/usr/bin/env bun
/**
 * Mutation testing for the contracts' guards.
 *
 *   bun run scripts/mutation.ts [--files CreditLine,HumanLinks] [--limit N] [--out evidence/mutation.json]
 *
 * Gambit and vertigo are not packaged for this toolchain, so this is a scripted harness with two
 * operators applied to every one-line guard `if (<condition>) revert <Error>(...);` in `src/`:
 *
 *   delete-guard   the whole statement removed (does any test notice the check is gone?)
 *   flip-relation  the first relational operator in the condition flipped: < <=, > >=, == !=
 *
 * Each mutant is compiled and run against the unit and fuzz suites (fork and invariant suites are
 * excluded for speed) in a scratch copy of `contracts/`, so the working tree is never touched.
 * A mutant that fails to compile is "stillborn" and excluded from the score. Survivors are listed
 * with file, line and the exact edit.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CONTRACTS = join(ROOT, "contracts");
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FORGE = process.env.FORGE ?? join(homedir(), ".foundry", "bin", "forge");
const OUT = resolve(ROOT, opt("out") ?? "evidence/mutation.json");
const LIMIT = Number(opt("limit") ?? Infinity);
const ONLY = opt("files")?.split(",").map((s) => s.trim());
const TEST_ARGS = ["test", "--no-match-contract", "Invariant|Fork", "-q"];

type Mutant = { file: string; line: number; operator: "delete-guard" | "flip-relation"; original: string; mutated: string };
type Outcome = Mutant & { status: "killed" | "survived" | "stillborn"; ms: number };

const GUARD = /^(\s*)if \((.+)\) revert [A-Za-z_]\w*\(.*\);\s*$/;
const FLIPS: Array<[RegExp, string]> = [
  [/ <= /, " < "],
  [/ >= /, " > "],
  [/ < /, " <= "],
  [/ > /, " >= "],
  [/ == /, " != "],
  [/ != /, " == "],
];

function mutantsOf(file: string): Mutant[] {
  const lines = readFileSync(join(CONTRACTS, "src", file), "utf8").split("\n");
  const out: Mutant[] = [];
  lines.forEach((text, i) => {
    const m = GUARD.exec(text);
    if (!m) return;
    out.push({ file, line: i + 1, operator: "delete-guard", original: text.trim(), mutated: `${m[1]}// mutant: guard removed` });
    const condition = m[2]!;
    for (const [re, to] of FLIPS) {
      if (re.test(condition)) {
        const flipped = text.replace(condition, condition.replace(re, to));
        out.push({ file, line: i + 1, operator: "flip-relation", original: text.trim(), mutated: flipped });
        break;
      }
    }
  });
  return out;
}

function scratchCopy(): string {
  const dir = join(tmpdir(), `humanline-mutation-${process.pid}`);
  const c = join(dir, "contracts");
  mkdirSync(c, { recursive: true });
  for (const entry of ["src", "test", "script", "vendor", "foundry.toml", "package.json"]) {
    const from = join(CONTRACTS, entry);
    if (existsSync(from)) cpSync(from, join(c, entry), { recursive: true });
  }
  for (const link of ["node_modules", "lib"]) {
    if (!existsSync(join(c, link))) symlinkSync(join(CONTRACTS, link), join(c, link));
  }
  return c;
}

function forgeTest(cwd: string): { code: number; stillborn: boolean; ms: number } {
  const t0 = Date.now();
  const run = spawnSync(FORGE, TEST_ARGS, {
    cwd,
    encoding: "utf8",
    timeout: 20 * 60_000,
    env: { ...process.env, FOUNDRY_FUZZ_RUNS: "64" },
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  return { code: run.status ?? 1, stillborn: /Compiler run failed|Error \(\d+\)/.test(output), ms: Date.now() - t0 };
}

const files = readdirSync(join(CONTRACTS, "src"))
  .filter((f) => f.endsWith(".sol"))
  .filter((f) => !ONLY || ONLY.includes(f.replace(/\.sol$/, "")));
const mutants = files.flatMap(mutantsOf).slice(0, LIMIT);
const work = scratchCopy();

console.log(`${mutants.length} mutants over ${files.length} files; scratch ${work}`);
const baseline = forgeTest(work);
if (baseline.code !== 0) {
  console.error("baseline test run fails; fix the suite before mutating");
  process.exit(2);
}
console.log(`baseline green in ${Math.round(baseline.ms / 1000)}s`);

const outcomes: Outcome[] = [];
const write = () => {
  const scored = outcomes.filter((o) => o.status !== "stillborn");
  const killed = scored.filter((o) => o.status === "killed").length;
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tool: "scripts/mutation.ts (delete-guard, flip-relation)",
        suites: `forge ${TEST_ARGS.join(" ")} (FOUNDRY_FUZZ_RUNS=64)`,
        total: mutants.length,
        evaluated: outcomes.length,
        killed,
        survived: scored.length - killed,
        stillborn: outcomes.length - scored.length,
        score: scored.length === 0 ? null : Number((killed / scored.length).toFixed(4)),
        survivors: outcomes.filter((o) => o.status === "survived"),
        byFile: Object.fromEntries(
          files.map((f) => {
            const mine = scored.filter((o) => o.file === f);
            return [f, { mutants: mine.length, killed: mine.filter((o) => o.status === "killed").length }];
          }),
        ),
      },
      null,
      2,
    )}\n`,
  );
};

for (const [n, mutant] of mutants.entries()) {
  const path = join(work, "src", mutant.file);
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  lines[mutant.line - 1] = mutant.mutated;
  writeFileSync(path, lines.join("\n"));
  const result = forgeTest(work);
  writeFileSync(path, source);
  const status = result.stillborn ? "stillborn" : result.code === 0 ? "survived" : "killed";
  outcomes.push({ ...mutant, status, ms: result.ms });
  console.log(`[${n + 1}/${mutants.length}] ${status.padEnd(9)} ${mutant.file}:${mutant.line} ${mutant.operator}  ${mutant.original}`);
  write();
}

write();
const final = JSON.parse(readFileSync(OUT, "utf8")) as { score: number; killed: number; survived: number };
console.log(`\nmutation score ${(final.score * 100).toFixed(1)}% (${final.killed} killed, ${final.survived} survived) → ${OUT}`);
