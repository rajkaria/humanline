import { NextResponse } from "next/server";

import { jsonSafe } from "@/lib/crosschain/core";
import { scanRepayTransfers } from "@/lib/crosschain/scan";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * USDC transfers from a wallet to Humanline's repayment address on Sepolia (chainKey 1) or
 * Ethereum (chainKey 3), with the receipt-local log index `EthRepay.creditRepayment` takes.
 *
 * `GET /api/crosschain/transfers?chainKey=1&wallet=0x…&to=0x…`
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
  const limited = rateLimit(`crosschain-transfers:${clientKey(request)}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const url = new URL(request.url);
  const chainKey = Number(url.searchParams.get("chainKey"));
  const wallet = url.searchParams.get("wallet") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (chainKey !== 1 && chainKey !== 3) {
    return NextResponse.json({ error: "bad_chain_key", message: "chainKey must be 1 or 3." }, { status: 400 });
  }
  if (!ADDRESS.test(wallet) || !ADDRESS.test(to)) {
    return NextResponse.json({ error: "bad_address", message: "wallet and to must be 20-byte addresses." }, { status: 400 });
  }

  try {
    const scan = await scanRepayTransfers(chainKey, wallet as `0x${string}`, to as `0x${string}`);
    return NextResponse.json(jsonSafe(scan), { headers: { "cache-control": "no-store" } });
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
