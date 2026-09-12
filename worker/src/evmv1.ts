// Pure-TypeScript decoder for the Attestcoin EvmV1 transaction encoding, plus World ID
// calldata decoding. Mirrors @gluwa/asc-contracts EvmV1Decoder exactly, but needs no RPC:
// the worker can reproduce every on-chain guard locally before spending gas.
//
// Encoding (see @gluwa/usc-sdk encoding/abi/v1): abi.encode(uint8 txType, bytes[] chunks)
//   chunks[0]              = (uint64 nonce, uint64 gasLimit, address from, bool toIsNull,
//                             address to, uint256 value, bytes data)
//   chunks[last]           = (uint8 receiptStatus, uint64 receiptGasUsed,
//                             tuple(address,bytes32[],bytes)[] logs, bytes logsBloom)
//   chunks in between      = type-specific signature/fee fields (not needed here)
import { AbiCoder, getAddress } from "ethers";
import {
  SELECTOR_DELETE_IDENTITIES,
  SELECTOR_REGISTER_IDENTITIES,
  TREE_CHANGED_TOPIC,
} from "./config";

const coder = AbiCoder.defaultAbiCoder();

const COMMON_TYPES = ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"];
const RECEIPT_TYPES = ["uint8", "uint64", "tuple(address, bytes32[], bytes)[]", "bytes"];

export interface CommonTxFields {
  nonce: bigint;
  gasLimit: bigint;
  from: string;
  toIsNull: boolean;
  to: string;
  value: bigint;
  data: string;
}

export interface LogEntry {
  address: string;
  topics: string[];
  data: string;
}

export interface ReceiptFields {
  status: number;
  gasUsed: bigint;
  logs: LogEntry[];
  logsBloom: string;
}

export interface DecodedEvmV1 {
  txType: number;
  chunkCount: number;
  common: CommonTxFields;
  receipt: ReceiptFields;
}

export function decodeEvmV1(txBytes: string): DecodedEvmV1 {
  const [txTypeRaw, chunks] = coder.decode(["uint8", "bytes[]"], txBytes) as unknown as [
    bigint,
    string[],
  ];
  const txType = Number(txTypeRaw);
  if (txType > 4) throw new Error(`unsupported EvmV1 transaction type ${txType}`);
  if (chunks.length < 2) throw new Error(`malformed EvmV1 payload: ${chunks.length} chunks`);

  const c = coder.decode(COMMON_TYPES, chunks[0]!) as unknown as [
    bigint,
    bigint,
    string,
    boolean,
    string,
    bigint,
    string,
  ];
  const r = coder.decode(RECEIPT_TYPES, chunks[chunks.length - 1]!) as unknown as [
    bigint,
    bigint,
    Array<[string, string[], string]>,
    string,
  ];

  return {
    txType,
    chunkCount: chunks.length,
    common: {
      nonce: c[0],
      gasLimit: c[1],
      from: getAddress(c[2]),
      toIsNull: c[3],
      to: getAddress(c[4]),
      value: c[5],
      data: c[6],
    },
    receipt: {
      status: Number(r[0]),
      gasUsed: r[1],
      logs: r[2].map(([address, topics, data]) => ({
        address: getAddress(address),
        topics: [...topics],
        data,
      })),
      logsBloom: r[3],
    },
  };
}

// ---------------------------------------------------------------------------
// TreeChanged log
// ---------------------------------------------------------------------------

export interface TreeChange {
  preRoot: bigint;
  kind: number;
  postRoot: bigint;
}

/**
 * TreeChanged(uint256 indexed preRoot, uint8 indexed kind, uint256 indexed postRoot)
 * emitted by `emitter`. Foreign emitters are skipped, matching the contract (decoy-log defence).
 */
export function findTreeChangedLogs(receipt: ReceiptFields, emitter: string): TreeChange[] {
  const want = getAddress(emitter);
  const out: TreeChange[] = [];
  for (const log of receipt.logs) {
    if (log.address !== want) continue;
    if ((log.topics[0] ?? "").toLowerCase() !== TREE_CHANGED_TOPIC) continue;
    if (log.topics.length < 4) continue;
    out.push({
      preRoot: BigInt(log.topics[1]!),
      kind: Number(BigInt(log.topics[2]!)),
      postRoot: BigInt(log.topics[3]!),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// World ID identity-manager calldata
// ---------------------------------------------------------------------------

export interface ManagerCall {
  selector: string;
  kind: "register" | "delete";
  preRoot: bigint;
  postRoot: bigint;
  /** Identity commitments inserted; 0 for deletions. */
  humansAdded: number;
  startIndex?: number;
}

/**
 * registerIdentities(uint256[8] proof, uint256 preRoot, uint32 startIndex,
 *                    uint256[] identityCommitments, uint256 postRoot)  0x2217b211
 * deleteIdentities(uint256[8] proof, bytes packedDeletionIndices,
 *                  uint256 preRoot, uint256 postRoot)                  0xea10fbbe
 */
export function decodeManagerCalldata(data: string): ManagerCall {
  const selector = data.slice(0, 10).toLowerCase();
  const body = `0x${data.slice(10)}`;
  if (selector === SELECTOR_REGISTER_IDENTITIES) {
    const [, preRoot, startIndex, commitments, postRoot] = coder.decode(
      ["uint256[8]", "uint256", "uint32", "uint256[]", "uint256"],
      body,
    ) as unknown as [bigint[], bigint, bigint, bigint[], bigint];
    return {
      selector,
      kind: "register",
      preRoot,
      postRoot,
      humansAdded: commitments.length,
      startIndex: Number(startIndex),
    };
  }
  if (selector === SELECTOR_DELETE_IDENTITIES) {
    const [, , preRoot, postRoot] = coder.decode(
      ["uint256[8]", "bytes", "uint256", "uint256"],
      body,
    ) as unknown as [bigint[], string, bigint, bigint];
    return { selector, kind: "delete", preRoot, postRoot, humansAdded: 0 };
  }
  throw new Error(`unknown identity-manager selector ${selector}`);
}

// ---------------------------------------------------------------------------
// Full local replay of the AttestedWorldID guards
// ---------------------------------------------------------------------------

export interface GuardCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LocalInspection {
  decoded: DecodedEvmV1;
  call?: ManagerCall;
  change?: TreeChange;
  checks: GuardCheck[];
  ok: boolean;
}

/**
 * Replays the contract's checks 1-6 (source chain, status, emitter, single TreeChanged,
 * calldata-vs-log agreement) off-chain. Checks 7-9 (root chaining, finality, quorum) depend
 * on live chain state and are handled in relay.ts.
 */
export function inspectLocally(
  txBytes: string,
  opts: { chainKey: number; sourceChainKey: number; manager: string },
): LocalInspection {
  const checks: GuardCheck[] = [];
  const decoded = decodeEvmV1(txBytes);
  const manager = getAddress(opts.manager);

  checks.push({
    name: "chainKey == SOURCE_CHAIN_KEY",
    ok: opts.chainKey === opts.sourceChainKey,
    detail: `${opts.chainKey} vs ${opts.sourceChainKey}`,
  });
  checks.push({
    name: "receiptStatus == 1",
    ok: decoded.receipt.status === 1,
    detail: String(decoded.receipt.status),
  });
  checks.push({
    name: "to == IDENTITY_MANAGER",
    ok: !decoded.common.toIsNull && decoded.common.to === manager,
    detail: decoded.common.to,
  });

  const changes = findTreeChangedLogs(decoded.receipt, manager);
  checks.push({
    name: "exactly one TreeChanged from manager",
    ok: changes.length === 1,
    detail: `${changes.length} (of ${decoded.receipt.logs.length} logs)`,
  });

  let call: ManagerCall | undefined;
  try {
    call = decodeManagerCalldata(decoded.common.data);
    checks.push({ name: "known selector", ok: true, detail: `${call.selector} (${call.kind})` });
  } catch (e) {
    checks.push({ name: "known selector", ok: false, detail: (e as Error).message });
  }

  const change = changes.length === 1 ? changes[0] : undefined;
  if (change && call) {
    checks.push({
      name: "calldata preRoot == log preRoot",
      ok: call.preRoot === change.preRoot,
      detail: toHex32(change.preRoot),
    });
    checks.push({
      name: "calldata postRoot == log postRoot",
      ok: call.postRoot === change.postRoot,
      detail: toHex32(change.postRoot),
    });
  }

  return { decoded, call, change, checks, ok: checks.every((c) => c.ok) };
}

export function toHex32(v: bigint): string {
  return `0x${v.toString(16).padStart(64, "0")}`;
}
