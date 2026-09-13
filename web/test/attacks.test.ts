/**
 * The live-attack builders, against the real proof fixtures and with no network: every attack
 * encodes the call it claims to, the decoy log really lands in the receipt, the bytecode patch
 * changes exactly the immutable it targets, and refusals decode to their names.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, encodeErrorResult, encodeAbiParameters, type Hex } from "viem";

import { attestedWorldIdAbi, humanRegistryAbi } from "@/lib/abi";
import {
  CONTINUITY_REFUSAL,
  DECOY_EMITTER,
  IMPOSSIBLE_FLOOR,
  MERKLE_REFUSAL,
  SCRATCH_ADDRESS,
  classify,
  decodeRefusal,
  forgeSibling,
  injectDecoyLog,
  patchPush32,
  planAttacks,
  receiptLogCount,
  repeated,
  revertDataOf,
  type AttackInputs,
} from "@/lib/attacks/core";
import { normalizeSingle, toExecuteBatchArgs, type SingleProofJson } from "@/lib/relay/proof";

const FIXTURES = join(import.meta.dir, "..", "..", "contracts", "test", "fixtures");
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as SingleProofJson;

const relayed = load("sepolia-0x36678603.json");
const foreign = load("sepolia-usdc-transfer-0x2e34a903.json");

const inputs: AttackInputs = {
  generatedAt: "2026-09-13T00:00:00.000Z",
  sepoliaRelay: "0x3a7c3cc67034197208923587b8dc5c4674cbcef7",
  mainnetRelay: "0x1122ef3fa4ab0693809e42a00b2476efcf4468ad",
  registry: "0x62c2fd99ea587e4b466175ad248468782bd5298d",
  relayed,
  foreign,
  reverted: load("sepolia-aave-borrow-0xe4723adf.json"),
  stale: load("sepolia-aave-repay-0xf3770ee1.json"),
  registered: { wallet: "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3", nullifierHash: "42" },
};

const decodeBatch = (data: Hex) => {
  const decoded = decodeFunctionData({ abi: attestedWorldIdAbi, data });
  expect(decoded.functionName).toBe("executeBatch");
  return decoded.args as unknown as readonly [bigint, readonly bigint[], readonly Hex[], readonly { root: Hex; siblings: { hash: Hex; isLeft: boolean }[] }[], unknown];
};

describe("planAttacks", () => {
  const plans = planAttacks(inputs, { attestedTip: 11_700_000n, patchedCode: "0x6000" });
  const byId = Object.fromEntries(plans.map((p) => [p.id, p]));

  test("fires exactly the twelve named attacks, each with a call and an expected refusal", () => {
    expect(plans.map((p) => p.id)).toEqual([
      "forged-proof",
      "wrong-emitter",
      "reverted-receipt",
      "replay",
      "out-of-order",
      "unattested-height",
      "below-attestor-floor",
      "wrong-chain-key",
      "decoy-tree-changed",
      "oversize-batch",
      "stale-root",
      "double-registration",
    ]);
    for (const p of plans) {
      expect(p.call).toBeDefined();
      expect(p.expect.length).toBeGreaterThan(0);
    }
  });

  test("the forged proof differs from the real one in exactly one sibling byte", () => {
    const real = toExecuteBatchArgs(normalizeSingle(relayed));
    const [, , , merkles] = decodeBatch(byId["forged-proof"]!.call!.data);
    const a = real[3][0]!.siblings[0]!.hash;
    const b = merkles[0]!.siblings[0]!.hash;
    expect(a.slice(0, -2)).toBe(b.slice(0, -2));
    expect(a).not.toBe(b);
    expect(merkles[0]!.siblings.slice(1)).toEqual(real[3][0]!.siblings.slice(1));
  });

  test("out-of-order really descends, and the oversize batch really has eleven members", () => {
    const [, heights] = decodeBatch(byId["out-of-order"]!.call!.data);
    expect(heights.length).toBe(2);
    expect(heights[0]! > heights[1]!).toBe(true);
    const [, big] = decodeBatch(byId["oversize-batch"]!.call!.data);
    expect(big.length).toBe(11);
  });

  test("the unattested attack claims a height past the attested tip", () => {
    const [, heights] = decodeBatch(byId["unattested-height"]!.call!.data);
    expect(heights[0]).toBe(11_710_000n);
  });

  test("wrong chain key targets the mainnet relay; the attestor-floor attack runs at the scratch copy", () => {
    expect(byId["wrong-chain-key"]!.call!.to).toBe(inputs.mainnetRelay);
    const floor = byId["below-attestor-floor"]!.call!;
    expect(floor.to).toBe(SCRATCH_ADDRESS);
    expect(floor.stateOverride).toEqual([{ address: SCRATCH_ADDRESS, code: "0x6000" }]);
  });

  test("double registration is sent from the registered wallet with its own nullifier", () => {
    const call = byId["double-registration"]!.call!;
    expect(call.from).toBe(inputs.registered!.wallet);
    const decoded = decodeFunctionData({ abi: humanRegistryAbi, data: call.data });
    expect(decoded.functionName).toBe("register");
    expect((decoded.args as readonly unknown[])[1]).toBe(42n);
  });

  test("attacks whose inputs were not discovered are skipped, not faked", () => {
    const bare = planAttacks({ ...inputs, reverted: undefined, stale: undefined, registered: undefined }, { attestedTip: 1n });
    const skipped = bare.filter((p) => !p.call).map((p) => p.id);
    expect(skipped).toEqual(["reverted-receipt", "below-attestor-floor", "stale-root", "double-registration"]);
  });
});

describe("decoy log", () => {
  test("adds one TreeChanged log from the decoy emitter and keeps the transaction decodable", () => {
    const before = receiptLogCount(relayed.txBytes as Hex);
    const decoyed = injectDecoyLog(relayed.txBytes as Hex);
    expect(receiptLogCount(decoyed)).toBe(before + 1);
    expect(decoyed.toLowerCase()).toContain(DECOY_EMITTER.slice(2).toLowerCase());
  });
});

describe("patchPush32", () => {
  const word = (v: bigint) => `7f${v.toString(16).padStart(64, "0")}`;

  test("replaces every PUSH32 of the value, and nothing else", () => {
    const code = `0x60016000${word(3n)}5b${word(32n)}${word(3n)}00` as Hex;
    const out = patchPush32(code, 3n, IMPOSSIBLE_FLOOR);
    expect(out.replaced).toBe(2);
    expect(out.code).toBe(`0x60016000${word(IMPOSSIBLE_FLOOR)}5b${word(32n)}${word(IMPOSSIBLE_FLOOR)}00`);
  });

  test("ignores a match that is not aligned to a byte boundary", () => {
    const code = `0x0${word(3n)}0` as Hex;
    expect(patchPush32(code, 3n, 9n).replaced).toBe(0);
  });
});

describe("refusal decoding", () => {
  test("custom errors decode to their names and arguments", () => {
    const data = encodeErrorResult({ abi: attestedWorldIdAbi, errorName: "BatchTooLarge", args: [11n] });
    expect(decodeRefusal(data)).toEqual({ name: "BatchTooLarge", args: ["11"] });
  });

  test("the precompile's Error(string) decodes to its message", () => {
    const data = `0x08c379a0${encodeAbiParameters([{ type: "string" }], ["Merkle proof validation failed"]).slice(2)}` as Hex;
    expect(decodeRefusal(data)?.name).toBe(MERKLE_REFUSAL);
    expect(CONTINUITY_REFUSAL).toStartWith("Error: ");
  });

  test("unknown selectors and empty data are reported, not guessed", () => {
    expect(decodeRefusal("0xdeadbeef")?.name).toBe("unknown(0xdeadbeef)");
    expect(decodeRefusal("0x")).toBeUndefined();
  });

  test("an unexpected error is classified as the wrong refusal", () => {
    const plan = { id: "x", title: "x", threat: "x", expect: ["BatchTooLarge"] };
    expect(classify(plan, { name: "BatchTooLarge" })).toBe("refused");
    expect(classify(plan, { name: "EmptyBatch" })).toBe("wrong-error");
    expect(classify(plan, undefined)).toBe("wrong-error");
  });

  test("revert data is found anywhere in a viem error's cause chain", () => {
    expect(revertDataOf({ cause: { cause: { data: "0x1234" } } })).toBe("0x1234");
    expect(revertDataOf({ cause: { data: { data: "0xabcd" } } })).toBe("0xabcd");
    expect(revertDataOf(new Error("no data"))).toBeUndefined();
  });

  test("helpers refuse inputs they cannot attack", () => {
    expect(() => forgeSibling([1n, [], [], [], { lowerEndpointDigest: "0x", roots: [] }] as never)).toThrow();
    expect(repeated(relayed, 3)[1].length).toBe(3);
  });
});
