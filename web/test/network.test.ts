/**
 * Wallet network switching.
 *
 * The bug this guards: wagmi only adds a missing chain when the wallet answers
 * `wallet_switchEthereumChain` with MetaMask's 4902. Every other wallet's
 * "unknown chain" error left the user stuck on "Switch to CC3" with no prompt.
 */

import { describe, expect, test } from "bun:test";

import { CC3_ADD_CHAIN_PARAMS, creditcoinTestnet } from "@/lib/chains";
import {
  describeSwitchError,
  type Eip1193Request,
  isRequestPending,
  isUserRejection,
  networkName,
  switchWalletToCc3,
} from "@/lib/network";

type Call = { method: string; params?: readonly unknown[] };

const CC3_HEX = CC3_ADD_CHAIN_PARAMS.chainId;

/** A scripted EIP-1193 provider: each method answers from a queue of results. */
function fakeWallet(script: Record<string, Array<unknown | Error>>, startChain = "0x1") {
  const calls: Call[] = [];
  let chain = startChain;
  const request: Eip1193Request = async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId" && !script.eth_chainId) return chain;
    const next = script[method]?.shift();
    if (next instanceof Error) throw next;
    if (method === "wallet_switchEthereumChain" || (method === "wallet_addEthereumChain" && next === "switches")) {
      chain = CC3_HEX;
    }
    return null;
  };
  return { request, calls };
}

function rpcError(code: number, message = "error"): Error {
  return Object.assign(new Error(message), { code });
}

describe("switchWalletToCc3", () => {
  test("a wallet that knows CC3 just switches", async () => {
    const wallet = fakeWallet({ wallet_switchEthereumChain: [null] });
    expect(await switchWalletToCc3(wallet.request)).toBe("switched");
    expect(wallet.calls.map((c) => c.method)).toEqual(["wallet_switchEthereumChain"]);
    expect(wallet.calls[0].params).toEqual([{ chainId: CC3_HEX }]);
  });

  test("MetaMask's 4902 adds the network, and does not re-prompt once add switched", async () => {
    const wallet = fakeWallet({
      wallet_switchEthereumChain: [rpcError(4902, "Unrecognized chain ID")],
      wallet_addEthereumChain: ["switches"],
    });
    expect(await switchWalletToCc3(wallet.request)).toBe("added");
    expect(wallet.calls.map((c) => c.method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ]);
    expect(wallet.calls[1].params).toEqual([
      {
        chainId: CC3_HEX,
        chainName: creditcoinTestnet.name,
        nativeCurrency: creditcoinTestnet.nativeCurrency,
        rpcUrls: [creditcoinTestnet.rpcUrls.default.http[0]],
        blockExplorerUrls: [creditcoinTestnet.blockExplorers.default.url],
      },
    ]);
  });

  // The regression: these codes are what non-MetaMask wallets send for an unknown chain.
  for (const [wallet, err] of [
    ["Rabby / Phantom (-32603)", rpcError(-32603, "Unrecognized chain ID 0x18e8f")],
    ["Coinbase Wallet (4200)", rpcError(4200, "Unsupported chain")],
    ["a wallet with no code at all", new Error("Chain not supported")],
  ] as const) {
    test(`${wallet} still gets the add-network prompt`, async () => {
      const fake = fakeWallet({ wallet_switchEthereumChain: [err], wallet_addEthereumChain: ["switches"] });
      expect(await switchWalletToCc3(fake.request)).toBe("added");
      expect(fake.calls.some((c) => c.method === "wallet_addEthereumChain")).toBe(true);
    });
  }

  test("a wallet that only adds gets a follow-up switch", async () => {
    const wallet = fakeWallet({
      wallet_switchEthereumChain: [rpcError(4902), null],
      wallet_addEthereumChain: [null],
    });
    expect(await switchWalletToCc3(wallet.request)).toBe("added");
    expect(wallet.calls.map((c) => c.method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
      "wallet_switchEthereumChain",
    ]);
  });

  test("a declined switch is rethrown, never retried as an add", async () => {
    const wallet = fakeWallet({ wallet_switchEthereumChain: [rpcError(4001, "User rejected the request.")] });
    await expect(switchWalletToCc3(wallet.request)).rejects.toMatchObject({ code: 4001 });
    expect(wallet.calls).toHaveLength(1);
  });

  test("an already-open prompt is rethrown, never stacked", async () => {
    const wallet = fakeWallet({ wallet_switchEthereumChain: [rpcError(-32002, "Request already pending")] });
    await expect(switchWalletToCc3(wallet.request)).rejects.toMatchObject({ code: -32002 });
    expect(wallet.calls).toHaveLength(1);
  });

  test("a declined add surfaces as a rejection", async () => {
    const wallet = fakeWallet({
      wallet_switchEthereumChain: [rpcError(4902)],
      wallet_addEthereumChain: [rpcError(4001)],
    });
    await expect(switchWalletToCc3(wallet.request)).rejects.toMatchObject({ code: 4001 });
  });
});

describe("error classification", () => {
  test("finds a rejection wrapped by viem or MetaMask Mobile", () => {
    expect(isUserRejection({ cause: { code: 4001 } })).toBe(true);
    expect(isUserRejection({ code: -32603, data: { originalError: { code: 4001 } } })).toBe(true);
    expect(isUserRejection(new Error("User denied network switch"))).toBe(true);
    expect(isUserRejection(rpcError(4902))).toBe(false);
  });

  test("finds a pending request", () => {
    expect(isRequestPending(rpcError(-32002))).toBe(true);
    expect(isRequestPending(new Error("Request of type 'wallet_switchEthereumChain' already pending"))).toBe(true);
    expect(isRequestPending(rpcError(4001))).toBe(false);
  });

  test("survives a self-referential cause", () => {
    const loop: { code: number; cause?: unknown } = { code: 1 };
    loop.cause = loop;
    expect(isUserRejection(loop)).toBe(false);
  });

  test("describes failures in the user's terms", () => {
    expect(describeSwitchError(rpcError(4001))).toContain("declined");
    expect(describeSwitchError(rpcError(-32002))).toContain("already has a request open");
    expect(describeSwitchError(new Error("RPC unreachable"))).toBe("RPC unreachable");
  });
});

describe("networkName", () => {
  test("names the networks a Humanline user is likely to be on", () => {
    expect(networkName(creditcoinTestnet.id)).toBe("Creditcoin CC3 testnet");
    expect(networkName(102030)).toBe("Creditcoin mainnet");
    expect(networkName(1)).toBe("Ethereum mainnet");
    expect(networkName(999999)).toBe("chainId 999999");
    expect(networkName(undefined)).toBe("an unknown network");
  });
});
