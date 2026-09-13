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
import { mainnet, sepolia } from "wagmi/chains";

import { creditcoinTestnet } from "@/lib/chains";

// Sepolia and Ethereum are here for exactly two Ethereum-side writes a user makes to use their
// Ethereum history: the link self-send and a USDC repayment. Everything else is still Creditcoin.
export const wagmiConfig = createConfig({
  chains: [creditcoinTestnet, sepolia, mainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [creditcoinTestnet.id]: http(creditcoinTestnet.rpcUrls.default.http[0], {
      batch: true,
      retryCount: 2,
    }),
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 1 }),
    [mainnet.id]: http("https://ethereum-rpc.publicnode.com", { retryCount: 1 }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
