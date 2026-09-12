/**
 * The cached relay report, shared by `/api/relay/stats`, `/api/relay/health` and
 * the cron route's watchdog. Server-only.
 *
 * Reading the whole relay history costs a few dozen RPC calls, so one instance keeps
 * the last report for a minute; the cron route asks for a fresh one after it relays.
 */

import type { SourceChainKey } from "@/lib/chains";
import { getPublicClient } from "@/lib/public-client";
import { collectTrack, operatorAddresses } from "@/lib/relay/collect";
import { buildReport, type RelayReport } from "@/lib/relay/summary";

const TTL_MS = 60_000;
let cached: { at: number; report: RelayReport } | null = null;
let inflight: Promise<RelayReport> | null = null;

export async function relayReport({ fresh = false }: { fresh?: boolean } = {}): Promise<RelayReport> {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.report;
  if (!fresh && inflight) return inflight;

  inflight = (async () => {
    const client = getPublicClient();
    const chainKeys: SourceChainKey[] = [3, 1];
    const tracks = await Promise.all(chainKeys.map((ck) => collectTrack(client, ck)));
    const report = buildReport(tracks, operatorAddresses(), Math.floor(Date.now() / 1000));
    cached = { at: Date.now(), report };
    return report;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
