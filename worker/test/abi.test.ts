// The hand-written ABI fragments must cover everything the worker calls, and the artifact
// loader must prefer contracts/abi/AttestedWorldID.json once the contracts task lands.
import { describe, expect, test } from "bun:test";
import { Interface } from "ethers";
import {
  ATTESTED_WORLD_ID_FRAGMENTS,
  attestorStashInterface,
  loadAttestedWorldIdAbi,
  missingFragments,
} from "../src/abi";

const iface = new Interface([...ATTESTED_WORLD_ID_FRAGMENTS]);

describe("AttestedWorldID fragments", () => {
  test("cover every function and event the worker needs", () => {
    expect(missingFragments(iface)).toEqual([]);
  });

  test("execute has the ASCBase parameter list in order", () => {
    const fn = iface.getFunction("execute")!;
    expect(fn.inputs.map((i) => i.format("full"))).toEqual([
      "uint8 action",
      "uint64 chainKey",
      "uint64 blockHeight",
      "bytes encodedTransaction",
      "bytes32 merkleRoot",
      "(bytes32 hash, bool isLeft)[] siblings",
      "bytes32 lowerEndpointDigest",
      "bytes32[] continuityRoots",
    ]);
  });

  test("executeBatch takes parallel arrays plus one shared continuity proof", () => {
    const fn = iface.getFunction("executeBatch")!;
    expect(fn.inputs.map((i) => i.name)).toEqual([
      "chainKey",
      "blockHeights",
      "encodedTransactions",
      "merkleProofs",
      "sharedContinuityProof",
    ]);
    expect(fn.inputs[4]!.format("full")).toBe(
      "(bytes32 lowerEndpointDigest, bytes32[] roots) sharedContinuityProof",
    );
  });

  test("RootRelayed matches the interface in docs/PLAN.md", () => {
    const ev = iface.getEvent("RootRelayed")!;
    expect(ev.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`)).toEqual([
      "bytes32 indexed queryId",
      "uint64 indexed sourceBlock",
      "uint256 indexed postRoot",
      "uint256 preRoot",
      "uint8 kind",
      "uint32 humansAdded",
      "uint256 sourceTxIndex",
      "address relayer",
    ]);
  });

  test("processedQueries is a bytes32 → bool view", () => {
    const fn = iface.getFunction("processedQueries")!;
    expect(fn.inputs[0]!.type).toBe("bytes32");
    expect(fn.outputs[0]!.type).toBe("bool");
    expect(fn.stateMutability).toBe("view");
  });

  test("latestRoot and rootCount are uint256 views", () => {
    for (const name of ["latestRoot", "rootCount"]) {
      const fn = iface.getFunction(name)!;
      expect(fn.outputs[0]!.type).toBe("uint256");
      expect(fn.stateMutability).toBe("view");
    }
  });

  test("every custom error in the interface decodes", () => {
    for (const name of [
      "WrongSourceChain",
      "SourceTxReverted",
      "NotIdentityManager",
      "NoTreeChange",
      "AmbiguousTreeChange",
      "CalldataLogMismatch",
      "UnknownPreRoot",
      "NotFinal",
      "ThinQuorum",
    ]) {
      expect(iface.getError(name)).not.toBeNull();
    }
  });
});

describe("loadAttestedWorldIdAbi", () => {
  test("falls back to the fragments while contracts/abi is absent", () => {
    const loaded = loadAttestedWorldIdAbi(true);
    // Either origin is valid depending on whether the contracts task has landed, but the
    // result must always be able to encode what the worker calls.
    expect(missingFragments(loaded.iface)).toEqual([]);
    expect(["fragments", "artifact"].includes(loaded.origin.split(" ")[0]!)).toBe(true);
  });

  test("is cached between calls", () => {
    expect(loadAttestedWorldIdAbi()).toBe(loadAttestedWorldIdAbi());
  });
});

describe("missingFragments", () => {
  test("names what an incomplete artifact would be lacking", () => {
    const partial = new Interface(["function latestRoot() view returns (uint256)"]);
    expect(missingFragments(partial).sort()).toEqual(
      ["RootRelayed", "execute", "executeBatch", "processedQueries", "rootCount"].sort(),
    );
  });
});

describe("AttestorStash", () => {
  test("getAttestorsCount(uint64) encodes to the expected selector", () => {
    const data = attestorStashInterface.encodeFunctionData("getAttestorsCount", [3]);
    expect(data.slice(0, 10)).toBe(
      attestorStashInterface.getFunction("getAttestorsCount")!.selector,
    );
    expect(data).toHaveLength(10 + 64);
  });
});
