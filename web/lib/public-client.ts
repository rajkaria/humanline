/**
 * A wallet-free viem client for CC3.
 *
 * `/relay` and `/judge` have to work for a judge who never connects a wallet, so
 * they read through this client rather than through wagmi's connected account.
 */

import { createPublicClient, http, type PublicClient } from "viem";

import { creditcoinTestnet } from "@/lib/chains";

let cached: PublicClient | undefined;

export function getPublicClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({
      chain: creditcoinTestnet,
      transport: http(creditcoinTestnet.rpcUrls.default.http[0], {
        batch: true,
        retryCount: 2,
        timeout: 20_000,
      }),
    });
  }
  return cached;
}
