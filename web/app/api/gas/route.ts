import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { creditcoinTestnet } from "@/lib/chains";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Drip enough CC3 testnet gas for a first-time human to register and borrow.
 *
 * `HumanRegistry.register` binds the proof to `msg.sender`, so the person has to
 * send that transaction themselves — which means a wallet with no tCTC cannot use
 * Humanline at all, however good the proof is. The public Creditcoin faucet exists,
 * but "go to another site, come back, try again" is where real users stop.
 *
 * The guards are deliberately boring:
 *   - a per-IP token bucket, as on the other routes;
 *   - an on-chain balance check, which is the one that actually holds: a wallet
 *     that already has gas is refused, so a loop of requests cannot drain the
 *     faucet even across serverless instances that share no memory;
 *   - a floor on the faucet's own balance, so it degrades to a clear message
 *     rather than a failed transaction.
 *
 * The key lives only in the server environment. Nothing here signs anything for
 * the user — it sends native tCTC to an address they control and nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roughly 20× a register transaction, which costs ~340k gas. */
const DRIP = parseEther("2");
/** Above this the wallet can already pay for register + borrow + repay. */
const ELIGIBILITY_CEILING = parseEther("0.5");
/** Refuse rather than half-fund when the faucet is nearly empty. */
const FAUCET_FLOOR = parseEther("10");

export async function POST(request: Request) {
  const limited = rateLimit(`gas:${clientKey(request)}`, { limit: 3, windowMs: 60 * 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const key = process.env.GAS_FAUCET_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return NextResponse.json(
      {
        error: "not_configured",
        detail: "GAS_FAUCET_PRIVATE_KEY is not set on this deployment.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const address = (body as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "bad_address" }, { status: 400 });
  }

  const rpc = creditcoinTestnet.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: creditcoinTestnet, transport: http(rpc) });

  try {
    const [balance, account] = [
      await publicClient.getBalance({ address }),
      privateKeyToAccount(key as `0x${string}`),
    ];

    if (balance >= ELIGIBILITY_CEILING) {
      return NextResponse.json(
        { error: "already_funded", balance: balance.toString() },
        { status: 409 },
      );
    }

    const faucetBalance = await publicClient.getBalance({ address: account.address });
    if (faucetBalance < FAUCET_FLOOR) {
      return NextResponse.json(
        { error: "faucet_empty", detail: "The gas faucet needs a top-up." },
        { status: 503 },
      );
    }

    const wallet = createWalletClient({ account, chain: creditcoinTestnet, transport: http(rpc) });
    const hash = await wallet.sendTransaction({ to: address, value: DRIP });

    return NextResponse.json(
      { hash, amount: DRIP.toString(), faucet: account.address },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "send_failed", detail: error instanceof Error ? error.message : "unknown" },
      { status: 502 },
    );
  }
}
