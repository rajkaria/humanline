// Creditcoin CC3 side: providers, signer, precompile reads, and the queryId / txIndex
// arithmetic that ASCBase performs on-chain (reproduced locally so tests need no network).
import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import {
  Contract,
  JsonRpcProvider,
  Network,
  Wallet,
  concat,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";
import { attestorStashInterface, loadAttestedWorldIdAbi } from "./abi";
import {
  ATTESTOR_STASH_PRECOMPILE,
  BN128_ADD,
  BN128_MUL,
  BN128_PAIRING,
  CC3_CHAIN_ID,
  cc3RpcUrl,
  privateKey,
  proverUrl,
} from "./config";

/** A JsonRpcProvider pinned to CC3 (static network: no chainId round-trip per call). */
export function cc3Provider(url = cc3RpcUrl()): JsonRpcProvider {
  return new JsonRpcProvider(url, Network.from(CC3_CHAIN_ID), { staticNetwork: true });
}

export function cc3Signer(provider: JsonRpcProvider): Wallet {
  const key = privateKey();
  if (!key) {
    throw new Error(
      "CREDITCOIN_WALLET_PRIVATE_KEY is not set (put it in .secrets.env or pass --env-file)",
    );
  }
  return new Wallet(key, provider);
}

export function chainInfoProvider(provider: JsonRpcProvider) {
  return new chainInfo.PrecompileChainInfoProvider(provider);
}

export function blockProverClient(provider: JsonRpcProvider) {
  return new blockProver.PrecompileBlockProver(provider);
}

export function proofBuilder(chainKey: number, timeoutMs = 120_000) {
  return new proofProvider.service.ProofBuilder(chainKey, proverUrl(), timeoutMs);
}

export function attestedWorldId(address: string, runner: JsonRpcProvider | Wallet): Contract {
  return new Contract(address, loadAttestedWorldIdAbi().iface, runner);
}

// ---------------------------------------------------------------------------
// Precompile reads
// ---------------------------------------------------------------------------

/** AttestorStash (0xFD4) bonded attestor count for a chainKey. */
export async function getAttestorsCount(
  provider: JsonRpcProvider,
  chainKey: number,
): Promise<number> {
  const data = attestorStashInterface.encodeFunctionData("getAttestorsCount", [chainKey]);
  const raw = await provider.call({ to: ATTESTOR_STASH_PRECOMPILE, data });
  const [count] = attestorStashInterface.decodeFunctionResult("getAttestorsCount", raw);
  return Number(count);
}

export interface Bn128Sanity {
  add: boolean;
  mul: boolean;
  pairing: boolean;
  ok: boolean;
}

/**
 * bn128 sanity: the Groth16 verifier that checks World ID proofs needs 0x06/0x07/0x08.
 * - 0x08 with empty input is the empty pairing product, which is `true` (32-byte 1).
 * - 0x06 / 0x07 on the point at infinity return 64 zero bytes.
 */
export async function bn128Sanity(provider: JsonRpcProvider): Promise<Bn128Sanity> {
  const zeros = (n: number) => `0x${"00".repeat(n)}`;
  const safe = async (to: string, data: string) => {
    try {
      return await provider.call({ to, data });
    } catch {
      return "0x";
    }
  };
  const add = await safe(BN128_ADD, zeros(128));
  const mul = await safe(BN128_MUL, zeros(96));
  const pairing = await safe(BN128_PAIRING, "0x");
  const res = {
    add: add === zeros(64),
    mul: mul === zeros(64),
    pairing:
      pairing === "0x0000000000000000000000000000000000000000000000000000000000000001",
  };
  return { ...res, ok: res.add && res.mul && res.pairing };
}

// ---------------------------------------------------------------------------
// queryId / txIndex (mirrors ASCBase._computeQueryId and VERIFIER.calculateTxIndex)
// ---------------------------------------------------------------------------

export interface MerkleSibling {
  hash: string;
  isLeft: boolean;
}

/**
 * calculateTxIndex: each sibling's `isLeft` says whether the sibling sits to the left, i.e.
 * whether this node is the right child, i.e. that level's index bit is 1. siblings[0] is the
 * leaf level. Verified against both fixtures (mainnet txIndex 173, sepolia txIndex 58).
 */
export function computeTxIndex(siblings: readonly MerkleSibling[]): number {
  let index = 0;
  siblings.forEach((s, i) => {
    if (s.isLeft) index |= 1 << i;
  });
  return index;
}

/**
 * ASCBase._computeQueryId hashes a 72-byte buffer:
 *   [0,32)  uint256(chainKey)
 *   [32,40) uint64 blockHeight
 *   [40,72) uint256 txIndex
 */
export function computeQueryId(
  chainKey: number | bigint,
  blockHeight: number | bigint,
  txIndex: number | bigint,
): string {
  return keccak256(
    concat([
      zeroPadValue(toBeHex(BigInt(chainKey)), 32),
      zeroPadValue(toBeHex(BigInt(blockHeight)), 8),
      zeroPadValue(toBeHex(BigInt(txIndex)), 32),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Revert decoding
// ---------------------------------------------------------------------------

/**
 * World's `WorldIDBridge.latestRoot()` reverts `NoRootsSeen()` before the first root is
 * relayed, rather than returning 0. That is "not bootstrapped yet", not a failure.
 */
export function isNoRootsSeen(err: unknown): boolean {
  return /NoRootsSeen/.test(revertReason(err));
}

export interface RootState {
  /** False when the contract has never received a root (`latestRoot()` reverts). */
  bootstrapped: boolean;
  latestRoot?: bigint;
  rootCount: bigint;
}

/** Reads `latestRoot`/`rootCount`, treating the pre-bootstrap revert as zero roots. */
export async function readRootState(contract: Contract): Promise<RootState> {
  let rootCount = 0n;
  try {
    rootCount = BigInt(await contract.rootCount!());
  } catch (e) {
    if (!isNoRootsSeen(e)) throw e;
  }
  try {
    return { bootstrapped: true, latestRoot: BigInt(await contract.latestRoot!()), rootCount };
  } catch (e) {
    if (isNoRootsSeen(e)) return { bootstrapped: false, rootCount };
    throw e;
  }
}


/** Pulls the most useful human-readable reason out of an ethers error. */
export function revertReason(err: unknown): string {
  const e = err as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    data?: string;
    revert?: { name?: string; args?: unknown[] };
    info?: { error?: { message?: string } };
  };
  if (e?.revert?.name) {
    const args = (e.revert.args ?? []).map((a) => String(a)).join(", ");
    return args ? `${e.revert.name}(${args})` : `${e.revert.name}()`;
  }
  if (e?.data && e.data !== "0x") {
    try {
      const parsed = loadAttestedWorldIdAbi().iface.parseError(e.data);
      if (parsed) {
        const args = parsed.args.map((a) => String(a)).join(", ");
        return args ? `${parsed.name}(${args})` : `${parsed.name}()`;
      }
    } catch {
      /* fall through */
    }
  }
  return e?.reason ?? e?.info?.error?.message ?? e?.shortMessage ?? e?.message ?? String(err);
}
