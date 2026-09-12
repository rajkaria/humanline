import { NextResponse } from "next/server";

import type { SourceChainKey } from "@/lib/chains";
import { getPublicClient } from "@/lib/public-client";
import { buildRelayPlan } from "@/lib/relay/build-plan";
import { planToJson } from "@/lib/relay/plan";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * What has to reach Creditcoin before a World ID proof root is usable.
 *
 * `GET /api/relay/plan?chainKey=1&root=<uint256 as decimal or 0x hex>`
 *
 * Answers with one of `known`, `ready`, `waiting` (with the attested height still
 * needed and an ETA), `not-found`, `stale` or `gap`. `ready` and `waiting` carry
 * the ordered World ID updates and how they split into `executeBatch` calls. The
 * browser then fetches the proof for each batch and sends it from the user's own
 * wallet: nothing here signs anything, and the plan cannot make a wallet relay a
 * root that is not genuine, because the contract re-checks every claim.
 *
 * Open to any origin and cached for a few seconds, so a judge can curl it too.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

type CacheEntry = { at: number; body: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 10_000;

function parseRoot(raw: string | null): bigint | null {
  if (!raw) return null;
  try {
    const value = BigInt(raw.trim());
    return value > 0n && value < 2n ** 256n ? value : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const limited = rateLimit(`relay-plan:${clientKey(request)}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const url = new URL(request.url);
  const chainKey = Number(url.searchParams.get("chainKey"));
  if (chainKey !== 1 && chainKey !== 3) {
    return NextResponse.json(
      { error: "bad_chain_key", message: "chainKey must be 1 (Sepolia staging) or 3 (Ethereum mainnet)." },
      { status: 400, headers: CORS },
    );
  }
  const root = parseRoot(url.searchParams.get("root"));
  if (root === null) {
    return NextResponse.json(
      { error: "bad_root", message: "root must be a non-zero uint256, decimal or 0x-hex." },
      { status: 400, headers: CORS },
    );
  }

  const key = `${chainKey}:${root}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body, { headers: CORS });

  try {
    const built = await buildRelayPlan({
      client: getPublicClient(),
      chainKey: chainKey as SourceChainKey,
      root,
    });
    const body = {
      chainKey,
      root: root.toString(),
      contract: built.contract,
      latestRoot: built.state.latestRoot?.toString() ?? null,
      attestedTip: built.state.attestedTip,
      finalityDepth: built.state.finalityDepth,
      sourceHead: built.sourceHead,
      /** ChainInfo `is_height_attested` for the target update's block (null when not asked). */
      targetAttested: built.targetAttested ?? null,
      plan: planToJson(built.plan),
    };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return NextResponse.json(body, { headers: CORS });
  } catch (error) {
    return NextResponse.json(
      {
        error: "plan_failed",
        message: error instanceof Error ? error.message.slice(0, 300) : "Could not build a relay plan.",
      },
      { status: 502, headers: CORS },
    );
  }
}
