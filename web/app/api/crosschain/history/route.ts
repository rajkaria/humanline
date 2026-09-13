import { NextResponse } from "next/server";

import { jsonSafe, pairHistory } from "@/lib/crosschain/core";
import { scanAaveHistory } from "@/lib/crosschain/scan";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * A wallet's Aave V3 borrows and repayments on Sepolia (chainKey 1) or Ethereum (chainKey 3), each
 * with the receipt-local log index `CreditHistory.proveBorrow` / `proveRepay` take, classified by
 * the contract's own rules, and paired repay → borrow.
 *
 * `GET /api/crosschain/history?chainKey=1&wallet=0x…[&minGapBlocks=7200]`
 *
 * Read-only discovery. It decides nothing: the proofs are checked again on Creditcoin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
  const limited = rateLimit(`crosschain-history:${clientKey(request)}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const url = new URL(request.url);
  const chainKey = Number(url.searchParams.get("chainKey"));
  const wallet = url.searchParams.get("wallet") ?? "";
  const minGap = Number(url.searchParams.get("minGapBlocks") ?? "7200");

  if (chainKey !== 1 && chainKey !== 3) {
    return NextResponse.json({ error: "bad_chain_key", message: "chainKey must be 1 or 3." }, { status: 400 });
  }
  if (!ADDRESS.test(wallet)) {
    return NextResponse.json({ error: "bad_wallet", message: "wallet must be a 20-byte address." }, { status: 400 });
  }
  if (!Number.isInteger(minGap) || minGap < 1 || minGap > 10_000_000) {
    return NextResponse.json({ error: "bad_min_gap" }, { status: 400 });
  }

  try {
    const scan = await scanAaveHistory(chainKey, wallet as `0x${string}`);
    const { pairs, unmatched } = pairHistory(scan.events, minGap);
    return NextResponse.json(jsonSafe({ ...scan, minGapBlocks: minGap, pairs, unmatched }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "source_unavailable",
        message: error instanceof Error ? error.message.slice(0, 300) : "Could not read the source chain.",
      },
      { status: 502 },
    );
  }
}
