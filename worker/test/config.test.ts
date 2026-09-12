// Env parsing, source configuration and the deployments gate. No network.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTION_ROOT_UPDATE,
  CC3_CHAIN_ID,
  NOT_DEPLOYED_EXIT_CODE,
  SELECTOR_DELETE_IDENTITIES,
  SELECTOR_REGISTER_IDENTITIES,
  SOURCES,
  TREE_CHANGED_TOPIC,
  attestedWorldIdAddress,
  loadDeployments,
  parseEnvFile,
  parseSourceArg,
  sourceByChainKey,
} from "../src/config";

describe("constants match the spec", () => {
  test("chain keys, managers and the TreeChanged topic", () => {
    expect(CC3_CHAIN_ID).toBe(102031);
    expect(SOURCES.mainnet.chainKey).toBe(3);
    expect(SOURCES.sepolia.chainKey).toBe(1);
    expect(SOURCES.mainnet.manager.toLowerCase()).toBe(
      "0xf7134ce138832c1456f2a91d64621ee90c2bddea",
    );
    expect(SOURCES.sepolia.manager.toLowerCase()).toBe(
      "0xb2ead588f14e69266d1b87936b75325181377076",
    );
    expect(TREE_CHANGED_TOPIC).toBe(
      "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04",
    );
    expect(SELECTOR_REGISTER_IDENTITIES).toBe("0x2217b211");
    expect(SELECTOR_DELETE_IDENTITIES).toBe("0xea10fbbe");
    expect(ACTION_ROOT_UPDATE).toBe(0);
    expect(NOT_DEPLOYED_EXIT_CODE).toBe(2);
  });

  test("sourceByChainKey resolves both directions", () => {
    expect(sourceByChainKey(3)?.name).toBe("mainnet");
    expect(sourceByChainKey(1)?.name).toBe("sepolia");
    expect(sourceByChainKey(99)).toBeUndefined();
  });
});

describe("parseSourceArg", () => {
  test("resolves single sources and `all`", () => {
    expect(parseSourceArg("mainnet")).toEqual(["mainnet"]);
    expect(parseSourceArg("sepolia")).toEqual(["sepolia"]);
    expect(parseSourceArg("all")).toEqual(["mainnet", "sepolia"]);
  });

  test("rejects anything else", () => {
    expect(() => parseSourceArg("goerli")).toThrow(/unknown --source/);
  });
});

describe("parseEnvFile", () => {
  test("parses plain assignments and ignores comments and blanks", () => {
    expect(
      parseEnvFile(["# comment", "", "A=1", "B = two ", "  # indented comment"].join("\n")),
    ).toEqual({ A: "1", B: "two" });
  });

  test("strips surrounding quotes but keeps inner ones", () => {
    expect(parseEnvFile(`A="0xabc"\nB='xyz'\nC="a'b"`)).toEqual({
      A: "0xabc",
      B: "xyz",
      C: "a'b",
    });
  });

  test("supports `export KEY=value`", () => {
    expect(parseEnvFile("export CREDITCOIN_WALLET_PRIVATE_KEY=0xdead")).toEqual({
      CREDITCOIN_WALLET_PRIVATE_KEY: "0xdead",
    });
  });

  test("strips an unquoted trailing comment but not a quoted one", () => {
    expect(parseEnvFile("A=1 # note")).toEqual({ A: "1" });
    expect(parseEnvFile('A="1 # note"')).toEqual({ A: "1 # note" });
  });

  test("keeps `=` inside values", () => {
    expect(parseEnvFile("URL=https://x.example/?a=b&c=d")).toEqual({
      URL: "https://x.example/?a=b&c=d",
    });
  });

  test("skips malformed lines instead of throwing", () => {
    expect(parseEnvFile("no-equals\n=novalue\n1BAD=x\nOK=1")).toEqual({ OK: "1" });
  });
});

describe("loadDeployments", () => {
  const dir = mkdtempSync(join(tmpdir(), "humanline-deploy-"));

  test("reports a missing file rather than throwing", () => {
    const res = loadDeployments(join(dir, "absent.json"));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("file does not exist");
  });

  test("reports invalid JSON", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json");
    const res = loadDeployments(path);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("invalid JSON");
  });

  test("reports a file without a contracts object", () => {
    const path = join(dir, "empty.json");
    writeFileSync(path, JSON.stringify({ chainId: 102031 }));
    const res = loadDeployments(path);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("contracts");
  });

  test("loads a well-formed file and resolves per-source addresses", () => {
    const path = join(dir, "good.json");
    writeFileSync(
      path,
      JSON.stringify({
        chainId: 102031,
        contracts: {
          AttestedWorldIDMainnet: "0x1111111111111111111111111111111111111111",
          AttestedWorldIDSepolia: "0x2222222222222222222222222222222222222222",
        },
      }),
    );
    const res = loadDeployments(path);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(attestedWorldIdAddress(res.data, SOURCES.mainnet)).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(attestedWorldIdAddress(res.data, SOURCES.sepolia)).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  test("a malformed or absent address reads as undefined, not as a bad address", () => {
    expect(
      attestedWorldIdAddress({ chainId: 1, contracts: { AttestedWorldIDMainnet: "0xnope" } }, SOURCES.mainnet),
    ).toBeUndefined();
    expect(attestedWorldIdAddress(undefined, SOURCES.mainnet)).toBeUndefined();
    expect(attestedWorldIdAddress({ chainId: 1, contracts: {} }, SOURCES.sepolia)).toBeUndefined();
  });
});
