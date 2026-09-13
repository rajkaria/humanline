import { describe, expect, test } from "bun:test";
import type { Address } from "viem";

import {
  ApiError,
  CORS_HEADERS,
  errorBody,
  parseAddress,
  parseNullifier,
  parseProfile,
  readHuman,
  readLineResponse,
  type Reader,
} from "@/lib/api/v1";
import { PROFILES } from "@/lib/profiles";

const ALICE: Address = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3";
const STRANGER: Address = "0x0000000000000000000000000000000000005A7A";
const HUMAN = 2n ** 250n + 7n;

function fakeChain(opts: { openedAt?: bigint } = {}) {
  const calls: Array<{ address: string; functionName: string }> = [];
  const reader = {
    readContract: async (req: { address: string; functionName: string; args?: readonly unknown[] }) => {
      calls.push({ address: req.address, functionName: req.functionName });
      switch (req.functionName) {
        case "humanOf":
          return req.args?.[0] === ALICE ? HUMAN : 0n;
        case "registeredAt":
          return 1_789_204_300n;
        case "walletOf":
          return req.args?.[0] === HUMAN ? ALICE : "0x0000000000000000000000000000000000000000";
        case "lineOf":
          return { limit: 25_000_000n, principal: 0n, dueAt: 0n, openedAt: opts.openedAt ?? 1_789_204_400n, loansRepaid: 2, loansLate: 0, frozen: false };
        case "availableCredit":
          return 25_000_000n;
        case "isInDefault":
          return false;
        default:
          throw new Error(`unexpected ${req.functionName}`);
      }
    },
  } as unknown as Reader;
  return { reader, calls };
}

describe("parsing", () => {
  test("profiles", () => {
    expect(parseProfile(null)).toBe("demo");
    expect(parseProfile("staging")).toBe("demo");
    expect(parseProfile("demo")).toBe("demo");
    expect(parseProfile("production")).toBe("production");
    expect(() => parseProfile("mainnet")).toThrow(ApiError);
  });

  test("addresses are checksummed, garbage refused", () => {
    expect(parseAddress(ALICE.toLowerCase())).toBe(ALICE);
    expect(() => parseAddress("0x1234")).toThrow("not an EVM address");
  });

  test("nullifiers in decimal or hex, never zero or oversized", () => {
    expect(parseNullifier("42")).toBe(42n);
    expect(parseNullifier("0x2a")).toBe(42n);
    expect(parseNullifier(`0x${"f".repeat(64)}`)).toBe(2n ** 256n - 1n);
    expect(() => parseNullifier("0")).toThrow("out of range");
    expect(() => parseNullifier(`0x${"f".repeat(65)}`)).toThrow(ApiError);
    expect(() => parseNullifier("9".repeat(79))).toThrow(ApiError);
    expect(() => parseNullifier("12abc")).toThrow(ApiError);
  });
});

describe("readHuman", () => {
  test("a verified human, with registration date and credit line, from the staging contracts", async () => {
    const { reader, calls } = fakeChain();
    const body = await readHuman(reader, "demo", ALICE);
    expect(body).toEqual({
      version: "1.0.0",
      profile: "staging",
      address: ALICE,
      registry: PROFILES.demo.deployment.contracts.humanRegistry.address!,
      isHuman: true,
      nullifier: `0x${HUMAN.toString(16).padStart(64, "0")}`,
      registeredAt: 1_789_204_300,
      line: {
        exists: true,
        limit: "25000000",
        principal: "0",
        available: "25000000",
        dueAt: null,
        openedAt: 1_789_204_400,
        loansRepaid: 2,
        loansLate: 0,
        frozen: false,
        inDefault: false,
        decimals: 6,
      },
    });
    expect(calls[0]!.address).toBe(PROFILES.demo.deployment.contracts.humanRegistry.address!);
    expect(calls.filter((c) => c.address === PROFILES.demo.deployment.contracts.creditLine.address).length).toBe(3);
  });

  test("a wallet that is not a human reads the registry once and returns nulls", async () => {
    const { reader, calls } = fakeChain();
    const body = await readHuman(reader, "production", STRANGER);
    expect(body.isHuman).toBe(false);
    expect(body.profile).toBe("production");
    expect(body.nullifier).toBeNull();
    expect(body.line).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.address).toBe(PROFILES.production.deployment.contracts.humanRegistry.address!);
  });
});

describe("readLineResponse", () => {
  test("a line by nullifier, with the wallet the human holds today", async () => {
    const { reader } = fakeChain();
    const body = await readLineResponse(reader, "demo", HUMAN);
    expect(body.wallet).toBe(ALICE);
    expect(body.line.available).toBe("25000000");
    expect(body.creditLine).toBe(PROFILES.demo.deployment.contracts.creditLine.address!);
  });

  test("an unknown nullifier has no wallet and no line", async () => {
    const { reader } = fakeChain({ openedAt: 0n });
    const body = await readLineResponse(reader, "demo", 99n);
    expect(body.wallet).toBeNull();
    expect(body.line.exists).toBe(false);
    expect(body.line.openedAt).toBeNull();
  });
});

describe("errors and headers", () => {
  test("API errors keep their status; chain failures are 502", () => {
    expect(errorBody(new ApiError(400, "bad_address", "nope"))).toEqual({ status: 400, body: { error: "bad_address", message: "nope" } });
    expect(errorBody(new Error("rpc down")).status).toBe(502);
  });

  test("CORS is open for GET", () => {
    expect(CORS_HEADERS["access-control-allow-origin"]).toBe("*");
    expect(CORS_HEADERS["access-control-allow-methods"]).toContain("GET");
  });
});
