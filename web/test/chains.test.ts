/**
 * Address and explorer-link invariants.
 *
 * viem rejects a mixed-case address whose EIP-55 checksum does not verify — and
 * it does so at call time, not at build time. Writing the BlockProver precompile
 * as `0x…0fD2` instead of `0x…0FD2` therefore compiles, ships, and then fails in
 * front of a judge with "Address … is invalid". These tests make that class of
 * bug fail in `bun test` instead.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, isAddress } from "viem";

import {
  CC3_ADD_CHAIN_PARAMS,
  creditcoinTestnet,
  EVM_V1_DECODER,
  explorerName,
  explorerUrl,
  IDENTITY_MANAGER_SELECTORS,
  PRECOMPILES,
  PROOF_BUILDER_URL,
  scopeForChainKey,
  SOURCE_CHAINS,
  SOURCE_CHAIN_LIST,
  sourceChainFor,
  TREE_CHANGED_TOPIC,
  WORLD_ID_TREE_DEPTH,
} from "@/lib/chains";
import { CONTRACT_LIST } from "@/lib/contracts";

const HARD_CODED: Array<[string, `0x${string}`]> = [
  ["BlockProver precompile", PRECOMPILES.blockProver],
  ["ChainInfo precompile", PRECOMPILES.chainInfo],
  ["AttestorStash precompile", PRECOMPILES.attestorStash],
  ["EvmV1Decoder library", EVM_V1_DECODER],
  ["World ID manager (mainnet)", SOURCE_CHAINS[3].identityManager],
  ["World ID manager (Sepolia)", SOURCE_CHAINS[1].identityManager],
];

describe("hard-coded addresses", () => {
  for (const [label, address] of HARD_CODED) {
    test(`${label} is EIP-55 checksummed`, () => {
      expect(isAddress(address)).toBe(true);
      expect(getAddress(address)).toBe(address);
    });
  }

  test("the precompiles are the documented ones", () => {
    expect(PRECOMPILES.blockProver.toLowerCase().endsWith("fd2")).toBe(true);
    expect(PRECOMPILES.chainInfo.toLowerCase().endsWith("fd3")).toBe(true);
    expect(PRECOMPILES.attestorStash.toLowerCase().endsWith("fd4")).toBe(true);
  });
});

describe("addresses resolved from the deployments file", () => {
  for (const contract of CONTRACT_LIST) {
    test.skipIf(!contract.address)(`${contract.name} is a usable address`, () => {
      // The deploy script writes lowercase addresses, which viem accepts as
      // "not checksummed". What must never happen is a mixed-case address whose
      // checksum is wrong, because viem rejects those outright.
      expect(isAddress(contract.address!)).toBe(true);
    });
  }
});

describe("chain definition", () => {
  test("is Creditcoin CC3 testnet", () => {
    expect(creditcoinTestnet.id).toBe(102031);
    expect(creditcoinTestnet.nativeCurrency).toEqual({
      name: "Test Creditcoin",
      symbol: "tCTC",
      decimals: 18,
    });
    expect(creditcoinTestnet.rpcUrls.default.http[0]).toBe(
      "https://rpc.cc3-testnet.creditcoin.network",
    );
    expect(creditcoinTestnet.blockExplorers.default.url).toBe(
      "https://creditcoin-testnet.blockscout.com",
    );
    expect(creditcoinTestnet.testnet).toBe(true);
  });

  test("the add-network payload matches the chain", () => {
    expect(CC3_ADD_CHAIN_PARAMS.chainId).toBe("0x18e8f");
    expect(parseInt(CC3_ADD_CHAIN_PARAMS.chainId, 16)).toBe(creditcoinTestnet.id);
    expect(CC3_ADD_CHAIN_PARAMS.rpcUrls[0]).toBe(creditcoinTestnet.rpcUrls.default.http[0]);
  });

  test("the proof builder is the CC3 testnet one", () => {
    expect(PROOF_BUILDER_URL).toBe("https://prover.cc3-testnet.creditcoin.network");
    expect(PROOF_BUILDER_URL.endsWith("/")).toBe(false);
  });
});

describe("source chains", () => {
  test("mainnet is chainKey 3 and Sepolia is chainKey 1", () => {
    expect(SOURCE_CHAINS[3].chainId).toBe(1);
    expect(SOURCE_CHAINS[3].tier).toBe("production");
    expect(SOURCE_CHAINS[1].chainId).toBe(11155111);
    expect(SOURCE_CHAINS[1].tier).toBe("staging");
    expect(SOURCE_CHAIN_LIST).toHaveLength(2);
  });

  test("sourceChainFor tolerates unknown keys", () => {
    expect(sourceChainFor(3)?.label).toBe("Ethereum");
    expect(sourceChainFor(1n)?.label).toBe("Sepolia");
    expect(sourceChainFor(8)).toBeUndefined();
  });

  test("scopeForChainKey routes to the right explorer", () => {
    expect(scopeForChainKey(3)).toBe("ethereum");
    expect(scopeForChainKey(1)).toBe("sepolia");
    expect(explorerName("ethereum")).toBe("Etherscan");
    expect(explorerName("sepolia")).toBe("Sepolia Etherscan");
    expect(explorerName("creditcoin")).toBe("Blockscout");
  });
});

describe("explorer links", () => {
  const hash = `0x${"ab".repeat(32)}`;

  test("build the documented URL shapes", () => {
    expect(explorerUrl("creditcoin", "tx", hash)).toBe(
      `https://creditcoin-testnet.blockscout.com/tx/${hash}`,
    );
    expect(explorerUrl("ethereum", "address", SOURCE_CHAINS[3].identityManager)).toBe(
      `https://etherscan.io/address/${SOURCE_CHAINS[3].identityManager}`,
    );
    expect(explorerUrl("sepolia", "block", 11687163n)).toBe(
      "https://sepolia.etherscan.io/block/11687163",
    );
  });

  test("never emit a double slash", () => {
    for (const scope of ["creditcoin", "ethereum", "sepolia"] as const) {
      const url = explorerUrl(scope, "tx", hash);
      expect(url.slice("https://".length).includes("//")).toBe(false);
    }
  });
});

describe("World ID constants", () => {
  test("the TreeChanged topic and selectors match the spec", () => {
    expect(TREE_CHANGED_TOPIC).toBe(
      "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04",
    );
    expect(TREE_CHANGED_TOPIC).toHaveLength(66);
    expect(IDENTITY_MANAGER_SELECTORS.registerIdentities).toBe("0x2217b211");
    expect(IDENTITY_MANAGER_SELECTORS.deleteIdentities).toBe("0xea10fbbe");
    expect(WORLD_ID_TREE_DEPTH).toBe(30);
  });
});
