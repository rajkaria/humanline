/**
 * The two deployments a person can use, and what distinguishes them.
 *
 * Humanline is one protocol with one set of relayed roots, deployed twice:
 *
 *   demo        HumanRegistry + CreditLine wired to the *Sepolia staging*
 *               AttestedWorldID instance, 10-minute terms. World's simulator issues
 *               real Semaphore proofs against that tree, so anyone — a judge, a
 *               reviewer, someone without a World ID — can run the whole flow.
 *   production  The same contracts wired to the *Ethereum mainnet* Orb tree, 30-day
 *               terms. Only a real, Orb-verified World ID can register here. This is
 *               the product; the demo profile is how you check the product's claims.
 *
 * Both share one hUSD and both read the same two AttestedWorldID instances, so the
 * relay evidence on `/relay` backs both. The pair is the honest answer to "is this a
 * demo or a real thing": it is a real thing, with a reproducible demo beside it.
 */

import type { SourceChainKey } from "@/lib/chains";
import { buildDeployment, type ContractKey, type Deployment } from "@/lib/deployment";
import demoDoc from "./generated/deployments.json";
import productionDoc from "./generated/deployments.production.json";

export type ProfileId = "demo" | "production";

export type Profile = {
  id: ProfileId;
  /** Short label for the switch. */
  label: string;
  /** One line under the label. */
  tagline: string;
  /** Which World ID environment IDKit must be opened in for this registry. */
  worldEnv: "production" | "staging";
  /** The AttestedWorldID instance this profile's registry verifies against. */
  worldIdKey: Extract<ContractKey, "attestedWorldIDMainnet" | "attestedWorldIDSepolia">;
  /** Human-readable source-of-roots, e.g. "Ethereum mainnet". */
  sourceChain: string;
  /** Who can complete this flow. */
  who: string;
  deployment: Deployment;
  /** `true` when this profile's registry and credit line both resolved. */
  available: boolean;
};

const demo = buildDeployment(demoDoc as unknown);
const production = buildDeployment(productionDoc as unknown);

function isAvailable(deployment: Deployment): boolean {
  return Boolean(deployment.contracts.humanRegistry.address && deployment.contracts.creditLine.address);
}

export const PROFILES: Record<ProfileId, Profile> = {
  demo: {
    id: "demo",
    label: "Reproducible (staging tree)",
    tagline: "World ID Simulator proofs against the Sepolia tree. Anyone can run this.",
    worldEnv: "staging",
    worldIdKey: "attestedWorldIDSepolia",
    sourceChain: "Ethereum Sepolia",
    who: "Judges and reviewers, no Orb needed. 10-minute terms so a full borrow and repay cycle fits in a demo.",
    deployment: demo,
    available: isAvailable(demo),
  },
  production: {
    id: "production",
    label: "Real humans (Orb tree)",
    tagline: "World App proofs against Ethereum mainnet's Orb-verified tree.",
    worldEnv: "production",
    worldIdKey: "attestedWorldIDMainnet",
    sourceChain: "Ethereum mainnet",
    who: "Anyone with an Orb-verified World ID. 30-day terms, 7-day grace. This is the real product.",
    deployment: production,
    available: isAvailable(production),
  },
};

export const PROFILE_IDS: ProfileId[] = ["demo", "production"];

/**
 * The profile a first-time visitor lands on.
 *
 * Deliberately the reproducible one: a judge who cannot complete the flow learns
 * nothing, and the production profile is one click (or `?profile=production`) away.
 */
export const DEFAULT_PROFILE_ID: ProfileId = "demo";

export function profileById(id: string | null | undefined): Profile | undefined {
  return id === "demo" || id === "production" ? PROFILES[id] : undefined;
}

/** The profile whose registry verifies roots from this World ID tree (Attestcoin chainKey). */
export function profileForChainKey(chainKey: SourceChainKey): Profile {
  return chainKey === 3 ? PROFILES.production : PROFILES.demo;
}

/** Term length in a form the UI can print without unit maths. */
export function termLabel(profile: Profile): string {
  const seconds = profile.deployment.config.termSeconds;
  if (!seconds) return "–";
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}
