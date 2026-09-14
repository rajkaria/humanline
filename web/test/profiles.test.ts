/**
 * The two deployment profiles must stay *different deployments of the same protocol*.
 *
 * Every failure mode here is silent at build time and fatal at demo time: a profile
 * pointed at the wrong AttestedWorldID instance produces proofs that always revert; a
 * profile whose World ID environment disagrees with its registry does the same; two
 * profiles sharing a registry would quietly merge the Orb tree with the staging tree,
 * which is the one claim Humanline must never get wrong.
 */

import { describe, expect, test } from "bun:test";

import { buildDeployment } from "@/lib/deployment";
import {
  DEFAULT_PROFILE_ID,
  PROFILE_IDS,
  PROFILES,
  profileById,
  profileForChainKey,
  termLabel,
} from "@/lib/profiles";

describe("deployment profiles", () => {
  test("both profiles resolved a registry and a credit line", () => {
    for (const id of PROFILE_IDS) {
      const profile = PROFILES[id];
      expect(profile.available).toBe(true);
      expect(profile.deployment.contracts.humanRegistry.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(profile.deployment.contracts.creditLine.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  test("each profile verifies against the AttestedWorldID instance its deployment names", () => {
    expect(PROFILES.demo.deployment.config.worldIdSource).toBe("sepolia");
    expect(PROFILES.demo.worldIdKey).toBe("attestedWorldIDSepolia");
    expect(PROFILES.production.deployment.config.worldIdSource).toBe("mainnet");
    expect(PROFILES.production.worldIdKey).toBe("attestedWorldIDMainnet");
  });

  test("the World ID environment agrees with the tree the registry trusts", () => {
    // A staging proof is not a member of the Orb tree, and vice versa: opening IDKit
    // in the wrong environment produces a proof that can only ever revert.
    expect(PROFILES.demo.worldEnv).toBe("staging");
    expect(PROFILES.production.worldEnv).toBe("production");
  });

  test("both registries share the app id and action, so a proof made on one profile carries over", () => {
    // Someone with World App who lands on the staging profile gets an Orb proof. The
    // verify card offers to switch profiles *keeping that proof*, which is only sound
    // while the external nullifier (app id + action) is identical on both registries.
    expect(PROFILES.demo.deployment.config.appId).toBe(PROFILES.production.deployment.config.appId);
    expect(PROFILES.demo.deployment.config.action).toBe(PROFILES.production.deployment.config.action);
  });

  test("profileForChainKey maps each World ID tree to the profile that verifies it", () => {
    expect(profileForChainKey(3).id).toBe("production");
    expect(profileForChainKey(1).id).toBe("demo");
  });

  test("the profiles are separate registries and separate credit lines", () => {
    const demo = PROFILES.demo.deployment.contracts;
    const production = PROFILES.production.deployment.contracts;
    expect(demo.humanRegistry.address).not.toBe(production.humanRegistry.address);
    expect(demo.creditLine.address).not.toBe(production.creditLine.address);
  });

  test("both credit lines draw on the same hUSD, so one faucet serves both", () => {
    expect(PROFILES.demo.deployment.contracts.husd.address).toBe(
      PROFILES.production.deployment.contracts.husd.address,
    );
  });

  test("both profiles read the same relayed AttestedWorldID instances", () => {
    // The relay evidence on /relay has to back both profiles, or the "same roots"
    // claim on the landing page is false.
    for (const key of ["attestedWorldIDMainnet", "attestedWorldIDSepolia"] as const) {
      expect(PROFILES.demo.deployment.contracts[key].address).toBe(
        PROFILES.production.deployment.contracts[key].address,
      );
    }
  });

  test("the production profile carries real-world terms, the demo profile demo terms", () => {
    expect(PROFILES.production.deployment.config.termSeconds).toBe(30 * 24 * 60 * 60);
    expect(PROFILES.production.deployment.config.graceSeconds).toBe(7 * 24 * 60 * 60);
    expect(termLabel(PROFILES.production)).toBe("30 days");
    expect(PROFILES.demo.deployment.config.termSeconds).toBeLessThan(60 * 60);
  });

  test("the default profile is the one anybody can reproduce", () => {
    expect(DEFAULT_PROFILE_ID).toBe("demo");
    expect(PROFILES[DEFAULT_PROFILE_ID].worldEnv).toBe("staging");
  });

  test("profileById only accepts the two known ids", () => {
    expect(profileById("demo")?.id).toBe("demo");
    expect(profileById("production")?.id).toBe("production");
    expect(profileById("mainnet")).toBeUndefined();
    expect(profileById(null)).toBeUndefined();
    expect(profileById(undefined)).toBeUndefined();
  });
});

describe("deployment resolver", () => {
  test("an empty document resolves nothing and still reports cleanly", () => {
    const deployment = buildDeployment({});
    expect(deployment.status.missing).toBe(true);
    expect(deployment.status.ready).toBe(false);
    expect(deployment.addressOf("creditLine")).toBeUndefined();
    expect(deployment.deploymentBlockOf("creditLine")).toBe(0n);
  });

  test("addresses are read from nested, flat and object-valued shapes alike", () => {
    const address = "0x1111111111111111111111111111111111111111";
    expect(buildDeployment({ contracts: { CreditLine: address } }).addressOf("creditLine")).toBe(address);
    expect(buildDeployment({ CreditLine: address }).addressOf("creditLine")).toBe(address);
    expect(
      buildDeployment({ contracts: { credit_line: { address, block: 42 } } }).deploymentBlockOf("creditLine"),
    ).toBe(42n);
  });

  test("an env fallback only applies where it is passed, never across profiles", () => {
    const address = "0x2222222222222222222222222222222222222222";
    expect(buildDeployment({}, { creditLine: address }).addressOf("creditLine")).toBe(address);
    // profiles.ts deliberately passes no env map: a single NEXT_PUBLIC_CREDIT_LINE_ADDRESS
    // must not silently repoint both the staging and the Orb deployment at one contract.
    expect(PROFILES.production.deployment.contracts.creditLine.source).toBe("deployments");
  });

  test("garbage in a document is ignored rather than thrown", () => {
    expect(buildDeployment(null).status.missing).toBe(true);
    expect(buildDeployment({ contracts: { CreditLine: "not-an-address" } }).addressOf("creditLine")).toBeUndefined();
    expect(buildDeployment({ contracts: { CreditLine: 42 } }).addressOf("creditLine")).toBeUndefined();
  });
});
