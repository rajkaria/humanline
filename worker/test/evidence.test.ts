// Evidence line formatting and the append-only JSONL file. No network.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvidence,
  formatEvidenceLine,
  readEvidence,
  serializeEvidenceLine,
  type EvidenceInput,
} from "../src/evidence";

const input: EvidenceInput = {
  source: "sepolia",
  txHash: "0x366786038986B2F9E70E1FC1B2BE3A419B7A4A3EF36732ED48BCD4083D058BB7",
  sourceBlock: 11687163,
  txIndex: 58,
  preRoot: 0x09e09348765ae00461fc21703be4eeb90ee2dd609333eac7e602e5cf87d47e00n,
  postRoot: 0x015122d3271d322ae4f7d4f7ee4ec1bb72de9567143c03ba6ba1462e920e259fn,
  kind: 0,
  humansAdded: 100,
  cc3TxHash: "0xABCDEF",
  gasUsed: 421337n,
  attestationLagSec: 612,
  at: "2026-09-12T10:00:00.000Z",
};

describe("formatEvidenceLine", () => {
  test("emits exactly the documented field set, in order", () => {
    expect(Object.keys(formatEvidenceLine(input))).toEqual([
      "source",
      "txHash",
      "sourceBlock",
      "txIndex",
      "preRoot",
      "postRoot",
      "kind",
      "humansAdded",
      "cc3TxHash",
      "gasUsed",
      "attestationLagSec",
      "at",
    ]);
  });

  test("normalizes hashes to lowercase and roots to 32-byte hex", () => {
    const line = formatEvidenceLine(input);
    expect(line.txHash).toBe(input.txHash.toLowerCase());
    expect(line.cc3TxHash).toBe("0xabcdef");
    expect(line.preRoot).toBe(
      "0x09e09348765ae00461fc21703be4eeb90ee2dd609333eac7e602e5cf87d47e00",
    );
    expect(line.postRoot).toHaveLength(66);
  });

  test("gasUsed becomes a string so bigints survive JSON", () => {
    expect(formatEvidenceLine(input).gasUsed).toBe("421337");
    expect(() => JSON.stringify(formatEvidenceLine(input))).not.toThrow();
  });

  test("accepts decimal-string roots as well as bigints", () => {
    const line = formatEvidenceLine({ ...input, preRoot: "255", postRoot: "0x10" });
    expect(line.preRoot.endsWith("ff")).toBe(true);
    expect(line.postRoot.endsWith("10")).toBe(true);
  });

  test("a dry run with no transaction yields explicit nulls, not omissions", () => {
    const line = formatEvidenceLine({
      ...input,
      cc3TxHash: null,
      gasUsed: null,
      attestationLagSec: null,
    });
    expect(line.cc3TxHash).toBeNull();
    expect(line.gasUsed).toBeNull();
    expect(line.attestationLagSec).toBeNull();
    expect(JSON.parse(JSON.stringify(line))).toHaveProperty("gasUsed", null);
  });

  test("defaults `at` to now when the caller does not supply it", () => {
    const { at, ...rest } = input;
    void at;
    const line = formatEvidenceLine(rest);
    expect(Number.isNaN(Date.parse(line.at))).toBe(false);
  });
});

describe("serializeEvidenceLine", () => {
  test("is exactly one newline-terminated JSON object", () => {
    const s = serializeEvidenceLine(input);
    expect(s.endsWith("\n")).toBe(true);
    expect(s.trimEnd()).not.toContain("\n");
    expect(JSON.parse(s).sourceBlock).toBe(11687163);
  });
});

describe("appendEvidence / readEvidence", () => {
  test("appends rather than overwriting, and reads back in order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "humanline-evidence-")), "nested", "log.jsonl");
    appendEvidence(input, path);
    appendEvidence({ ...input, sourceBlock: 11687200 }, path);

    expect(readFileSync(path, "utf8").trimEnd().split("\n")).toHaveLength(2);
    const lines = readEvidence(path);
    expect(lines.map((l) => l.sourceBlock)).toEqual([11687163, 11687200]);
  });

  test("reading a file that does not exist yields no lines", () => {
    expect(readEvidence(join(tmpdir(), "humanline-does-not-exist.jsonl"))).toEqual([]);
  });
});
