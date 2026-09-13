/**
 * The public read API, `/api/v1`: is this wallet a verified human, and what is this human's credit
 * line. Pure parsing and shaping plus two reads against a viem-style reader, so the routes stay thin
 * and everything here is unit-tested. Numbers that can exceed 2^53 are decimal strings.
 */

import { getAddress, isAddress, type Address, type PublicClient } from "viem";

import { creditLineAbi, humanRegistryAbi } from "@/lib/abi";
import { PROFILES, type ProfileId } from "@/lib/profiles";

export type Reader = Pick<PublicClient, "readContract">;

export const API_VERSION = "1.0.0";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** `?profile=` accepts `staging`/`demo` (Sepolia staging tree) and `production` (Orb tree). */
export function parseProfile(value: string | null): ProfileId {
  if (value === null || value === "" || value === "staging" || value === "demo") return "demo";
  if (value === "production") return "production";
  throw new ApiError(400, "bad_profile", "profile must be staging or production");
}

export function parseAddress(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new ApiError(400, "bad_address", "not an EVM address");
  return getAddress(value);
}

const MAX_UINT256 = 2n ** 256n - 1n;

/** A World ID nullifier: decimal, or 0x-prefixed hex up to 32 bytes. Zero is never a human. */
export function parseNullifier(value: string): bigint {
  const ok = /^0x[0-9a-fA-F]{1,64}$/.test(value) || /^[0-9]{1,78}$/.test(value);
  if (!ok) throw new ApiError(400, "bad_nullifier", "nullifier must be decimal or 0x-prefixed hex");
  const n = BigInt(value);
  if (n === 0n || n > MAX_UINT256) throw new ApiError(400, "bad_nullifier", "nullifier out of range");
  return n;
}

const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as const;

function contractsOf(profile: ProfileId) {
  const { deployment } = PROFILES[profile];
  const registry = deployment.contracts.humanRegistry.address;
  const creditLine = deployment.contracts.creditLine.address;
  if (!registry || !creditLine) throw new ApiError(503, "not_deployed", `the ${profile} deployment is not configured`);
  return { registry, creditLine };
}

export type LineJson = {
  exists: boolean;
  limit: string;
  principal: string;
  available: string;
  dueAt: number | null;
  openedAt: number | null;
  loansRepaid: number;
  loansLate: number;
  frozen: boolean;
  inDefault: boolean;
  /** hUSD has six decimals. */
  decimals: 6;
};

export async function readLine(client: Reader, profile: ProfileId, human: bigint): Promise<LineJson> {
  const { creditLine } = contractsOf(profile);
  const [line, available, inDefault] = await Promise.all([
    client.readContract({ address: creditLine, abi: creditLineAbi, functionName: "lineOf", args: [human] }),
    client.readContract({ address: creditLine, abi: creditLineAbi, functionName: "availableCredit", args: [human] }),
    client.readContract({ address: creditLine, abi: creditLineAbi, functionName: "isInDefault", args: [human] }),
  ]);
  const l = line as { limit: bigint; principal: bigint; dueAt: bigint; openedAt: bigint; loansRepaid: number; loansLate: number; frozen: boolean };
  return {
    exists: l.openedAt !== 0n,
    limit: l.limit.toString(),
    principal: l.principal.toString(),
    available: (available as bigint).toString(),
    dueAt: l.dueAt === 0n ? null : Number(l.dueAt),
    openedAt: l.openedAt === 0n ? null : Number(l.openedAt),
    loansRepaid: Number(l.loansRepaid),
    loansLate: Number(l.loansLate),
    frozen: l.frozen,
    inDefault: inDefault as boolean,
    decimals: 6,
  };
}

export type HumanJson = {
  version: string;
  profile: "staging" | "production";
  address: Address;
  isHuman: boolean;
  /** The World ID nullifier as 32-byte hex, or null. */
  nullifier: `0x${string}` | null;
  /** Unix seconds of first registration, kept across wallet moves. */
  registeredAt: number | null;
  line: LineJson | null;
  registry: Address;
};

export async function readHuman(client: Reader, profile: ProfileId, address: Address): Promise<HumanJson> {
  const { registry } = contractsOf(profile);
  const human = (await client.readContract({ address: registry, abi: humanRegistryAbi, functionName: "humanOf", args: [address] })) as bigint;
  const base = { version: API_VERSION, profile: profile === "demo" ? "staging" : "production", address, registry } as const;
  if (human === 0n) return { ...base, isHuman: false, nullifier: null, registeredAt: null, line: null };
  const [since, line] = await Promise.all([
    client.readContract({ address: registry, abi: humanRegistryAbi, functionName: "registeredAt", args: [human] }),
    readLine(client, profile, human),
  ]);
  return { ...base, isHuman: true, nullifier: hex32(human), registeredAt: Number(since as bigint), line };
}

export type LineResponse = {
  version: string;
  profile: "staging" | "production";
  nullifier: `0x${string}`;
  /** The wallet the human is bound to today, or null when the nullifier is unknown. */
  wallet: Address | null;
  line: LineJson;
  creditLine: Address;
};

export async function readLineResponse(client: Reader, profile: ProfileId, human: bigint): Promise<LineResponse> {
  const { registry, creditLine } = contractsOf(profile);
  const [wallet, line] = await Promise.all([
    client.readContract({ address: registry, abi: humanRegistryAbi, functionName: "walletOf", args: [human] }),
    readLine(client, profile, human),
  ]);
  const w = wallet as Address;
  return {
    version: API_VERSION,
    profile: profile === "demo" ? "staging" : "production",
    nullifier: hex32(human),
    wallet: /^0x0{40}$/i.test(w) ? null : w,
    line,
    creditLine,
  };
}

export function errorBody(error: unknown): { status: number; body: { error: string; message: string } } {
  if (error instanceof ApiError) return { status: error.status, body: { error: error.code, message: error.message } };
  return { status: 502, body: { error: "chain_read_failed", message: error instanceof Error ? error.message.slice(0, 200) : "unknown" } };
}
