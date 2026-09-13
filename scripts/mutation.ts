#!/usr/bin/env bun
/**
 * Mutation testing for the contracts' guards.
 *
 *   bun run scripts/mutation.ts [--files CreditLine,HumanLinks] [--limit N] [--jobs 4] [--out evidence/mutation.json]
 *
 * Gambit and vertigo are not packaged for this toolchain, so this is a scripted harness with two
 * operators applied to every one-line guard `if (<condition>) revert <Error>(...);` in `src/`:
 *
 *   delete-guard   the whole statement removed (does any test notice the check is gone?)
 *   flip-relation  the first relational operator in the condition flipped: < <=, > >=, == !=
 *
 * Each mutant is compiled and run against the unit and fuzz suites (fork and invariant suites are
 * excluded for speed) in a scratch copy of `contracts/`, so the working tree is never touched.
 * `--jobs` scratch copies run mutants in parallel. A mutant that fails to compile is "stillborn"
 * and excluded from the score. Survivors are listed with file, line and the exact edit.
 *
 * With `--files`, results for the other files are carried over from the existing `--out` report,
 * so a targeted re-run after adding tests keeps the whole-repo score current.
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const JOBS = Math.max(1, Number(opt("jobs") ?? 4));
const ONLY = opt("files")?.split(",").map((s) => s.trim());
const TEST_ARGS = ["test", "--no-match-contract", "Invariant|Fork", "--fail-fast", "-q"];

type Operator = "delete-guard" | "flip-relation";
type Mutant = { file: string; line: number; operator: Operator; original: string; mutated: string };
type Status = "killed" | "survived" | "stillborn";
type Outcome = Mutant & { status: Status; ms: number };

const GUARD = /^(\s*)if \((.+)\) revert [A-Za-z_]\w*\(.*\);\s*$/;
const FLIPS: Array<[RegExp, string]> = [
  [/ <= /, " < "],
  [/ >= /, " > "],
  [/ < /, " <= "],
  [/ > /, " >= "],
  [/ == /, " != "],
  [/ != /, " == "],
];

export function mutantsOfSource(file: string, source: string): Mutant[] {
  const out: Mutant[] = [];
  source.split("\n").forEach((text, i) => {
    const m = GUARD.exec(text);
    if (!m) return;
    out.push({ file, line: i + 1, operator: "delete-guard", original: text.trim(), mutated: `${m[1]}// mutant: guard removed` });
    const condition = m[2]!;
    for (const [re, to] of FLIPS) {
      if (re.test(condition)) {
        out.push({
          file,
          line: i + 1,
          operator: "flip-relation",
          original: text.trim(),
          mutated: text.replace(condition, condition.replace(re, to)),
        });
        break;
      }
    }
  });
  return out;
}

function scratchCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "humanline-mutation-"));
  const c = join(dir, "contracts");
  mkdirSync(c, { recursive: true });
  for (const entry of ["src", "test", "script", "vendor", "foundry.toml", "package.json"]) {
    const from = join(CONTRACTS, entry);
    if (existsSync(from)) cpSync(from, join(c, entry), { recursive: true });
  }
  for (const link of ["node_modules", "lib"]) symlinkSync(join(CONTRACTS, link), join(c, link));
  return c;
}

function forgeTest(cwd: string): Promise<{ code: number; stillborn: boolean; ms: number }> {
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(FORGE, TEST_ARGS, { cwd, env: { ...process.env, FOUNDRY_FUZZ_RUNS: "64" } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, stillborn: /Compiler run failed|Error \(\d+\)/.test(output), ms: Date.now() - t0 });
    });
  });
}

const allFiles = readdirSync(join(CONTRACTS, "src")).filter((f) => f.endsWith(".sol"));
const files = allFiles.filter((f) => !ONLY || ONLY.includes(f.replace(/\.sol$/, "")));
const mutants = files.flatMap((f) => mutantsOfSource(f, readFileSync(join(CONTRACTS, "src", f), "utf8"))).slice(0, LIMIT);

// With --files, keep the other files' outcomes from the previous report.
let carried: Outcome[] = [];
if (ONLY && existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, "utf8")) as { outcomes?: Outcome[] };
  carried = (prev.outcomes ?? []).filter((o) => !files.includes(o.file));
}

const outcomes: Outcome[] = [];
const write = () => {
  const everything = [...carried, ...outcomes].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const scored = everything.filter((o) => o.status !== "stillborn");
  const killed = scored.filter((o) => o.status === "killed").length;
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tool: "scripts/mutation.ts (delete-guard, flip-relation)",
        suites: `forge ${TEST_ARGS.join(" ")} (FOUNDRY_FUZZ_RUNS=64)`,
        total: carried.length + mutants.length,
        evaluated: everything.length,
        killed,
        survived: scored.length - killed,
        stillborn: everything.length - scored.length,
        score: scored.length === 0 ? null : Number((killed / scored.length).toFixed(4)),
        survivors: everything.filter((o) => o.status === "survived"),
        byFile: Object.fromEntries(
          allFiles.map((f) => {
            const mine = scored.filter((o) => o.file === f);
            return [f, { mutants: mine.length, killed: mine.filter((o) => o.status === "killed").length }];
          }),
        ),
        outcomes: everything,
      },
      null,
      2,
    )}\n`,
  );
};

async function main() {
  const workers = Array.from({ length: Math.min(JOBS, mutants.length) }, scratchCopy);
  console.log(`${mutants.length} mutants over ${files.length} files; ${workers.length} workers`);

  const baseline = await forgeTest(workers[0]!);
  if (baseline.code !== 0) {
    console.error("baseline test run fails; fix the suite before mutating");
    process.exit(2);
  }
  console.log(`baseline green in ${Math.round(baseline.ms / 1000)}s`);
  // Warm every other worker's build cache so the first mutant in each is not a full compile.
  await Promise.all(workers.slice(1).map((w) => forgeTest(w)));

  let next = 0;
  await Promise.all(
    workers.map(async (work) => {
      while (next < mutants.length) {
        const n = next++;
        const mutant = mutants[n]!;
        const path = join(work, "src", mutant.file);
        const source = readFileSync(path, "utf8");
        const lines = source.split("\n");
        lines[mutant.line - 1] = mutant.mutated;
        writeFileSync(path, lines.join("\n"));
        const result = await forgeTest(work);
        writeFileSync(path, source);
        const status: Status = result.stillborn ? "stillborn" : result.code === 0 ? "survived" : "killed";
        outcomes.push({ ...mutant, status, ms: result.ms });
        console.log(`[${outcomes.length}/${mutants.length}] ${status.padEnd(9)} ${mutant.file}:${mutant.line} ${mutant.operator}  ${mutant.original}`);
        write();
      }
    }),
  );

  write();
  for (const w of workers) rmSync(resolve(w, ".."), { recursive: true, force: true });
  const final = JSON.parse(readFileSync(OUT, "utf8")) as { score: number; killed: number; survived: number };
  console.log(`\nmutation score ${(final.score * 100).toFixed(1)}% (${final.killed} killed, ${final.survived} survived) -> ${OUT}`);
}

if (import.meta.main) await main();
