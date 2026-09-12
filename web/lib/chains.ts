/**
 * Chain definitions and explorer link helpers.
 *
 * Humanline touches three chains: Creditcoin CC3 testnet (where everything is
 * verified and settled), Ethereum mainnet (where World's Orb identity manager
 * lives, Attestcoin chainKey 3) and Ethereum Sepolia (World's staging identity
 * manager, Attestcoin chainKey 1).
 */

import { defineChain } from "viem";

/** Creditcoin CC3 testnet — `docs/SPEC.md` §14. */
export const creditcoinTestnet = defineChain({
  id: 102031,
  name: "Creditcoin CC3 Testnet",
  nativeCurrency: { name: "Test Creditcoin", symbol: "tCTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.cc3-testnet.creditcoin.network"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://creditcoin-testnet.blockscout.com",
    },
  },
  testnet: true,
});

/** The Attestcoin proof builder for CC3 testnet. */
export const PROOF_BUILDER_URL = "https://prover.cc3-testnet.creditcoin.network";

/**
 * Attestcoin precompiles on CC3.
 *
 * Every address here is EIP-55 checksummed: viem rejects a mixed-case address
 * whose checksum does not verify, and a precompile written in the "obvious"
 * casing (`0x…0fD2`) fails that check at call time rather than at build time.
 * `test/chains.test.ts` asserts the checksums so it can never regress.
 */
export const PRECOMPILES = {
  /** `INativeQueryVerifier` — proves a source-chain transaction happened. */
  blockProver: "0x0000000000000000000000000000000000000FD2",
  /** `IChainInfo` — which source chains are attested, and how far. */
  chainInfo: "0x0000000000000000000000000000000000000fD3",
  /** `IAttestorStash` — how many attestors back a source chain. */
  attestorStash: "0x0000000000000000000000000000000000000fd4",
} as const;

/** The deployed `EvmV1Decoder` library the contracts link against. */
export const EVM_V1_DECODER = "0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B";

/**
 * Attestcoin source chains Humanline relays from.
 *
 * `chainKey` is Attestcoin's identifier, not an EVM chain id.
 */
export type SourceChainKey = 1 | 3;

export type SourceChain = {
  chainKey: SourceChainKey;
  /** Short label used in tables and badges. */
  label: string;
  /** Long label used in prose and cards. */
  name: string;
  /** EVM chain id of the source chain. */
  chainId: number;
  /** World ID identity manager watched on that chain. */
  identityManager: `0x${string}`;
  /** Explorer root for that chain. */
  explorer: string;
  /** Whether this is World's production (Orb) tree or the staging simulator. */
  tier: "production" | "staging";
};

export const SOURCE_CHAINS: Record<SourceChainKey, SourceChain> = {
  3: {
    chainKey: 3,
    label: "Ethereum",
    name: "Ethereum mainnet",
    chainId: 1,
    identityManager: "0xf7134CE138832c1456F2a91D64621eE90c2bddEa",
    explorer: "https://etherscan.io",
    tier: "production",
  },
  1: {
    chainKey: 1,
    label: "Sepolia",
    name: "Ethereum Sepolia",
    chainId: 11155111,
    identityManager: "0xb2EaD588f14e69266d1b87936b75325181377076",
    explorer: "https://sepolia.etherscan.io",
    tier: "staging",
  },
};

export const SOURCE_CHAIN_LIST: SourceChain[] = [SOURCE_CHAINS[3], SOURCE_CHAINS[1]];

/** The `TreeChanged(uint256,uint8,uint256)` topic0 the relay keys off. */
export const TREE_CHANGED_TOPIC =
  "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04";

/** World ID identity-manager selectors the relay accepts. */
export const IDENTITY_MANAGER_SELECTORS = {
  registerIdentities: "0x2217b211",
  deleteIdentities: "0xea10fbbe",
} as const;

/** Merkle tree depth of the World ID identity tree. */
export const WORLD_ID_TREE_DEPTH = 30;

type ExplorerTarget = "tx" | "address" | "block" | "token";

/** Which explorer a link belongs to. */
export type ExplorerScope = "creditcoin" | "ethereum" | "sepolia";

const EXPLORER_ROOTS: Record<ExplorerScope, { name: string; url: string }> = {
  creditcoin: {
    name: "Blockscout",
    url: creditcoinTestnet.blockExplorers.default.url,
  },
  ethereum: { name: "Etherscan", url: SOURCE_CHAINS[3].explorer },
  sepolia: { name: "Sepolia Etherscan", url: SOURCE_CHAINS[1].explorer },
};

/** Human-readable name of the explorer behind a scope. */
export function explorerName(scope: ExplorerScope): string {
  return EXPLORER_ROOTS[scope].name;
}

/** Build an explorer URL for a tx / address / block on a given chain. */
export function explorerUrl(
  scope: ExplorerScope,
  target: ExplorerTarget,
  value: string | number | bigint,
): string {
  const root = EXPLORER_ROOTS[scope].url;
  return `${root}/${target}/${value.toString()}`;
}

/** Map an Attestcoin `chainKey` onto the explorer scope for that chain. */
export function scopeForChainKey(chainKey: number | bigint): ExplorerScope {
  return Number(chainKey) === 3 ? "ethereum" : "sepolia";
}

/** Look up a source chain by Attestcoin chainKey, tolerating unknown keys. */
export function sourceChainFor(chainKey: number | bigint): SourceChain | undefined {
  const key = Number(chainKey);
  return key === 3 || key === 1 ? SOURCE_CHAINS[key as SourceChainKey] : undefined;
}

/**
 * The EIP-3085 parameters for "Add Creditcoin CC3 testnet" in a wallet.
 * wagmi's `switchChain` uses this when the wallet does not know the chain yet.
 */
export const CC3_ADD_CHAIN_PARAMS = {
  chainId: `0x${creditcoinTestnet.id.toString(16)}`,
  chainName: creditcoinTestnet.name,
  nativeCurrency: creditcoinTestnet.nativeCurrency,
  rpcUrls: [...creditcoinTestnet.rpcUrls.default.http],
  blockExplorerUrls: [creditcoinTestnet.blockExplorers.default.url],
} as const;
