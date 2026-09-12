// Local EvmV1 decoding and the off-chain replay of the AttestedWorldID guards, against the
// real proof fixtures. No network.
import { describe, expect, test } from "bun:test";
import { AbiCoder, getAddress, zeroPadValue } from "ethers";
import { resolve } from "node:path";
import {
  REPO_ROOT,
  SELECTOR_REGISTER_IDENTITIES,
  SOURCES,
  TREE_CHANGED_TOPIC,
} from "../src/config";
import {
  decodeEvmV1,
  decodeManagerCalldata,
  findTreeChangedLogs,
  inspectLocally,
  toHex32,
  type ReceiptFields,
} from "../src/evmv1";
import { readProofFile } from "../src/proofs";

const MAINNET = await readProofFile(
  resolve(REPO_ROOT, "contracts/test/fixtures/mainnet-0x81ece311.json"),
);
const SEPOLIA = await readProofFile(
  resolve(REPO_ROOT, "contracts/test/fixtures/sepolia-0x36678603.json"),
);

describe("decodeEvmV1", () => {
  test("decodes the mainnet transaction's common fields", () => {
    const d = decodeEvmV1(MAINNET.txBytes);
    expect(d.txType).toBe(2);
    expect(d.chunkCount).toBe(3);
    expect(d.common.to).toBe(getAddress(SOURCES.mainnet.manager));
    expect(d.common.toIsNull).toBe(false);
    expect(d.common.value).toBe(0n);
    expect(d.common.data.slice(0, 10)).toBe(SELECTOR_REGISTER_IDENTITIES);
    expect(d.common.gasLimit).toBe(2_000_000n);
  });

  test("decodes the receipt: status, gas and exactly one log", () => {
    const d = decodeEvmV1(MAINNET.txBytes);
    expect(d.receipt.status).toBe(1);
    expect(d.receipt.gasUsed).toBe(281_445n);
    expect(d.receipt.logs).toHaveLength(1);
    expect(d.receipt.logs[0]!.topics[0]).toBe(TREE_CHANGED_TOPIC);
    expect((d.receipt.logsBloom.length - 2) / 2).toBe(256);
  });

  test("decodes the sepolia staging transaction too", () => {
    const d = decodeEvmV1(SEPOLIA.txBytes);
    expect(d.common.to).toBe(getAddress(SOURCES.sepolia.manager));
    expect(d.receipt.status).toBe(1);
  });

  test("rejects a payload that is not EvmV1", () => {
    const junk = AbiCoder.defaultAbiCoder().encode(["uint8", "bytes[]"], [9, ["0x"]]);
    expect(() => decodeEvmV1(junk)).toThrow(/unsupported EvmV1 transaction type/);
  });

  test("rejects a payload with too few chunks", () => {
    const junk = AbiCoder.defaultAbiCoder().encode(["uint8", "bytes[]"], [2, ["0x"]]);
    expect(() => decodeEvmV1(junk)).toThrow(/malformed EvmV1 payload/);
  });
});

describe("findTreeChangedLogs", () => {
  const manager = getAddress(SOURCES.mainnet.manager);
  const topics = (pre: bigint, kind: number, post: bigint) => [
    TREE_CHANGED_TOPIC,
    toHex32(pre),
    toHex32(BigInt(kind)),
    toHex32(post),
  ];
  const receipt = (logs: ReceiptFields["logs"]): ReceiptFields => ({
    status: 1,
    gasUsed: 0n,
    logs,
    logsBloom: "0x",
  });

  test("finds the single TreeChanged emitted by the manager", () => {
    const found = findTreeChangedLogs(
      receipt([{ address: manager, topics: topics(1n, 0, 2n), data: "0x" }]),
      manager,
    );
    expect(found).toEqual([{ preRoot: 1n, kind: 0, postRoot: 2n }]);
  });

  test("skips a decoy TreeChanged from another contract", () => {
    const decoy = getAddress("0x000000000000000000000000000000000000dEaD");
    const found = findTreeChangedLogs(
      receipt([
        { address: decoy, topics: topics(99n, 0, 98n), data: "0x" },
        { address: manager, topics: topics(1n, 0, 2n), data: "0x" },
      ]),
      manager,
    );
    expect(found).toEqual([{ preRoot: 1n, kind: 0, postRoot: 2n }]);
  });

  test("ignores unrelated events from the manager", () => {
    const found = findTreeChangedLogs(
      receipt([{ address: manager, topics: [zeroPadValue("0x01", 32)], data: "0x" }]),
      manager,
    );
    expect(found).toEqual([]);
  });

  test("returns every match so the caller can reject ambiguity", () => {
    const found = findTreeChangedLogs(
      receipt([
        { address: manager, topics: topics(1n, 0, 2n), data: "0x" },
        { address: manager, topics: topics(2n, 0, 3n), data: "0x" },
      ]),
      manager,
    );
    expect(found).toHaveLength(2);
  });
});

describe("decodeManagerCalldata", () => {
  test("decodes registerIdentities: roots, commitment count and start index", () => {
    const call = decodeManagerCalldata(decodeEvmV1(MAINNET.txBytes).common.data);
    expect(call.kind).toBe("register");
    expect(call.selector).toBe(SELECTOR_REGISTER_IDENTITIES);
    expect(call.humansAdded).toBe(100);
    expect(call.startIndex).toBe(17_657_879);
    expect(toHex32(call.postRoot)).toBe(
      "0x076e5a82999293632c26b538386c61f5aca4b52d18a34848a8f1916d3d3bd622",
    );
  });

  test("decodes deleteIdentities and reports zero humans added", () => {
    const body = AbiCoder.defaultAbiCoder().encode(
      ["uint256[8]", "bytes", "uint256", "uint256"],
      [Array(8).fill(0n), "0x1234", 111n, 222n],
    );
    const call = decodeManagerCalldata(`0xea10fbbe${body.slice(2)}`);
    expect(call.kind).toBe("delete");
    expect(call.preRoot).toBe(111n);
    expect(call.postRoot).toBe(222n);
    expect(call.humansAdded).toBe(0);
  });

  test("rejects an unknown selector", () => {
    expect(() => decodeManagerCalldata("0xdeadbeef")).toThrow(/unknown identity-manager selector/);
  });
});

describe("inspectLocally", () => {
  test("every guard passes for the real mainnet transaction", () => {
    const ins = inspectLocally(MAINNET.txBytes, {
      chainKey: MAINNET.chainKey,
      sourceChainKey: SOURCES.mainnet.chainKey,
      manager: SOURCES.mainnet.manager,
    });
    expect(ins.ok).toBe(true);
    expect(ins.checks.filter((c) => !c.ok)).toEqual([]);
    expect(ins.call?.humansAdded).toBe(100);
    expect(ins.change?.kind).toBe(0);
    expect(ins.change!.preRoot).toBe(ins.call!.preRoot);
    expect(ins.change!.postRoot).toBe(ins.call!.postRoot);
  });

  test("every guard passes for the real sepolia transaction", () => {
    const ins = inspectLocally(SEPOLIA.txBytes, {
      chainKey: SEPOLIA.chainKey,
      sourceChainKey: SOURCES.sepolia.chainKey,
      manager: SOURCES.sepolia.manager,
    });
    expect(ins.ok).toBe(true);
    expect(ins.call?.humansAdded).toBe(100);
  });

  test("a mainnet proof presented as sepolia fails the chainKey guard", () => {
    const ins = inspectLocally(MAINNET.txBytes, {
      chainKey: MAINNET.chainKey,
      sourceChainKey: SOURCES.sepolia.chainKey,
      manager: SOURCES.mainnet.manager,
    });
    expect(ins.ok).toBe(false);
    expect(ins.checks.find((c) => c.name.includes("SOURCE_CHAIN_KEY"))!.ok).toBe(false);
  });

  test("the wrong identity manager fails both the `to` and TreeChanged guards", () => {
    const ins = inspectLocally(MAINNET.txBytes, {
      chainKey: MAINNET.chainKey,
      sourceChainKey: SOURCES.mainnet.chainKey,
      manager: SOURCES.sepolia.manager,
    });
    expect(ins.ok).toBe(false);
    const failed = ins.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("to == IDENTITY_MANAGER");
    expect(failed).toContain("exactly one TreeChanged from manager");
  });
});

describe("toHex32", () => {
  test("left-pads to 32 bytes", () => {
    expect(toHex32(1n)).toBe(`0x${"0".repeat(63)}1`);
    expect(toHex32(0n)).toBe(`0x${"0".repeat(64)}`);
  });
});
