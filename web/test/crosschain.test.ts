/**
 * Cross-chain credit identity helpers, against the same real Sepolia proofs the Foundry suites use:
 * an Aave V3 borrow (120 USDC), its repayment (85.231495 USDC, 82,941 blocks later) and a Circle
 * USDC transfer. If the proof builder's shape or the contracts' rules drift, this fails before a
 * wallet is asked to sign.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, hashTypedData, keccak256, recoverTypedDataAddress, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { creditHistoryAbi, ethRepayAbi, humanLinksAbi } from "@/lib/abi";
import {
  AAVE_POOLS,
  LINK_MARKER,
  boostFor,
  classifyAaveLog,
  classifyRepayTransfer,
  decodeTxBytes,
  findLogIndex,
  jsonSafe,
  linkIntentData,
  linkTypedData,
  logIdOf,
  pairHistory,
  parseLinkIntent,
  queryIdOf,
  sourceProofFromJson,
  toUsd,
  txLocalLogIndex,
  type AaveEvent,
} from "@/lib/crosschain/core";
import type { SingleProofJson } from "@/lib/relay/proof";

const FIXTURES = join(import.meta.dir, "..", "..", "contracts", "test", "fixtures");
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as SingleProofJson;
const borrowJson = load("sepolia-aave-borrow-0xe4723adf.json");
const repayJson = load("sepolia-aave-repay-0xf3770ee1.json");
const transferJson = load("sepolia-usdc-transfer-0x2e34a903.json");

const BORROWER = "0x2D39338894D7D3Be4908d6fbfc3500440C788F01";
const USDC_RESERVE = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";
const LINKS = "0x00000000000000000000000000000000000011a5" as const;
const CC_WALLET = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3" as const;
const HUMAN = 3093433769130030722812123746091352808913071447442240373851062897109625321172n;

describe("link intents", () => {
  test("the marker is the selector of humanlineLink(uint256,address,uint256,address)", () => {
    expect(LINK_MARKER).toBe(keccak256(toBytes("humanlineLink(uint256,address,uint256,address)")).slice(0, 10) as Hex);
  });

  test("an intent is exactly 132 bytes and round-trips", () => {
    const data = linkIntentData({ human: HUMAN, creditcoinWallet: CC_WALLET, creditcoinChainId: 102031, links: LINKS });
    expect((data.length - 2) / 2).toBe(132);
    expect(parseLinkIntent(data)).toEqual({
      human: HUMAN,
      creditcoinWallet: CC_WALLET,
      creditcoinChainId: 102031,
      links: LINKS,
    });
  });

  test("anything else is not an intent", () => {
    const data = linkIntentData({ human: 1n, creditcoinWallet: CC_WALLET, creditcoinChainId: 102031, links: LINKS });
    expect(parseLinkIntent(`0xdeadbeef${data.slice(10)}`)).toBeNull();
    expect(parseLinkIntent(`${data}00`)).toBeNull();
    expect(parseLinkIntent("0x")).toBeNull();
  });
});

describe("EIP-712 link signatures", () => {
  test("a wallet's signature recovers to that wallet, and the digest is bound to chain and contract", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const typed = linkTypedData({
      links: LINKS,
      chainId: 102031,
      human: HUMAN,
      creditcoinWallet: CC_WALLET,
      wallet: account.address,
      deadline: 1_900_000_000n,
    });
    const signature = await account.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(account.address);

    const digest = hashTypedData(typed);
    expect(hashTypedData(linkTypedData({ ...typed.message, links: LINKS, chainId: 102030 }))).not.toBe(digest);
    expect(
      hashTypedData(linkTypedData({ ...typed.message, links: "0x00000000000000000000000000000000000011a6", chainId: 102031 })),
    ).not.toBe(digest);
  });
});

describe("proof builder JSON → SourceProof", () => {
  test("every fixture becomes a struct the contracts' ABIs encode", () => {
    for (const json of [borrowJson, repayJson, transferJson]) {
      const proof = sourceProofFromJson(json, json.txHash);
      expect(proof.chainKey).toBe(1n);
      expect(proof.blockHeight).toBe(BigInt(json.headerNumber));
      expect(proof.encodedTransaction).toBe(json.txBytes.toLowerCase() as Hex);
      expect(proof.continuityProof.roots.length).toBe(json.continuityProof.roots.length);
    }
    const repay = sourceProofFromJson(repayJson);
    const borrowId = logIdOf(queryIdOf(1, borrowJson.headerNumber, borrowJson.txIndex), 4);
    expect(encodeFunctionData({ abi: creditHistoryAbi, functionName: "proveRepay", args: [repay, 6n, borrowId] })).toMatch(/^0x/);
    expect(
      encodeFunctionData({ abi: ethRepayAbi, functionName: "creditRepayment", args: [sourceProofFromJson(transferJson), 0n] }),
    ).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: humanLinksAbi, functionName: "linkBySourceTx", args: [repay] })).toMatch(/^0x/);
  });

  test("a proof for another transaction is refused", () => {
    expect(() => sourceProofFromJson(repayJson, borrowJson.txHash)).toThrow(/missing/);
  });
});

describe("EvmV1 receipts", () => {
  test("decodes the common fields and status of a real type-2 transaction", () => {
    const tx = decodeTxBytes(borrowJson.txBytes as Hex);
    expect(tx.txType).toBe(2);
    expect(tx.from).toBe(BORROWER);
    expect(tx.to).toBe(AAVE_POOLS[1].pool);
    expect(tx.status).toBe(1);
    expect(tx.logs.length).toBe(5);
  });

  test("the borrow's log 4 is Aave's Borrow of 120 USDC for the sender itself", () => {
    const tx = decodeTxBytes(borrowJson.txBytes as Hex);
    const index = findLogIndex(borrowJson.txBytes as Hex, (l) => l.topics[0] === "0xb3d084820fb1a9decffb176436bd02558d15fac9b0ddfed8c465bc7359d7dce0");
    expect(index).toBe(4);
    const event = classifyAaveLog(1, tx.logs[4]!, { txHash: borrowJson.txHash as Hex, blockNumber: borrowJson.headerNumber, logIndex: 4 });
    expect(event).toMatchObject({ kind: "borrow", wallet: BORROWER, reserve: USDC_RESERVE, amount: 120_000_000n, eligible: true });
    expect(classifyAaveLog(1, tx.logs[3]!, { txHash: "0x", blockNumber: 0, logIndex: 3 })).toBeNull();
  });

  test("the repayment's log 6 is Aave's Repay of 85.231495 USDC by the borrower", () => {
    const tx = decodeTxBytes(repayJson.txBytes as Hex);
    const event = classifyAaveLog(1, tx.logs[6]!, { txHash: repayJson.txHash as Hex, blockNumber: repayJson.headerNumber, logIndex: 6 });
    expect(event).toMatchObject({ kind: "repay", wallet: BORROWER, amount: 85_231_495n, eligible: true });
  });

  test("the rules the contract applies are mirrored", () => {
    const tx = decodeTxBytes(repayJson.txBytes as Hex);
    const log = tx.logs[6]!;
    const meta = { txHash: "0x" as Hex, blockNumber: 1, logIndex: 6 };
    const other = `0x${"00".repeat(12)}${"ab".repeat(20)}` as Hex;
    expect(classifyAaveLog(1, { ...log, topics: [log.topics[0]!, log.topics[1]!, log.topics[2]!, other] }, meta)?.reason).toMatch(/another address/);
    expect(classifyAaveLog(1, { ...log, data: `${log.data.slice(0, 66)}${"0".repeat(63)}1` as Hex }, meta)?.reason).toMatch(/aTokens/);
    expect(classifyAaveLog(1, { ...log, topics: [log.topics[0]!, other, log.topics[2]!, log.topics[3]!] }, meta)?.eligible).toBe(false);
    expect(classifyAaveLog(3, log, meta)).toBeNull();
  });

  test("the USDC transfer is a repayment only to the configured address", () => {
    const tx = decodeTxBytes(transferJson.txBytes as Hex);
    const meta = { txHash: transferJson.txHash as Hex, blockNumber: transferJson.headerNumber, logIndex: 0 };
    expect(classifyRepayTransfer(1, tx.logs[0]!, "0x139BF28F2b65Ab6DdF005dc248E1D63b1ea3764B", meta)).toMatchObject({
      from: "0x6dBe810e3314546009bD6e1B29f9031211CdA5d2",
      value: 10_000n,
    });
    expect(classifyRepayTransfer(1, tx.logs[0]!, CC_WALLET, meta)).toBeNull();
    expect(classifyRepayTransfer(3, tx.logs[0]!, "0x139BF28F2b65Ab6DdF005dc248E1D63b1ea3764B", meta)).toBeNull();
  });

  test("receipt-local log index from block-wide indexes", () => {
    expect(txLocalLogIndex([{ logIndex: 90 }, { logIndex: 91 }, { logIndex: 92n }], 92)).toBe(2);
    expect(() => txLocalLogIndex([{ logIndex: 1 }], 7)).toThrow();
  });
});

describe("replay keys", () => {
  test("queryIdOf packs chainKey (32) ‖ height (8) ‖ txIndex (32) like ProvenSource", () => {
    const manual = keccak256(
      `0x${(1).toString(16).padStart(64, "0")}${repayJson.headerNumber.toString(16).padStart(16, "0")}${repayJson.txIndex
        .toString(16)
        .padStart(64, "0")}`,
    );
    expect(queryIdOf(1, repayJson.headerNumber, repayJson.txIndex)).toBe(manual);
    expect(logIdOf(manual, 6)).not.toBe(logIdOf(manual, 5));
  });
});

describe("history pairing", () => {
  const ev = (kind: "borrow" | "repay", blockNumber: number, amount: bigint, extra: Partial<AaveEvent> = {}): AaveEvent => ({
    kind,
    txHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    blockNumber,
    logIndex: 0,
    wallet: BORROWER,
    reserve: USDC_RESERVE,
    token: AAVE_POOLS[1].reserves[0],
    amount,
    eligible: true,
    ...extra,
  });

  test("the real sequence: 120 borrowed, 50 then 85.23 repaid, credits 50 then the 70 left", () => {
    const { pairs, unmatched } = pairHistory(
      [ev("repay", 11_690_827, 85_231_495n), ev("borrow", 11_607_886, 120_000_000n), ev("repay", 11_688_302, 50_000_000n)],
      7_200,
    );
    expect(pairs.map((p) => p.credited)).toEqual([50_000_000n, 70_000_000n]);
    expect(pairs.map((p) => p.creditedUsd)).toEqual([50_000_000n, 70_000_000n]);
    expect(unmatched).toEqual([]);
  });

  test("too soon, other reserve, other wallet or ineligible never pair", () => {
    const { pairs, unmatched } = pairHistory(
      [
        ev("borrow", 100, 10n),
        ev("repay", 150, 10n),
        ev("repay", 20_000, 10n, { reserve: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357" }),
        ev("repay", 20_001, 10n, { wallet: CC_WALLET }),
        ev("repay", 20_002, 10n, { eligible: false }),
      ],
      7_200,
    );
    expect(pairs).toEqual([]);
    expect(unmatched.length).toBe(3);
  });

  test("dollars and boost match CreditHistory", () => {
    expect(toUsd(200n * 10n ** 18n, 18)).toBe(200_000_000n);
    expect(toUsd(5n, 2)).toBe(50_000n);
    expect(boostFor(85_231_495n, 2_500n, 500_000_000n)).toBe(21_307_873n);
    expect(boostFor(10n ** 30n, 2_500n, 500_000_000n)).toBe(500_000_000n);
  });

  test("API payloads carry bigints as strings", () => {
    expect(jsonSafe({ a: 1n, b: [2n] })).toEqual({ a: "1", b: ["2"] });
  });
});
