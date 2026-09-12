/**
 * World ID hashing + proof-decoding helpers.
 *
 * These reproduce, byte for byte, the hashing the Solidity side performs — see
 * `docs/PLAN.md` "Global constraints":
 *
 *   hashToField(bytes b)      = uint256(keccak256(b)) >> 8
 *   signalHash                = hashToField(abi.encodePacked(address wallet))
 *   externalNullifierHash     = hashToField(
 *                                 abi.encodePacked(
 *                                   hashToField(abi.encodePacked(app_id_string)),
 *                                   action_string))
 *
 * The `>> 8` is World ID's standard "squeeze a keccak digest into the BN254
 * scalar field" trick: dropping the low byte leaves a 248-bit value, which is
 * always below the field modulus.
 *
 * Unit tests live in `web/test/worldid.test.ts`.
 */

import {
  decodeAbiParameters,
  encodePacked,
  keccak256,
  toBytes,
  type Hex,
} from "viem";

/** The Semaphore/Groth16 proof the registry expects: eight field elements. */
export type SemaphoreProof = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

/** The shape `HumanRegistry.register` is called with. */
export type RegistrationProof = {
  root: bigint;
  nullifierHash: bigint;
  proof: SemaphoreProof;
};

/** BN254 scalar field modulus, for the sanity check in {@link assertInField}. */
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * `uint256(keccak256(bytes)) >> 8`.
 *
 * Accepts either raw bytes (as a `0x` hex string / `Uint8Array`) or a UTF-8
 * string. Strings are hashed as their UTF-8 bytes, matching
 * `abi.encodePacked(string)` in Solidity.
 */
export function hashToField(input: Hex | Uint8Array | string): bigint {
  const bytes =
    typeof input === "string" && !isHexString(input) ? toBytes(input) : input;
  return BigInt(keccak256(bytes as Hex | Uint8Array)) >> 8n;
}

/**
 * `hashToField(abi.encodePacked(address wallet))`.
 *
 * `abi.encodePacked(address)` is exactly the 20 address bytes, so this hashes
 * 20 bytes — not a 32-byte left-padded word. Getting that wrong produces a
 * proof the on-chain verifier rejects, which is why it has its own test.
 */
export function hashSignalAddress(wallet: Hex): bigint {
  return hashToField(encodePacked(["address"], [wallet]));
}

/**
 * `hashToField(abi.encodePacked(hashToField(abi.encodePacked(app_id)), action))`.
 *
 * The inner hash is packed as a full `uint256` word (32 bytes, big-endian) and
 * the action is appended as its raw UTF-8 bytes.
 */
export function externalNullifierHash(appId: string, action: string): bigint {
  const appIdHash = hashToField(appId);
  return hashToField(encodePacked(["uint256", "string"], [appIdHash, action]));
}

/**
 * Decode IDKit's ABI-encoded proof into the `uint256[8]` the contract wants.
 *
 * IDKit returns `proof` as `abi.encode(uint256[8])` — a single hex blob. viem's
 * `decodeAbiParameters` unwraps it. Throws a readable error rather than a viem
 * stack trace when the blob is the wrong shape, because this string ends up in
 * front of a user.
 */
export function decodeSemaphoreProof(encodedProof: Hex): SemaphoreProof {
  let decoded: readonly bigint[];
  try {
    [decoded] = decodeAbiParameters(
      [{ type: "uint256[8]" }],
      encodedProof,
    ) as unknown as [readonly bigint[]];
  } catch {
    throw new Error(
      "World ID returned a proof that is not an ABI-encoded uint256[8]. " +
        "Humanline verifies World ID 3.0 Semaphore proofs on Creditcoin.",
    );
  }
  if (!decoded || decoded.length !== 8) {
    throw new Error(
      `Expected 8 proof elements, got ${decoded ? decoded.length : 0}.`,
    );
  }
  return decoded as unknown as SemaphoreProof;
}

/**
 * Normalise one IDKit v3 (`ResponseItemV3`) response into contract arguments.
 *
 * IDKit hands back hex strings; the contract takes `uint256`s.
 */
export function toRegistrationProof(response: {
  merkle_root: string;
  nullifier: string;
  proof: string;
}): RegistrationProof {
  return {
    root: BigInt(response.merkle_root),
    nullifierHash: BigInt(response.nullifier),
    proof: decodeSemaphoreProof(response.proof as Hex),
  };
}

/** Throw if a value cannot be a BN254 field element. Cheap client-side guard. */
export function assertInField(value: bigint, label: string): void {
  if (value < 0n || value >= SNARK_SCALAR_FIELD) {
    throw new Error(`${label} is not a valid field element`);
  }
}

/**
 * A short, stable, human-readable identity for a nullifier: `Human #a1b2c3d4`.
 *
 * The nullifier itself is a 32-byte number; showing all of it in a status card
 * is noise, and showing a sequential index would leak ordering. The first four
 * bytes of the hex form are enough to recognise your own row.
 */
export function humanLabel(nullifierHash: bigint): string {
  const hex = nullifierHash.toString(16).padStart(64, "0");
  return `Human #${hex.slice(0, 8)}`;
}

function isHexString(value: string): value is Hex {
  return /^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0;
}
