/**
 * Server-side discovery of a wallet's Aave V3 history and Ethereum-side repayments.
 *
 * Public Ethereum endpoints cap `eth_getLogs` ranges and send no CORS headers, so the browser asks
 * `/api/crosschain/*`, which walks the source chain in windows here. Discovery is only a
 * convenience: the proofs and every rule are checked again by the contracts on Creditcoin.
 */

import { getAddress, parseAbiItem, type Address, type Hex } from "viem";

import type { SourceChainKey } from "@/lib/chains";
import {
  AAVE_POOLS,
  REPAY_STABLECOINS,
  classifyAaveLog,
  classifyRepayTransfer,
  txLocalLogIndex,
  type AaveEvent,
  type RepayTransfer,
} from "@/lib/crosschain/core";
import { sourceClient } from "@/lib/relay/source";

const BORROW_EVENT = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);
const REPAY_EVENT = parseAbiItem(
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
);
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Ranges every endpoint in `sourceRpcUrls` accepts. */
const WINDOW = 49_999n;
const MAX_RECEIPTS = 40;

export function windows(from: bigint, to: bigint, size = WINDOW): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size + 1n) {
    const end = start + size > to ? to : start + size;
    out.push([start, end]);
  }
  return out;
}

type RawLog = { transactionHash: Hex | null; blockNumber: bigint | null; logIndex: number | null };

async function localIndexes(chainKey: SourceChainKey, logs: RawLog[]) {
  const client = sourceClient(chainKey);
  const hashes = [...new Set(logs.map((l) => l.transactionHash).filter((h): h is Hex => Boolean(h)))].slice(
    0,
    MAX_RECEIPTS,
  );
  const receipts = new Map(
    await Promise.all(
      hashes.map(async (hash) => [hash, await client.getTransactionReceipt({ hash })] as const),
    ),
  );
  return (log: RawLog): number | null => {
    const receipt = log.transactionHash ? receipts.get(log.transactionHash) : undefined;
    if (!receipt || log.logIndex === null) return null;
    return txLocalLogIndex(receipt.logs, log.logIndex);
  };
}

export async function scanAaveHistory(
  chainKey: SourceChainKey,
  wallet: Address,
  { lookbackBlocks = 200_000n }: { lookbackBlocks?: bigint } = {},
) {
  const client = sourceClient(chainKey);
  const pool = AAVE_POOLS[chainKey].pool;
  const head = await client.getBlockNumber();
  const fromBlock = head > lookbackBlocks ? head - lookbackBlocks : 0n;
  const who = getAddress(wallet);

  const borrows = [];
  const repays = [];
  for (const [from, to] of windows(fromBlock, head)) {
    const [b, r] = await Promise.all([
      client.getLogs({ address: pool, event: BORROW_EVENT, args: { onBehalfOf: who }, fromBlock: from, toBlock: to }),
      client.getLogs({ address: pool, event: REPAY_EVENT, args: { user: who }, fromBlock: from, toBlock: to }),
    ]);
    borrows.push(...b);
    repays.push(...r);
  }

  const all = [...borrows, ...repays];
  const indexOf = await localIndexes(chainKey, all);
  const events: AaveEvent[] = [];
  for (const log of all) {
    const logIndex = indexOf(log);
    if (logIndex === null || !log.transactionHash || log.blockNumber === null) continue;
    const event = classifyAaveLog(
      chainKey,
      { address: getAddress(log.address), topics: [...log.topics] as Hex[], data: log.data },
      { txHash: log.transactionHash, blockNumber: Number(log.blockNumber), logIndex },
    );
    if (event) events.push(event);
  }
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return { chainKey, pool, head: Number(head), fromBlock: Number(fromBlock), events };
}

export async function scanRepayTransfers(
  chainKey: SourceChainKey,
  wallet: Address,
  repayAddress: Address,
  { lookbackBlocks = 100_000n }: { lookbackBlocks?: bigint } = {},
) {
  const client = sourceClient(chainKey);
  const token = REPAY_STABLECOINS[chainKey];
  const head = await client.getBlockNumber();
  const fromBlock = head > lookbackBlocks ? head - lookbackBlocks : 0n;

  const logs = [];
  for (const [from, to] of windows(fromBlock, head)) {
    logs.push(
      ...(await client.getLogs({
        address: token.address,
        event: TRANSFER_EVENT,
        args: { from: getAddress(wallet), to: getAddress(repayAddress) },
        fromBlock: from,
        toBlock: to,
      })),
    );
  }

  const indexOf = await localIndexes(chainKey, logs);
  const transfers: RepayTransfer[] = [];
  for (const log of logs) {
    const logIndex = indexOf(log);
    if (logIndex === null || !log.transactionHash || log.blockNumber === null) continue;
    const t = classifyRepayTransfer(
      chainKey,
      { address: getAddress(log.address), topics: [...log.topics] as Hex[], data: log.data },
      repayAddress,
      { txHash: log.transactionHash, blockNumber: Number(log.blockNumber), logIndex },
    );
    if (t) transfers.push(t);
  }
  return { chainKey, token, head: Number(head), fromBlock: Number(fromBlock), transfers };
}
