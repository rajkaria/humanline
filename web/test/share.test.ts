import { describe, expect, test } from "bun:test";

import { PROFILES } from "@/lib/profiles";
import { findHumans, isShort, shortOf, SHORT_LENGTH } from "@/lib/share";

const ALICE = 0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4n;
const SMALL = 5n; // pads with zeros

describe("short ids", () => {
  test("are the first 12 hex digits of the 32-byte nullifier", () => {
    expect(shortOf(ALICE)).toBe("06d6d24ba1cb");
    expect(shortOf(SMALL)).toBe("000000000000");
    expect(SHORT_LENGTH).toBe(12);
  });

  test("only lowercase 12-digit hex is a share id", () => {
    expect(isShort("06d6d24ba1cb")).toBe(true);
    expect(isShort("06D6D24BA1CB")).toBe(false);
    expect(isShort("06d6d24ba1c")).toBe(false);
    expect(isShort("zzzzzzzzzzzz")).toBe(false);
  });
});

describe("findHumans", () => {
  function fakeClient(humansByRegistry: Record<string, bigint[]>) {
    const scanned: Array<{ address: string; from: bigint; to: bigint }> = [];
    const client = {
      getBlockNumber: async () => 12_000n,
      getTransactionReceipt: async () => ({ blockNumber: 1_000n }),
      getContractEvents: async (req: { address: string; fromBlock: bigint; toBlock: bigint }) => {
        scanned.push({ address: req.address, from: req.fromBlock, to: req.toBlock });
        if (req.fromBlock !== 1_000n) return [];
        return (humansByRegistry[req.address] ?? []).map((h) => ({ args: { nullifierHash: h }, blockNumber: 1_234n }));
      },
      readContract: async () => "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3",
    };
    return { client: client as never, scanned };
  }

  test("finds a human on the deployment that registered them, and nothing for a bad id", async () => {
    const demoRegistry = PROFILES.demo.deployment.contracts.humanRegistry.address!;
    const { client, scanned } = fakeClient({ [demoRegistry]: [SMALL, ALICE, ALICE] });
    const found = await findHumans(client, "06d6d24ba1cb");
    expect(found).toEqual([{ profile: "demo", human: ALICE, wallet: "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3", block: 1_234n }]);
    expect(scanned.every((s) => s.to - s.from < 5_000n)).toBe(true);
    expect(await findHumans(client, "not-an-id")).toEqual([]);
  });
});
