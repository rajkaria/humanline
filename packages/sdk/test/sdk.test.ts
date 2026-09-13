import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toFunctionSelector, type Address } from "viem";

import {
  DEPLOYMENTS,
  creditLineAbi,
  deploymentOf,
  humanGatedAbi,
  humanHex,
  humanOf,
  humanRegistryAbi,
  isHuman,
  latestWorldIdRoot,
  lineOf,
  profileOf,
  registeredAt,
  shortHuman,
  walletOf,
  type Reader,
} from "../src/index";

const ALICE: Address = "0x00000000000000000000000000000000000a11ce";
const STRANGER: Address = "0x0000000000000000000000000000000000005a7a";
const HUMAN = 0x1234abcdn * 2n ** 200n + 42n;

type Call = { address: string; functionName: string; args?: readonly unknown[] };

/** A reader that answers like a tiny fake chain, and records every call. */
function fakeChain() {
  const calls: Call[] = [];
  const reader: Reader = {
    readContract: (async (req: Call) => {
      calls.push({ address: req.address, functionName: req.functionName, args: req.args });
      switch (req.functionName) {
        case "humanOf":
          return req.args?.[0] === ALICE ? HUMAN : 0n;
        case "walletOf":
          return req.args?.[0] === HUMAN ? ALICE : "0x0000000000000000000000000000000000000000";
        case "registeredAt":
          return 1_789_000_000n;
        case "lineOf":
          return { limit: 25_000_000n, principal: 10_100_000n, dueAt: 1_789_100_000n, openedAt: 1_789_000_500n, loansRepaid: 3, loansLate: 1, frozen: false };
        case "availableCredit":
          return 14_900_000n;
        case "isInDefault":
          return false;
        case "latestRoot":
          return 777n;
        case "rootHistory":
          return 1_789_000_900n;
        default:
          throw new Error(`unexpected ${req.functionName}`);
      }
    }) as unknown as Reader["readContract"],
  };
  return { reader, calls };
}

describe("reads", () => {
  test("isHuman and humanOf read the staging registry by default", async () => {
    const { reader, calls } = fakeChain();
    expect(await isHuman(reader, ALICE)).toBe(true);
    expect(await isHuman(reader, STRANGER)).toBe(false);
    expect(await humanOf(reader, ALICE)).toBe(HUMAN);
    expect(calls.every((c) => c.address === DEPLOYMENTS.staging.humanRegistry)).toBe(true);
  });

  test("a profile or explicit deployment picks the contracts", async () => {
    const { reader, calls } = fakeChain();
    await humanOf(reader, ALICE, { profile: "production" });
    expect(calls[0]!.address).toBe(DEPLOYMENTS.production.humanRegistry);
    const mine = { ...DEPLOYMENTS.staging, humanRegistry: "0x000000000000000000000000000000000000beef" as Address };
    await walletOf(reader, HUMAN, { deployment: mine });
    expect(calls[1]!.address).toBe(mine.humanRegistry);
    expect(deploymentOf()).toBe(DEPLOYMENTS.staging);
  });

  test("walletOf and registeredAt", async () => {
    const { reader } = fakeChain();
    expect(await walletOf(reader, HUMAN)).toBe(ALICE);
    expect(await registeredAt(reader, HUMAN)).toBe(1_789_000_000n);
  });

  test("lineOf combines the line, available credit and default status", async () => {
    const { reader, calls } = fakeChain();
    const line = await lineOf(reader, HUMAN);
    expect(line).toEqual({
      limit: 25_000_000n,
      principal: 10_100_000n,
      dueAt: 1_789_100_000n,
      openedAt: 1_789_000_500n,
      loansRepaid: 3,
      loansLate: 1,
      frozen: false,
      exists: true,
      available: 14_900_000n,
      inDefault: false,
    });
    expect(calls.map((c) => c.address)).toEqual(Array(3).fill(DEPLOYMENTS.staging.creditLine));
  });

  test("profileOf skips the line for a wallet that is not a human", async () => {
    const { reader, calls } = fakeChain();
    expect(await profileOf(reader, STRANGER)).toEqual({ wallet: STRANGER, isHuman: false, human: 0n, registeredAt: 0n });
    expect(calls).toHaveLength(1);
    const alice = await profileOf(reader, ALICE);
    expect(alice.isHuman).toBe(true);
    expect(alice.line?.available).toBe(14_900_000n);
  });

  test("latestWorldIdRoot reads the relay the registry trusts", async () => {
    const { reader, calls } = fakeChain();
    expect(await latestWorldIdRoot(reader)).toEqual({ root: 777n, receivedAt: 1_789_000_900n });
    expect(calls[0]!.address).toBe(DEPLOYMENTS.staging.worldIdRoots);
  });
});

describe("formatting", () => {
  test("shortHuman is the first 12 hex digits of the 32-byte nullifier", () => {
    expect(shortHuman(HUMAN)).toBe(humanHex(HUMAN).slice(2, 14));
    expect(shortHuman(1n)).toBe("000000000000");
    expect(humanHex(1n)).toBe(`0x${"0".repeat(63)}1`);
  });
});

describe("ABIs and the Solidity helper", () => {
  test("selectors match the deployed contracts' signatures", () => {
    const sel = (abi: readonly { type: string; name?: string }[], name: string) => {
      const item = abi.find((i) => i.type === "function" && i.name === name);
      return toFunctionSelector(item as never);
    };
    expect(sel(humanRegistryAbi, "humanOf")).toBe(toFunctionSelector("humanOf(address)"));
    expect(sel(humanRegistryAbi, "register")).toBe(toFunctionSelector("register(uint256,uint256,uint256[8])"));
    expect(sel(creditLineAbi, "availableCredit")).toBe(toFunctionSelector("availableCredit(uint256)"));
    expect(sel(humanGatedAbi, "usedBy")).toBe(toFunctionSelector("usedBy(bytes32,uint256)"));
  });

  test("the packaged HumanGated.sol is the tested one from contracts/src/sdk", () => {
    const repo = join(import.meta.dir, "..", "..", "..");
    const tested = readFileSync(join(repo, "contracts/src/sdk/HumanGated.sol"), "utf8");
    const packaged = readFileSync(join(import.meta.dir, "..", "contracts/HumanGated.sol"), "utf8");
    expect(packaged).toBe(tested.replace('"../interfaces/IHumanRegistry.sol"', '"./IHumanRegistry.sol"'));
    expect(readFileSync(join(import.meta.dir, "..", "contracts/IHumanRegistry.sol"), "utf8")).toBe(
      readFileSync(join(repo, "contracts/src/interfaces/IHumanRegistry.sol"), "utf8"),
    );
  });

  test("the staging and production deployments are the ones in deployments/", () => {
    const repo = join(import.meta.dir, "..", "..", "..");
    const staging = JSON.parse(readFileSync(join(repo, "deployments/cc3-testnet.json"), "utf8")).contracts;
    const production = JSON.parse(readFileSync(join(repo, "deployments/cc3-testnet.production.json"), "utf8")).contracts;
    for (const [profile, c] of [["staging", staging], ["production", production]] as const) {
      const d = DEPLOYMENTS[profile];
      expect(d.humanRegistry).toBe(c.HumanRegistry.toLowerCase());
      expect(d.creditLine).toBe(c.CreditLine.toLowerCase());
      expect(d.humanGate).toBe(c.HumanGate.toLowerCase());
      expect(d.husd).toBe(c.HUSD.toLowerCase());
    }
    expect(DEPLOYMENTS.staging.worldIdRoots).toBe(staging.AttestedWorldIDSepolia.toLowerCase());
    expect(DEPLOYMENTS.production.worldIdRoots).toBe(production.AttestedWorldIDMainnet.toLowerCase());
  });
});
