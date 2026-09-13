#!/usr/bin/env bun
/**
 * Every claim a judge can click must resolve.
 *
 *   bun run scripts/submission-check.ts [--strict] [--summary <file>]
 *
 * - Every contract in `deployments/*.json` has code on CC3 and is verified on Blockscout.
 * - Every Blockscout address link in the docs has code; every Blockscout, Etherscan and Sepolia
 *   Etherscan transaction link exists on that chain.
 * - Every `https://humanline.credit/...` URL answers below 400.
 * - `{{PLACEHOLDER}}` markers are listed (a failure with `--strict`).
 *
 * Exit code 1 when anything fails. Read-only: JSON-RPC reads, Blockscout API reads, HTTP GETs.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const summaryAt = argv.indexOf("--summary");
const SUMMARY = summaryAt >= 0 ? argv[summaryAt + 1] : undefined;

const DOCS = [
  "README.md",
  "docs/ATTESTCOIN_INTEGRATION.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY.md",
  "docs/SUBMISSION.md",
  "docs/MEASUREMENTS.md",
  "docs/VIDEO_SCRIPT.md",
  "evidence/README.md",
  "deployments/README.md",
].filter((f) => existsSync(join(ROOT, f)));
const DEPLOYMENTS = ["deployments/cc3-testnet.json", "deployments/cc3-testnet.production.json"].filter((f) =>
  existsSync(join(ROOT, f)),
);

const RPC = {
  cc3: "https://rpc.cc3-testnet.creditcoin.network",
  ethereum: "https://ethereum-rpc.publicnode.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
} as const;
type Chain = keyof typeof RPC;
const BLOCKSCOUT_API = "https://creditcoin-testnet.blockscout.com/api/v2";

type Result = { kind: string; subject: string; where: string; ok: boolean; detail: string; warn?: boolean };

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 750 * (i + 1)));
    }
  }
  throw last;
}

async function rpc<T>(chain: Chain, method: string, params: unknown[]): Promise<T> {
  return withRetry(async () => {
    const response = await fetch(RPC[chain], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  });
}

async function hasCode(address: string): Promise<boolean> {
  const code = await rpc<string>("cc3", "eth_getCode", [address, "latest"]);
  return typeof code === "string" && code.length > 2;
}

async function receiptStatus(chain: Chain, hash: string): Promise<string | null> {
  const receipt = await rpc<{ status: string } | null>(chain, "eth_getTransactionReceipt", [hash]);
  return receipt ? receipt.status : null;
}

async function isVerified(address: string): Promise<boolean> {
  return withRetry(async () => {
    const response = await fetch(`${BLOCKSCOUT_API}/smart-contracts/${address}`, { signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Blockscout HTTP ${response.status}`);
    const body = (await response.json()) as { is_verified?: boolean };
    return Boolean(body.is_verified);
  });
}

async function pageStatus(url: string): Promise<number> {
  return withRetry(async () => {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    return response.status;
  });
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length > 0) await fn(queue.shift()!);
    }),
  );
}

const tasks: Array<() => Promise<Result>> = [];
const seen = new Set<string>();
const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));

// ------------------------------------------------------------------ deployments
for (const file of DEPLOYMENTS) {
  const doc = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
    contracts?: Record<string, string>;
    txHashes?: Record<string, string>;
  };
  for (const [name, address] of Object.entries(doc.contracts ?? {})) {
    if (!once(`deploy:${address.toLowerCase()}`)) continue;
    tasks.push(async () => {
      const code = await hasCode(address);
      const verified = code ? await isVerified(address) : false;
      return {
        kind: "contract",
        subject: `${name} ${address}`,
        where: file,
        ok: code && verified,
        detail: !code ? "no code on CC3" : verified ? "code + Blockscout-verified" : "NOT verified on Blockscout",
      };
    });
  }
  for (const [name, hash] of Object.entries(doc.txHashes ?? {})) {
    if (!once(`tx:cc3:${hash.toLowerCase()}`)) continue;
    tasks.push(async () => {
      const status = await receiptStatus("cc3", hash);
      return { kind: "deploy tx", subject: `${name} ${hash}`, where: file, ok: status === "0x1", detail: status ?? "not found" };
    });
  }
}

// ------------------------------------------------------------------ docs
const placeholders: Result[] = [];
for (const file of DOCS) {
  const text = readFileSync(join(ROOT, file), "utf8");

  for (const m of text.matchAll(/creditcoin-testnet\.blockscout\.com\/address\/(0x[0-9a-fA-F]{40})/g)) {
    const address = m[1]!;
    if (!once(`addr:${address.toLowerCase()}`) || seen.has(`deploy:${address.toLowerCase()}`)) continue;
    tasks.push(async () => {
      const code = await hasCode(address);
      return { kind: "address link", subject: address, where: file, ok: code, detail: code ? "has code" : "no code on CC3" };
    });
  }

  const txLinks: Array<[Chain, RegExp]> = [
    ["cc3", /creditcoin-testnet\.blockscout\.com\/tx\/(0x[0-9a-fA-F]{64})/g],
    ["ethereum", /(?<!sepolia\.)etherscan\.io\/tx\/(0x[0-9a-fA-F]{64})/g],
    ["sepolia", /sepolia\.etherscan\.io\/tx\/(0x[0-9a-fA-F]{64})/g],
  ];
  for (const [chain, re] of txLinks) {
    for (const m of text.matchAll(re)) {
      const hash = m[1]!;
      if (!once(`tx:${chain}:${hash.toLowerCase()}`)) continue;
      tasks.push(async () => {
        const status = await receiptStatus(chain, hash);
        return { kind: `${chain} tx link`, subject: hash, where: file, ok: status !== null, detail: status ?? "not found" };
      });
    }
  }

  for (const m of text.matchAll(/https:\/\/humanline\.credit[^\s)\]>"'`|]*/g)) {
    const url = m[0]!.replace(/[.,;:]+$/, "");
    if (!once(`url:${url}`)) continue;
    tasks.push(async () => {
      const status = await pageStatus(url);
      return { kind: "page", subject: url, where: file, ok: status < 400, detail: `HTTP ${status}` };
    });
  }

  for (const m of text.matchAll(/\{\{[A-Z0-9_]+\}\}/g)) {
    placeholders.push({ kind: "placeholder", subject: m[0]!, where: file, ok: !STRICT, warn: true, detail: "unfilled" });
  }
}

// ------------------------------------------------------------------ run
const results: Result[] = [];
await pool(tasks, 6, async (task) => {
  try {
    results.push(await task());
  } catch (error) {
    results.push({ kind: "error", subject: String(error).slice(0, 120), where: "-", ok: false, detail: "check failed" });
  }
});
results.push(...placeholders);
results.sort((a, b) => Number(a.ok) - Number(b.ok) || a.kind.localeCompare(b.kind));

const failed = results.filter((r) => !r.ok);
const warned = results.filter((r) => r.ok && r.warn);
for (const r of results) {
  const mark = !r.ok ? "FAIL" : r.warn ? "WARN" : "ok  ";
  console.log(`${mark} ${r.kind.padEnd(16)} ${r.subject}  (${r.detail}; ${r.where})`);
}
console.log(`\n${results.length} checks: ${results.length - failed.length} ok, ${failed.length} failed, ${warned.length} warnings`);

if (SUMMARY) {
  const lines = [
    "### Submission check",
    "",
    `${results.length} checks: **${results.length - failed.length} ok**, **${failed.length} failed**, ${warned.length} warnings`,
    "",
    "| | Kind | Subject | Detail | Where |",
    "|---|---|---|---|---|",
    ...results.filter((r) => !r.ok || r.warn).map((r) => `| ${r.ok ? "⚠️" : "❌"} | ${r.kind} | \`${r.subject}\` | ${r.detail} | ${r.where} |`),
  ];
  appendFileSync(SUMMARY, `${lines.join("\n")}\n`);
}

process.exit(failed.length > 0 ? 1 : 0);
