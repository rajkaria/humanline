import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";

import { getPublicClient } from "@/lib/public-client";
import { dispatchRequest, isAuthorizedCron, shouldAlert } from "@/lib/relay/cron";
import { relayPass } from "@/lib/relay/relay-pass";
import { relayReport } from "@/lib/relay/report";

/**
 * The always-on relay: Vercel Cron calls this every five minutes (`web/vercel.json`).
 *
 * 1. Refuses anything without `Authorization: Bearer $CRON_SECRET`.
 * 2. Runs one relay pass for both source chains with `RELAYER_PRIVATE_KEY`, using the
 *    same planner and proof path as the verify card's self-relay.
 * 3. When `GITHUB_DISPATCH_TOKEN` is set, also dispatches `relay.yml` as a second,
 *    independent relayer (GitHub's own `schedule` stays as the third).
 * 4. Rebuilds the relay report and, when the watchdog has just crossed a threshold,
 *    posts to `RELAY_ALERT_WEBHOOK` (any Slack/Discord-style incoming webhook).
 *
 * The relayer key can do nothing but pay gas: `AttestedWorldID` accepts the same
 * proof from anyone, so a compromised key costs tCTC, never correctness.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const started = Date.now();
  const result: Record<string, unknown> = { dryRun };

  const key = process.env.RELAYER_PRIVATE_KEY;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    const account = privateKeyToAccount(key as `0x${string}`);
    result.relayer = account.address;
    result.outcomes = await relayPass({ client: getPublicClient(), account, dryRun, budgetMs: 200_000 });
  } else {
    result.outcomes = [];
    result.note = "RELAYER_PRIVATE_KEY is not set; relay pass skipped";
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (token && !dryRun) {
    try {
      const { url: dispatchUrl, init } = dispatchRequest({
        token,
        repo: process.env.GITHUB_REPOSITORY ?? "rajkaria/humanline",
      });
      const response = await fetch(dispatchUrl, { ...init, signal: AbortSignal.timeout(10_000) });
      result.githubDispatch = response.status === 204 ? "dispatched" : `HTTP ${response.status}`;
    } catch (error) {
      result.githubDispatch = `failed: ${error instanceof Error ? error.message : "unknown"}`;
    }
  }

  try {
    const report = await relayReport({ fresh: true });
    result.health = report.health;
    const webhook = process.env.RELAY_ALERT_WEBHOOK;
    if (webhook && !dryRun && shouldAlert(report.health)) {
      const text = `Humanline relay ${report.health.status}: ${report.health.reason} https://humanline.credit/relay`;
      // ntfy.sh topics take the message as a plain-text body; Slack and Discord take JSON.
      const ntfy = new URL(webhook).hostname === "ntfy.sh";
      await fetch(webhook, {
        method: "POST",
        headers: ntfy
          ? { "content-type": "text/plain", title: "Humanline relay", tags: "warning" }
          : { "content-type": "application/json" },
        body: ntfy ? text : JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
      result.alerted = true;
    }
  } catch (error) {
    result.health = { status: "unknown", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" };
  }

  result.ms = Date.now() - started;
  console.log(`[cron/relay] ${JSON.stringify(result)}`);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
