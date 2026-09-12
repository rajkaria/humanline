/**
 * Getting a wallet onto Creditcoin CC3 testnet.
 *
 * wagmi's `switchChain` only falls back to `wallet_addEthereumChain` when the
 * wallet answers `wallet_switchEthereumChain` with error 4902. That is
 * MetaMask's code. Rabby, Phantom, Trust, OKX and Coinbase Wallet report an
 * unknown chain as -32603, 4200 or a bare message instead, so on those wallets
 * the switch failed silently: no prompt, no network added, and the header kept
 * saying "Switch to CC3". This module talks EIP-1193 directly and treats every
 * failure except "the user said no" or "a request is already open" as
 * "this wallet does not know CC3 yet".
 *
 * Kept free of React and wagmi so `test/network.test.ts` can drive it with a
 * fake provider.
 */

import { CC3_ADD_CHAIN_PARAMS, creditcoinTestnet } from "@/lib/chains";
import { describeError } from "@/lib/format";

/** The one method an EIP-1193 provider must expose. */
export type Eip1193Request = (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;

/** EIP-1193 `userRejectedRequest`. */
const USER_REJECTED = 4001;
/** MetaMask / JSON-RPC "resource unavailable": a prompt for this site is already open. */
const REQUEST_PENDING = -32002;

/** Follow `cause` / `data.originalError` wrappers and collect every error code seen. */
function errorCodes(error: unknown): number[] {
  const codes: number[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; data?: { originalError?: unknown }; cause?: unknown };
    if (typeof e.code === "number") codes.push(e.code);
    const original = e.data?.originalError as { code?: unknown } | undefined;
    if (original && typeof original.code === "number") codes.push(original.code);
    current = e.cause;
  }
  return codes;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return typeof error === "string" ? error : "";
  const e = error as { message?: unknown; cause?: unknown };
  const own = typeof e.message === "string" ? e.message : "";
  return e.cause && e.cause !== error ? `${own}\n${errorText(e.cause)}` : own;
}

/** The user dismissed or declined the wallet prompt. */
export function isUserRejection(error: unknown): boolean {
  return (
    errorCodes(error).includes(USER_REJECTED) ||
    /user (rejected|denied|cancel)|rejected by (the )?user|request rejected/i.test(errorText(error))
  );
}

/** The wallet already has a prompt open for this site. */
export function isRequestPending(error: unknown): boolean {
  return (
    errorCodes(error).includes(REQUEST_PENDING) ||
    /already pending|request of type .* already/i.test(errorText(error))
  );
}

async function currentChainId(request: Eip1193Request): Promise<number | undefined> {
  try {
    const hex = await request({ method: "eth_chainId" });
    return typeof hex === "string" ? Number.parseInt(hex, 16) : typeof hex === "number" ? hex : undefined;
  } catch {
    return undefined;
  }
}

/** What `switchWalletToCc3` had to do. */
export type SwitchOutcome = "switched" | "added";

/**
 * Ask the wallet to move to CC3 testnet, adding the network first if it needs to.
 *
 * Rethrows user rejections and "already pending" untouched — retrying either
 * would open a second prompt the user did not ask for.
 */
export async function switchWalletToCc3(
  request: Eip1193Request,
  params: typeof CC3_ADD_CHAIN_PARAMS = CC3_ADD_CHAIN_PARAMS,
): Promise<SwitchOutcome> {
  const target = Number.parseInt(params.chainId, 16);
  const switchParams = [{ chainId: params.chainId }] as const;

  try {
    await request({ method: "wallet_switchEthereumChain", params: switchParams });
    return "switched";
  } catch (error) {
    if (isUserRejection(error) || isRequestPending(error)) throw error;
    // Anything else: the wallet does not know CC3. Add it below.
  }

  await request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: params.chainId,
        chainName: params.chainName,
        nativeCurrency: params.nativeCurrency,
        rpcUrls: [...params.rpcUrls],
        blockExplorerUrls: [...params.blockExplorerUrls],
      },
    ],
  });

  // MetaMask and Rabby switch as part of adding; Trust and older Coinbase
  // Wallet builds only add. Ask for the switch only if we are not there yet.
  if ((await currentChainId(request)) !== target) {
    await request({ method: "wallet_switchEthereumChain", params: switchParams });
  }
  return "added";
}

/** One sentence for a failed switch, phrased for the person holding the wallet. */
export function describeSwitchError(error: unknown): string {
  if (isUserRejection(error)) {
    return "The network switch was declined in your wallet. Humanline only works on Creditcoin CC3 testnet.";
  }
  if (isRequestPending(error)) {
    return "Your wallet already has a request open — open the wallet extension to approve it.";
  }
  return describeError(error);
}

const KNOWN_NETWORKS: Record<number, string> = {
  1: "Ethereum mainnet",
  10: "OP Mainnet",
  56: "BNB Smart Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum One",
  11155111: "Sepolia",
  102030: "Creditcoin mainnet",
  [creditcoinTestnet.id]: "Creditcoin CC3 testnet",
  102032: "Creditcoin devnet",
};

/** A readable name for whatever network a wallet reports. */
export function networkName(chainId: number | undefined): string {
  if (chainId === undefined) return "an unknown network";
  return KNOWN_NETWORKS[chainId] ?? `chainId ${chainId}`;
}
