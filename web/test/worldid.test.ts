/**
 * These tests exist because a wrong hash here produces a proof that the on-chain
 * Groth16 verifier silently rejects, with no way to tell from the failure whether
 * the proof, the signal or the external nullifier was at fault.
 *
 * Every expectation is derived independently of `lib/worldid.ts`:
 *  - `hashToField` is recomputed from `@noble/hashes` keccak inside the test,
 *  - `hashSignalAddress` is cross-checked against IDKit's own `hashSignal`,
 *  - the ABI packing is asserted byte-for-byte against hand-built buffers.
 */

import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { describe, expect, test } from "bun:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { encodePacked, keccak256, toBytes, type Hex } from "viem";

import {
  assertInField,
  decodeSemaphoreProof,
  externalNullifierHash,
  hashSignalAddress,
  hashToField,
  humanLabel,
  SNARK_SCALAR_FIELD,
  toRegistrationProof,
} from "@/lib/worldid";

/** An independent implementation of `uint256(keccak256(b)) >> 8`. */
function referenceHashToField(bytes: Uint8Array): bigint {
  const digest = keccak_256(bytes);
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return value >> 8n;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const hexBytes = (hex: string) =>
  Uint8Array.from((hex.startsWith("0x") ? hex.slice(2) : hex).match(/../g)!.map((b) => parseInt(b, 16)));

const WALLET = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3" as const;
const APP_ID = "app_87b24915fcf733f10df1b0c46dd1f783";
const ACTION = "humanline-register";

describe("hashToField", () => {
  test("is uint256(keccak256(bytes)) >> 8", () => {
    const input = "0xdeadbeef" as Hex;
    expect(hashToField(input)).toBe(referenceHashToField(hexBytes(input)));
    // And the shift really is a shift, not a mask.
    expect(hashToField(input)).toBe(BigInt(keccak256(input)) >> 8n);
  });

  test("hashes a non-hex string as its UTF-8 bytes", () => {
    expect(hashToField(APP_ID)).toBe(referenceHashToField(utf8(APP_ID)));
    expect(hashToField(ACTION)).toBe(referenceHashToField(utf8(ACTION)));
  });

  test("treats a 0x-prefixed string as raw bytes, not as text", () => {
    const asBytes = hashToField("0x1234" as Hex);
    const asText = referenceHashToField(utf8("0x1234"));
    expect(asBytes).toBe(referenceHashToField(hexBytes("0x1234")));
    expect(asBytes).not.toBe(asText);
  });

  test("accepts a Uint8Array directly", () => {
    const bytes = hexBytes("0x00112233445566778899aabbccddeeff");
    expect(hashToField(bytes)).toBe(referenceHashToField(bytes));
  });

  test("always lands inside the BN254 scalar field", () => {
    for (const sample of ["a", "humanline", APP_ID, ACTION, "0x00", "0xffffffff"]) {
      const value = hashToField(sample);
      expect(value).toBeLessThan(SNARK_SCALAR_FIELD);
      expect(value).toBeGreaterThanOrEqual(0n);
      // 248 bits: a keccak digest with its low byte dropped.
      expect(value.toString(2).length).toBeLessThanOrEqual(248);
    }
  });

  test("the empty input has the known keccak256('') digest, shifted", () => {
    const emptyKeccak =
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
    expect(hashToField(new Uint8Array())).toBe(BigInt(emptyKeccak) >> 8n);
  });
});

describe("hashSignalAddress", () => {
  test("hashes exactly 20 address bytes, not a padded word", () => {
    const packed = hexBytes(WALLET); // abi.encodePacked(address) === the 20 bytes
    expect(packed.length).toBe(20);
    expect(hashSignalAddress(WALLET)).toBe(referenceHashToField(packed));
  });

  test("differs from hashing the 32-byte left-padded word", () => {
    const padded = hexBytes(`0x${"00".repeat(12)}${WALLET.slice(2)}`);
    expect(padded.length).toBe(32);
    expect(hashSignalAddress(WALLET)).not.toBe(referenceHashToField(padded));
  });

  test("differs from hashing the address as a text string", () => {
    expect(hashSignalAddress(WALLET)).not.toBe(referenceHashToField(utf8(WALLET)));
  });

  test("matches IDKit's own hashSignal for the same wallet", () => {
    // This is the contract between the widget and the registry: IDKit computes
    // the signal hash client-side, the registry recomputes it from msg.sender.
    expect(hashSignalAddress(WALLET)).toBe(BigInt(hashSignal(WALLET)));
  });

  test("is case-insensitive across checksum spellings", () => {
    expect(hashSignalAddress(WALLET.toLowerCase() as `0x${string}`)).toBe(
      hashSignalAddress(WALLET),
    );
  });

  test("is different for a different wallet", () => {
    const other = "0x0000000000000000000000000000000000000001" as const;
    expect(hashSignalAddress(other)).not.toBe(hashSignalAddress(WALLET));
  });
});

describe("externalNullifierHash", () => {
  test("is hashToField(abi.encodePacked(hashToField(app_id), action))", () => {
    const inner = referenceHashToField(utf8(APP_ID));

    // abi.encodePacked(uint256, string) = 32 big-endian bytes, then raw UTF-8.
    const innerWord = hexBytes(`0x${inner.toString(16).padStart(64, "0")}`);
    const actionBytes = utf8(ACTION);
    const packed = new Uint8Array(innerWord.length + actionBytes.length);
    packed.set(innerWord, 0);
    packed.set(actionBytes, innerWord.length);
    expect(packed.length).toBe(32 + actionBytes.length);

    expect(externalNullifierHash(APP_ID, ACTION)).toBe(referenceHashToField(packed));
  });

  test("agrees with viem's encodePacked, which is what the helper uses", () => {
    const inner = hashToField(APP_ID);
    expect(externalNullifierHash(APP_ID, ACTION)).toBe(
      BigInt(keccak256(encodePacked(["uint256", "string"], [inner, ACTION]))) >> 8n,
    );
  });

  test("the inner hash is the app id, and the action is NOT hashed first", () => {
    const wrongOrder = hashToField(
      encodePacked(["uint256", "string"], [hashToField(ACTION), APP_ID]),
    );
    const doubleHashed = hashToField(
      encodePacked(["uint256", "uint256"], [hashToField(APP_ID), hashToField(ACTION)]),
    );
    expect(externalNullifierHash(APP_ID, ACTION)).not.toBe(wrongOrder);
    expect(externalNullifierHash(APP_ID, ACTION)).not.toBe(doubleHashed);
  });

  test("changes when either the app id or the action changes", () => {
    const base = externalNullifierHash(APP_ID, ACTION);
    expect(externalNullifierHash(APP_ID, "humanline-claim")).not.toBe(base);
    expect(externalNullifierHash("app_0000", ACTION)).not.toBe(base);
  });

  test("an empty action still packs the 32-byte inner word", () => {
    const inner = hashToField(APP_ID);
    const expected = hashToField(toBytes(`0x${inner.toString(16).padStart(64, "0")}`));
    expect(externalNullifierHash(APP_ID, "")).toBe(expected);
  });

  test("lands inside the BN254 scalar field", () => {
    const value = externalNullifierHash(APP_ID, ACTION);
    expect(value).toBeLessThan(SNARK_SCALAR_FIELD);
    expect(() => assertInField(value, "externalNullifierHash")).not.toThrow();
  });
});

describe("decodeSemaphoreProof", () => {
  const proofValues = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n] as const;
  const encoded = (`0x` +
    proofValues.map((v) => v.toString(16).padStart(64, "0")).join("")) as Hex;

  test("decodes abi.encode(uint256[8]) into eight bigints", () => {
    expect(decodeSemaphoreProof(encoded)).toEqual(proofValues);
  });

  test("throws a readable error on a malformed blob", () => {
    expect(() => decodeSemaphoreProof("0x1234" as Hex)).toThrow(/World ID 3\.0|uint256\[8\]/);
  });

  test("toRegistrationProof normalises a v3 response into contract arguments", () => {
    const result = toRegistrationProof({
      merkle_root: "0x0f",
      nullifier: "0x10",
      proof: encoded,
    });
    expect(result.root).toBe(15n);
    expect(result.nullifierHash).toBe(16n);
    expect(result.proof).toEqual(proofValues);
  });
});

describe("assertInField", () => {
  test("rejects values at or beyond the modulus", () => {
    expect(() => assertInField(SNARK_SCALAR_FIELD, "x")).toThrow();
    expect(() => assertInField(-1n, "x")).toThrow();
    expect(() => assertInField(SNARK_SCALAR_FIELD - 1n, "x")).not.toThrow();
  });
});

describe("humanLabel", () => {
  test("uses the first four bytes of the padded hex form", () => {
    expect(humanLabel(0n)).toBe("Human #00000000");
    expect(humanLabel(BigInt("0x" + "ab".repeat(32)))).toBe("Human #abababab");
  });
});
