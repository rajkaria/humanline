"use client";

/**
 * wagmi configuration.
 *
 * Humanline is single-chain on the write path: everything a user signs happens
 * on Creditcoin CC3 testnet. The injected connector covers MetaMask, Rabby,
 * Brave and every other EIP-1193 wallet a judge is likely to have, with no
 * WalletConnect project id to configure.
 */

// `injected` is re-exported from `wagmi` itself. Importing it from
// `wagmi/connectors` instead would pull in the whole connector barrel —
// Coinbase, WalletConnect, Base Account — whose optional x402 dependencies do
// not resolve and break `next build`. Humanline only ever needs the injected
// provider, so this import is both smaller and the one that compiles.
import { createConfig, http, injected } from "wagmi";

import { creditcoinTestnet } from "@/lib/chains";

export const wagmiConfig = createConfig({
  chains: [creditcoinTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [creditcoinTestnet.id]: http(creditcoinTestnet.rpcUrls.default.http[0], {
      batch: true,
      retryCount: 2,
    }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
