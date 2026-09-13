/**
 * Cross-chain credit identity, the pure half: link intents, EIP-712 link signatures, proof-builder
 * JSON → `SourceProof` structs, EvmV1 receipt decoding, and the Aave history pairing rules.
 *
 * Everything here mirrors a rule in `contracts/src/{HumanLinks,CreditHistory,EthRepay}.sol` so the
 * app can tell a user *before* they sign whether a proof will be accepted, and why not. The contract
 * stays the only judge: nothing computed here is trusted on-chain.
 */

import {
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

import type { SourceChainKey } from "@/lib/chains";
import { normalizeSingle, type ContinuityProof, type MerkleProof, type SingleProofJson } from "@/lib/relay/proof";

// ------------------------------------------------------------------------------------------ links

/** `bytes4(keccak256("humanlineLink(uint256,address,uint256,address)"))`, as in `HumanLinks.LINK_MARKER`. */
export const LINK_MARKER: Hex = toFunctionSelector("humanlineLink(uint256,address,uint256,address)");

export type LinkIntent = {
  human: bigint;
  creditcoinWallet: Address;
  creditcoinChainId: number;
  links: Address;
};

/**
 * Calldata for the zero-value transaction a wallet sends *to itself* on Ethereum or Sepolia to
 * link to a human: `LINK_MARKER ‖ abi.encode(human, creditcoinWallet, creditcoinChainId, links)`.
 */
export function linkIntentData(intent: LinkIntent): Hex {
  return concat([
    LINK_MARKER,
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      [intent.human, intent.creditcoinWallet, BigInt(intent.creditcoinChainId), intent.links],
    ),
  ]);
}

/** The inverse of {@link linkIntentData}; `null` for anything that is not exactly a link intent. */
export function parseLinkIntent(data: Hex): LinkIntent | null {
  if (data.length !== 2 + 2 * (4 + 4 * 32) || data.slice(0, 10).toLowerCase() !== LINK_MARKER) return null;
  try {
    const [human, creditcoinWallet, chainId, links] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      `0x${data.slice(10)}`,
    );
    return { human, creditcoinWallet, creditcoinChainId: Number(chainId), links };
  } catch {
    return null;
  }
}

export const LINK_TYPES = {
  Link: [
    { name: "human", type: "uint256" },
    { name: "creditcoinWallet", type: "address" },
    { name: "wallet", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** EIP-712 payload for `HumanLinks.linkBySignature`, domain-bound to one chain and one deployment. */
export function linkTypedData(args: {
  links: Address;
  chainId: number;
  human: bigint;
  creditcoinWallet: Address;
  wallet: Address;
  deadline: bigint;
}) {
  return {
    domain: {
      name: "Humanline HumanLinks",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.links,
    },
    types: LINK_TYPES,
    primaryType: "Link" as const,
    message: {
      human: args.human,
      creditcoinWallet: args.creditcoinWallet,
      wallet: args.wallet,
      deadline: args.deadline,
    },
  };
}

// ------------------------------------------------------------------------------------------ proofs

/** Exactly the Solidity `SourceProof` struct viem encodes. */
export type SourceProofStruct = {
  chainKey: bigint;
  blockHeight: bigint;
  encodedTransaction: Hex;
  merkleProof: MerkleProof;
  continuityProof: ContinuityProof;
};

/**
 * Proof builder `proof-by-tx` JSON → `SourceProof`. Strict: the proof must be for `expectedHash`
 * when given, and its Merkle path must encode its own transaction index.
 */
export function sourceProofFromJson(json: SingleProofJson, expectedHash?: string): SourceProofStruct {
  const batch = normalizeSingle(json, expectedHash);
  const member = batch.members[0]!;
  return {
    chainKey: BigInt(batch.chainKey),
    blockHeight: BigInt(member.blockHeight),
    encodedTransaction: member.txBytes,
    merkleProof: member.merkleProof,
    continuityProof: batch.continuityProof,
  };
}

export type ReceiptLog = { address: Address; topics: Hex[]; data: Hex };

export type DecodedTx = {
  txType: number;
  from: Address;
  to: Address | null;
  data: Hex;
  status: number;
  logs: ReceiptLog[];
};

/**
 * Decode EvmV1 `txBytes` (`abi.encode(uint8 txType, bytes[] chunks)`) the way `EvmV1Decoder` does:
 * chunk 0 is the common fields, the last chunk (index 2 for types 0-2, 3 for 3-4) the receipt.
 * The log index a contract call takes is the position in *this* list, not the block-wide index.
 */
export function decodeTxBytes(txBytes: Hex): DecodedTx {
  const [txType, chunks] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes[]" }], txBytes);
  if (txType > 4) throw new Error(`unsupported EvmV1 transaction type ${txType}`);
  const receiptIndex = txType <= 2 ? 2 : 3;
  if (chunks.length !== receiptIndex + 1) throw new Error(`malformed EvmV1 payload: ${chunks.length} chunks`);

  const [, , from, toIsNull, to, , data] = decodeAbiParameters(
    [
      { type: "uint64" },
      { type: "uint64" },
      { type: "address" },
      { type: "bool" },
      { type: "address" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    chunks[0]!,
  );
  const [status, , logs] = decodeAbiParameters(
    [
      { type: "uint8" },
      { type: "uint64" },
      {
        type: "tuple[]",
        components: [
          { name: "address_", type: "address" },
          { name: "topics", type: "bytes32[]" },
          { name: "data", type: "bytes" },
        ],
      },
      { type: "bytes" },
    ],
    chunks[receiptIndex]!,
  );

  return {
    txType,
    from: getAddress(from),
    to: toIsNull ? null : getAddress(to),
    data,
    status,
    logs: logs.map((l) => ({ address: getAddress(l.address_), topics: [...l.topics], data: l.data })),
  };
}

/** Position of the first receipt log matching `predicate`, or -1. */
export function findLogIndex(txBytes: Hex, predicate: (log: ReceiptLog, index: number) => boolean): number {
  return decodeTxBytes(txBytes).logs.findIndex(predicate);
}

/** Receipt-local index of a log given its block-wide `logIndex`, from an RPC receipt. */
export function txLocalLogIndex(receiptLogs: ReadonlyArray<{ logIndex: number | bigint | null }>, blockLogIndex: number | bigint): number {
  const target = BigInt(blockLogIndex);
  const index = receiptLogs.findIndex((l) => l.logIndex !== null && BigInt(l.logIndex) === target);
  if (index < 0) throw new Error(`log ${blockLogIndex} is not in this receipt`);
  return index;
}

// ------------------------------------------------------------------------------------------ Aave

/** keccak256("Borrow(address,address,address,uint256,uint8,uint256,uint16)") */
export const BORROW_TOPIC: Hex = "0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0";
/** keccak256("Repay(address,address,address,uint256,bool)") */
export const REPAY_TOPIC: Hex = "0xa534c8dbe71f871f9f3530e97a74601fea17b426cae02e1c5aee42c96c784051";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type Token = { address: Address; symbol: string; decimals: number };

/** The Aave V3 pools and dollar-stable reserves `CreditHistory` is deployed with. */
export const AAVE_POOLS: Record<SourceChainKey, { pool: Address; reserves: Token[] }> = {
  1: {
    pool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
    reserves: [
      { address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8", symbol: "USDC", decimals: 6 },
      { address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357", symbol: "DAI", decimals: 18 },
      { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", symbol: "USDT", decimals: 6 },
    ],
  },
  3: {
    pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    reserves: [
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
      { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
      { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18 },
    ],
  },
};

/** The stablecoin `EthRepay` accepts on each source chain. */
export const REPAY_STABLECOINS: Record<SourceChainKey, Token> = {
  1: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", symbol: "USDC", decimals: 6 },
  3: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
};

export function reserveOf(chainKey: SourceChainKey, address: string): Token | undefined {
  return AAVE_POOLS[chainKey].reserves.find((r) => r.address.toLowerCase() === address.toLowerCase());
}

const topicAddress = (topic: Hex | undefined): Address => getAddress(`0x${(topic ?? "0x").slice(-40)}`);

export type AaveEvent = {
  kind: "borrow" | "repay";
  txHash: Hex;
  blockNumber: number;
  /** Receipt-local index: what `proveBorrow` / `proveRepay` take. */
  logIndex: number;
  wallet: Address;
  reserve: Address;
  token?: Token;
  amount: bigint;
  /** Whether `CreditHistory` would accept this log at all (pairing aside). */
  eligible: boolean;
  reason?: string;
};

/** Classify one Aave pool log exactly as `CreditHistory` would, minus the link check. */
export function classifyAaveLog(
  chainKey: SourceChainKey,
  log: ReceiptLog,
  meta: { txHash: Hex; blockNumber: number; logIndex: number },
): AaveEvent | null {
  if (log.address.toLowerCase() !== AAVE_POOLS[chainKey].pool.toLowerCase() || log.topics.length !== 4) return null;
  const topic0 = log.topics[0]!.toLowerCase();
  const reserve = topicAddress(log.topics[1]);
  const token = reserveOf(chainKey, reserve);

  if (topic0 === BORROW_TOPIC) {
    const onBehalfOf = topicAddress(log.topics[2]);
    const [user, amount] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }],
      log.data,
    );
    const reason = !token
      ? "Not a dollar-stable reserve Humanline counts."
      : getAddress(user) !== onBehalfOf
        ? "Borrowed on behalf of another address."
        : undefined;
    return { kind: "borrow", ...meta, wallet: onBehalfOf, reserve, token, amount, eligible: !reason, reason };
  }
  if (topic0 === REPAY_TOPIC) {
    const user = topicAddress(log.topics[2]);
    const repayer = topicAddress(log.topics[3]);
    const [amount, useATokens] = decodeAbiParameters([{ type: "uint256" }, { type: "bool" }], log.data);
    const reason = !token
      ? "Not a dollar-stable reserve Humanline counts."
      : repayer !== user
        ? "Repaid by another address."
        : useATokens
          ? "Repaid with aTokens (a netted deposit), which does not count."
          : undefined;
    return { kind: "repay", ...meta, wallet: user, reserve, token, amount, eligible: !reason, reason };
  }
  return null;
}

export type HistoryPair = {
  borrow: AaveEvent;
  repay: AaveEvent;
  /** Reserve units `CreditHistory` would credit: `min(repay, borrow remaining)`. */
  credited: bigint;
  creditedUsd: bigint;
};

/**
 * Match repayments to earlier borrows the way `CreditHistory` accepts them: same wallet and reserve,
 * `MIN_GAP_BLOCKS` apart, each borrow backing at most its own amount. Oldest borrow first, so the
 * suggested pairing never strands credit an earlier borrow could have backed.
 */
export function pairHistory(events: readonly AaveEvent[], minGapBlocks: number) {
  const borrows = events
    .filter((e) => e.kind === "borrow" && e.eligible)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
    .map((b) => ({ event: b, remaining: b.amount }));
  const repays = events
    .filter((e) => e.kind === "repay" && e.eligible)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  const pairs: HistoryPair[] = [];
  const unmatched: AaveEvent[] = [];
  for (const repay of repays) {
    const match = borrows.find(
      (b) =>
        b.remaining > 0n &&
        b.event.wallet === repay.wallet &&
        b.event.reserve === repay.reserve &&
        b.event.blockNumber + minGapBlocks <= repay.blockNumber,
    );
    if (!match) {
      unmatched.push(repay);
      continue;
    }
    const credited = repay.amount < match.remaining ? repay.amount : match.remaining;
    match.remaining -= credited;
    pairs.push({ borrow: match.event, repay, credited, creditedUsd: toUsd(credited, repay.token!.decimals) });
  }
  return { pairs, unmatched };
}

/** Reserve units → six-decimal dollars at 1 USD per token, as `CreditHistory._toUsd`. */
export function toUsd(amount: bigint, decimals: number): bigint {
  if (decimals >= 6) return amount / 10n ** BigInt(decimals - 6);
  return amount * 10n ** BigInt(6 - decimals);
}

/** `CreditHistory.boostOf` for a given verified total. */
export function boostFor(repaidUsd: bigint, boostBps: bigint, maxBoost: bigint): bigint {
  const boost = (repaidUsd * boostBps) / 10_000n;
  return boost < maxBoost ? boost : maxBoost;
}

// ------------------------------------------------------------------------------------------ repay

export type RepayTransfer = {
  txHash: Hex;
  blockNumber: number;
  logIndex: number;
  from: Address;
  to: Address;
  value: bigint;
};

/** A `Transfer` log `EthRepay` would accept: right token, right recipient. */
export function classifyRepayTransfer(
  chainKey: SourceChainKey,
  log: ReceiptLog,
  repayAddress: Address,
  meta: { txHash: Hex; blockNumber: number; logIndex: number },
): RepayTransfer | null {
  if (log.address.toLowerCase() !== REPAY_STABLECOINS[chainKey].address.toLowerCase()) return null;
  if (log.topics.length !== 3 || log.topics[0]!.toLowerCase() !== TRANSFER_TOPIC) return null;
  const to = topicAddress(log.topics[2]);
  if (to !== getAddress(repayAddress)) return null;
  const [value] = decodeAbiParameters([{ type: "uint256" }], log.data);
  return { ...meta, from: topicAddress(log.topics[1]), to, value };
}

/** JSON-safe copy (bigints as decimal strings) for API responses. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// ------------------------------------------------------------------------------------------ replay keys

/** `ProvenSource.queryIdOf`: keccak256(uint256 chainKey ‖ uint64 blockHeight ‖ uint256 txIndex), 72 bytes. */
export function queryIdOf(chainKey: bigint | number, blockHeight: bigint | number, txIndex: bigint | number): Hex {
  return keccak256(
    encodePacked(["uint256", "uint64", "uint256"], [BigInt(chainKey), BigInt(blockHeight), BigInt(txIndex)]),
  );
}

/** `ProvenSource.logIdOf`: the replay key (and `CreditHistory` borrow id) for one log of one proof. */
export function logIdOf(queryId: Hex, logIndex: bigint | number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [queryId, BigInt(logIndex)]));
}
