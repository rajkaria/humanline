/**
 * @humanline/sdk — one human, one wallet, on Creditcoin.
 *
 * Humanline mirrors World ID's identity tree onto Creditcoin through the Attestcoin Protocol and
 * binds each verified human (a World ID nullifier) to one wallet at a time. This package reads that
 * binding and the human's credit line from any viem client, and ships `HumanGated.sol` for contracts.
 *
 *     import { createHumanlineClient, isHuman, humanOf, lineOf } from "@humanline/sdk";
 *     const client = createHumanlineClient();
 *     if (await isHuman(client, wallet)) {
 *       const human = await humanOf(client, wallet);
 *       const line = await lineOf(client, human);
 *     }
 */

import { createPublicClient, defineChain, http, type Address, type PublicClient } from "viem";

// ---------------------------------------------------------------------------------------------
// Chain and deployments
// ---------------------------------------------------------------------------------------------

export const creditcoinTestnet = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Test Creditcoin", symbol: "tCTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://creditcoin-testnet.blockscout.com" } },
  testnet: true,
});

/**
 * Humanline's two live deployments. `staging` verifies World ID proofs against World's Sepolia tree
 * (anyone can register with the World ID Simulator); `production` against the Ethereum mainnet Orb
 * tree. Both read roots that reached Creditcoin through Attestcoin.
 */
export const DEPLOYMENTS = {
  staging: {
    chainId: 102031,
    humanRegistry: "0x62c2fd99ea587e4b466175ad248468782bd5298d",
    creditLine: "0xbb97982f1138f36bfa3ba4706dad5134a10556d9",
    humanGate: "0xa3e021de49cec8819ea1bd37a8b5a9df005b776c",
    worldIdRoots: "0x3a7c3cc67034197208923587b8dc5c4674cbcef7",
    husd: "0x4bd7f4c6648deb8f107932572ce7e85aca259640",
  },
  production: {
    chainId: 102031,
    humanRegistry: "0x53fcba2cd9296b22635c67d5e73777b4e5db96af",
    creditLine: "0x30ca59acbf161284ed51f0412a42ecf3c9e577d7",
    humanGate: "0x544264e52a12fffa5c8640eb5a91b7f4628d5b93",
    worldIdRoots: "0x1122ef3fa4ab0693809e42a00b2476efcf4468ad",
    husd: "0x4bd7f4c6648deb8f107932572ce7e85aca259640",
  },
} as const satisfies Record<string, Deployment>;

export type Deployment = {
  chainId: number;
  humanRegistry: Address;
  creditLine: Address;
  humanGate: Address;
  /** The `AttestedWorldID` instance the registry verifies proofs against. */
  worldIdRoots: Address;
  husd: Address;
};

export type Profile = keyof typeof DEPLOYMENTS;

/** Options every read accepts: a named profile, or explicit addresses for your own deployment. */
export type ReadOptions = { profile?: Profile; deployment?: Deployment };

export function deploymentOf(options: ReadOptions = {}): Deployment {
  return options.deployment ?? DEPLOYMENTS[options.profile ?? "staging"];
}

/** A wallet-free client for CC3 testnet. Bring your own RPC URL if you have one. */
export function createHumanlineClient({ rpcUrl }: { rpcUrl?: string } = {}): PublicClient {
  return createPublicClient({
    chain: creditcoinTestnet,
    transport: http(rpcUrl ?? creditcoinTestnet.rpcUrls.default.http[0]),
  }) as PublicClient;
}

// ---------------------------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------------------------

export const humanRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "uint256" },
      { name: "nullifierHash", type: "uint256" },
      { name: "proof", type: "uint256[8]" },
    ],
    outputs: [],
  },
  { type: "function", name: "isHuman", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "humanOf", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "walletOf", stateMutability: "view", inputs: [{ name: "nullifierHash", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "registeredAt", stateMutability: "view", inputs: [{ name: "nullifierHash", type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "humanCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "HumanRegistered",
    inputs: [
      { name: "nullifierHash", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "root", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "HumanRebound",
    inputs: [
      { name: "nullifierHash", type: "uint256", indexed: true },
      { name: "oldWallet", type: "address", indexed: true },
      { name: "newWallet", type: "address", indexed: true },
    ],
  },
  { type: "error", name: "WalletAlreadyHuman", inputs: [{ name: "wallet", type: "address" }, { name: "nullifierHash", type: "uint256" }] },
  { type: "error", name: "SameWallet", inputs: [] },
  { type: "error", name: "ZeroNullifier", inputs: [] },
] as const;

const LINE_TUPLE = {
  type: "tuple",
  components: [
    { name: "limit", type: "uint256" },
    { name: "principal", type: "uint256" },
    { name: "dueAt", type: "uint64" },
    { name: "openedAt", type: "uint64" },
    { name: "loansRepaid", type: "uint32" },
    { name: "loansLate", type: "uint32" },
    { name: "frozen", type: "bool" },
  ],
} as const;

export const creditLineAbi = [
  { type: "function", name: "lineOf", stateMutability: "view", inputs: [{ name: "human", type: "uint256" }], outputs: [LINE_TUPLE] },
  { type: "function", name: "lineOfWallet", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [LINE_TUPLE] },
  { type: "function", name: "availableCredit", stateMutability: "view", inputs: [{ name: "human", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isInDefault", stateMutability: "view", inputs: [{ name: "human", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "openLine", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const worldIdRootsAbi = [
  { type: "function", name: "latestRoot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rootHistory", stateMutability: "view", inputs: [{ name: "root", type: "uint256" }], outputs: [{ name: "receivedAt", type: "uint128" }] },
  { type: "function", name: "isValidRoot", stateMutability: "view", inputs: [{ name: "root", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "rootCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const humanGateAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "human", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "error", name: "NotHuman", inputs: [{ name: "wallet", type: "address" }] },
  { type: "error", name: "AlreadyClaimed", inputs: [{ name: "human", type: "uint256" }] },
] as const;

/** `HumanGated.sol` errors, for decoding reverts from any contract that inherits it. */
export const humanGatedAbi = [
  { type: "function", name: "HUMAN_REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usedBy", stateMutability: "view", inputs: [{ name: "scope", type: "bytes32" }, { name: "human", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "error", name: "NotHuman", inputs: [{ name: "wallet", type: "address" }] },
  { type: "error", name: "AlreadyUsed", inputs: [{ name: "scope", type: "bytes32" }, { name: "human", type: "uint256" }] },
  { type: "error", name: "ZeroRegistry", inputs: [] },
] as const;

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** The part of a viem client the reads need, so tests and other clients can stand in for it. */
export type Reader = Pick<PublicClient, "readContract">;

export type Line = {
  limit: bigint;
  principal: bigint;
  dueAt: bigint;
  openedAt: bigint;
  loansRepaid: number;
  loansLate: number;
  frozen: boolean;
};

export type LineView = Line & {
  /** The human has opened a line at some point. */
  exists: boolean;
  available: bigint;
  inDefault: boolean;
};

/** Whether `wallet` is bound to a verified World ID human right now. */
export async function isHuman(client: Reader, wallet: Address, options?: ReadOptions): Promise<boolean> {
  return (await humanOf(client, wallet, options)) !== 0n;
}

/** The World ID nullifier (the "human") bound to `wallet`, or `0n`. */
export async function humanOf(client: Reader, wallet: Address, options?: ReadOptions): Promise<bigint> {
  return (await client.readContract({
    address: deploymentOf(options).humanRegistry,
    abi: humanRegistryAbi,
    functionName: "humanOf",
    args: [wallet],
  })) as bigint;
}

/** The wallet a human is bound to today, or the zero address. */
export async function walletOf(client: Reader, human: bigint, options?: ReadOptions): Promise<Address> {
  return (await client.readContract({
    address: deploymentOf(options).humanRegistry,
    abi: humanRegistryAbi,
    functionName: "walletOf",
    args: [human],
  })) as Address;
}

/** Unix seconds a human first registered (kept across wallet moves), or `0n`. */
export async function registeredAt(client: Reader, human: bigint, options?: ReadOptions): Promise<bigint> {
  return (await client.readContract({
    address: deploymentOf(options).humanRegistry,
    abi: humanRegistryAbi,
    functionName: "registeredAt",
    args: [human],
  })) as bigint;
}

/** A human's credit line, what they can still draw, and whether they are in default. */
export async function lineOf(client: Reader, human: bigint, options?: ReadOptions): Promise<LineView> {
  const address = deploymentOf(options).creditLine;
  const [line, available, inDefault] = await Promise.all([
    client.readContract({ address, abi: creditLineAbi, functionName: "lineOf", args: [human] }) as Promise<Line>,
    client.readContract({ address, abi: creditLineAbi, functionName: "availableCredit", args: [human] }) as Promise<bigint>,
    client.readContract({ address, abi: creditLineAbi, functionName: "isInDefault", args: [human] }) as Promise<boolean>,
  ]);
  return {
    limit: line.limit,
    principal: line.principal,
    dueAt: line.dueAt,
    openedAt: line.openedAt,
    loansRepaid: Number(line.loansRepaid),
    loansLate: Number(line.loansLate),
    frozen: line.frozen,
    exists: line.openedAt !== 0n,
    available,
    inDefault,
  };
}

export type HumanProfile = {
  wallet: Address;
  isHuman: boolean;
  human: bigint;
  registeredAt: bigint;
  /** Absent when the wallet is not a human. */
  line?: LineView;
};

/** Everything about a wallet in one call. */
export async function profileOf(client: Reader, wallet: Address, options?: ReadOptions): Promise<HumanProfile> {
  const human = await humanOf(client, wallet, options);
  if (human === 0n) return { wallet, isHuman: false, human, registeredAt: 0n };
  const [since, line] = await Promise.all([registeredAt(client, human, options), lineOf(client, human, options)]);
  return { wallet, isHuman: true, human, registeredAt: since, line };
}

/** The newest World ID root on Creditcoin and when it arrived (unix seconds). */
export async function latestWorldIdRoot(client: Reader, options?: ReadOptions): Promise<{ root: bigint; receivedAt: bigint }> {
  const address = deploymentOf(options).worldIdRoots;
  const root = (await client.readContract({ address, abi: worldIdRootsAbi, functionName: "latestRoot" })) as bigint;
  const receivedAt = (await client.readContract({ address, abi: worldIdRootsAbi, functionName: "rootHistory", args: [root] })) as bigint;
  return { root, receivedAt };
}

/** The short, shareable form of a human used by `humanline.credit/h/{short}`: the first 12 hex digits. */
export function shortHuman(human: bigint): string {
  return human.toString(16).padStart(64, "0").slice(0, 12);
}

/** `0x`-prefixed 32-byte hex of a human, the form the public API returns. */
export function humanHex(human: bigint): `0x${string}` {
  return `0x${human.toString(16).padStart(64, "0")}`;
}
