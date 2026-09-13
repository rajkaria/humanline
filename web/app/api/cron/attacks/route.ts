import { NextResponse } from "next/server";

import { runAttacks, type AttackInputs } from "@/lib/attacks/core";
import { creditcoinTestnet } from "@/lib/chains";
import generated from "@/lib/generated/attacks.json";
import { isAuthorizedCron } from "@/lib/relay/cron";

/**
 * The standing proof that the deployed guards still hold: Vercel Cron calls this every six hours
 * (`web/vercel.json`) and fires the twelve named attacks at CC3 testnet as read-only `eth_call`s,
 * the same run `/judge` does on page load and `bun run worker/src/cli.ts attack` does locally.
 *
 * GitHub's `schedule` for `.github/workflows/attacks.yml` did not fire reliably, so the schedule
 * lives here; the workflow keeps its push and manual triggers. When any attack is not refused with
 * its expected named revert, the run posts to `RELAY_ALERT_WEBHOOK` and answers 500, which Vercel
 * records as a failed cron invocation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const data = generated as unknown as { inputs?: AttackInputs };

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!data.inputs) {
    return NextResponse.json({ error: "no_attack_inputs" }, { status: 500 });
  }

  const started = Date.now();
  const run = await runAttacks(data.inputs, { rpcUrl: creditcoinTestnet.rpcUrls.default.http[0], timeoutMs: 30_000 });
  const failed = run.results.filter((r) => r.outcome !== "refused");
  const body = {
    at: new Date().toISOString(),
    attestedTip: run.attestedTip,
    attestors: run.attestors,
    refused: run.results.length - failed.length,
    total: run.results.length,
    failed: failed.map((r) => ({ title: r.title, outcome: r.outcome, error: r.error })),
    ms: Date.now() - started,
  };

  const webhook = process.env.RELAY_ALERT_WEBHOOK;
  if (failed.length > 0 && webhook) {
    const text = `Humanline live attacks: ${body.refused}/${body.total} refused. Not refused: ${failed.map((f) => f.title).join(", ")}. https://humanline.credit/judge`;
    const ntfy = new URL(webhook).hostname === "ntfy.sh";
    await fetch(webhook, {
      method: "POST",
      headers: ntfy
        ? { "content-type": "text/plain", title: "Humanline attacks", tags: "rotating_light" }
        : { "content-type": "application/json" },
      body: ntfy ? text : JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  console.log(`[cron/attacks] ${JSON.stringify(body)}`);
  return NextResponse.json(body, { status: failed.length > 0 ? 500 : 200, headers: { "cache-control": "no-store" } });
}
