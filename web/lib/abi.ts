/**
 * Typed ABIs for every contract and precompile the web app talks to.
 *
 * These are hand-written from the `Interfaces` section of `docs/PLAN.md` and the
 * Attestcoin precompile interfaces in
 * `contracts/node_modules/@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`.
 * They are `as const` so viem infers argument and return types end to end.
 *
 * They stay hand-written rather than importing `contracts/abi/*.json`, because a
 * JSON import is `any` to TypeScript and loses every inferred argument and
 * return type. The cost of that choice is drift, so `test/abi.test.ts` asserts
 * that every function, event and custom error declared here exists in the
 * compiled artifact with an identical signature, identical return types and
 * identical `indexed` flags. A drift fails `bun test`, not the demo.
 *
 * Custom errors are declared even where the app never calls the function that
 * raises them: viem uses the ABI to decode a revert, so an error that is missing
 * here shows up in the UI as an unreadable hex blob instead of `OverLimit`.
 */

/** `IAttestedWorldID` — World's bridged-root contract, fed by Attestcoin. */
export const attestedWorldIdAbi = [
  {
    type: "event",
    name: "RootRelayed",
    inputs: [
      { name: "queryId", type: "bytes32", indexed: true },
      { name: "sourceBlock", type: "uint64", indexed: true },
      { name: "postRoot", type: "uint256", indexed: true },
      { name: "preRoot", type: "uint256", indexed: false },
      { name: "kind", type: "uint8", indexed: false },
      { name: "humansAdded", type: "uint32", indexed: false },
      { name: "sourceTxIndex", type: "uint256", indexed: false },
      { name: "relayer", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "WrongSourceChain", inputs: [{ name: "got", type: "uint64" }, { name: "want", type: "uint64" }] },
  { type: "error", name: "SourceTxReverted", inputs: [] },
  { type: "error", name: "NotIdentityManager", inputs: [{ name: "to", type: "address" }] },
  { type: "error", name: "NoTreeChange", inputs: [] },
  { type: "error", name: "AmbiguousTreeChange", inputs: [{ name: "count", type: "uint256" }] },
  { type: "error", name: "CalldataLogMismatch", inputs: [] },
  { type: "error", name: "UnknownPreRoot", inputs: [{ name: "preRoot", type: "uint256" }] },
  { type: "error", name: "NotFinal", inputs: [{ name: "attestedTip", type: "uint64" }, { name: "sourceBlock", type: "uint64" }] },
  { type: "error", name: "ThinQuorum", inputs: [{ name: "have", type: "uint32" }, { name: "want", type: "uint32" }] },
  { type: "error", name: "QueryAlreadyProcessed", inputs: [{ name: "queryId", type: "bytes32" }] },
  { type: "error", name: "UnsupportedEntrypoint", inputs: [{ name: "selector", type: "bytes4" }] },
  { type: "error", name: "UnsupportedTreeDepth", inputs: [{ name: "depth", type: "uint8" }] },
  { type: "error", name: "BatchTooLarge", inputs: [{ name: "size", type: "uint256" }] },
  { type: "error", name: "BatchLengthMismatch", inputs: [] },
  { type: "error", name: "BatchOutOfOrder", inputs: [] },
  { type: "error", name: "BatchProofRejected", inputs: [] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "ExpiredRoot", inputs: [] },
  { type: "error", name: "NonExistentRoot", inputs: [] },
  { type: "error", name: "NoRootsSeen", inputs: [] },
  { type: "error", name: "CannotOverwriteRoot", inputs: [] },
  { type: "error", name: "RootHistoryExpiryImmutable", inputs: [] },

  {
    type: "event",
    name: "RootAdded",
    inputs: [
      { name: "root", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint128", indexed: false },
    ],
    anonymous: false,
  },

  { type: "function", name: "SOURCE_CHAIN_KEY", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "IDENTITY_MANAGER", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "FINALITY_DEPTH", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "MIN_ATTESTORS", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "MAX_BATCH", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SOURCE_BLOCK_TIME", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "VERIFIER", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "rootHistoryExpiry", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTreeDepth", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "processedQueries",
    stateMutability: "view",
    inputs: [{ name: "queryId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "latestRoot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "rootHistory",
    stateMutability: "view",
    inputs: [{ name: "root", type: "uint256" }],
    outputs: [{ name: "receivedAt", type: "uint128" }],
  },
  { type: "function", name: "rootCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "humansAddedTotal", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "isValidRoot",
    stateMutability: "view",
    inputs: [{ name: "root", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "verifyProof",
    stateMutability: "view",
    inputs: [
      { name: "root", type: "uint256" },
      { name: "signalHash", type: "uint256" },
      { name: "nullifierHash", type: "uint256" },
      { name: "externalNullifierHash", type: "uint256" },
      { name: "proof", type: "uint256[8]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "action", type: "uint8" },
      { name: "chainKey", type: "uint64" },
      { name: "blockHeight", type: "uint64" },
      { name: "encodedTransaction", type: "bytes" },
      { name: "merkleRoot", type: "bytes32" },
      {
        name: "siblings",
        type: "tuple[]",
        components: [
          { name: "hash", type: "bytes32" },
          { name: "isLeft", type: "bool" },
        ],
      },
      { name: "lowerEndpointDigest", type: "bytes32" },
      { name: "continuityRoots", type: "bytes32[]" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "blockHeights", type: "uint64[]" },
      { name: "encodedTransactions", type: "bytes[]" },
      {
        name: "merkleProofs",
        type: "tuple[]",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "sharedContinuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/**
 * `RelayReward` — the permissionless relayer vault. `relay` takes `executeBatch`'s
 * arguments behind a target instance and pays per fresh root it moved the tip by.
 */
export const relayRewardAbi = [
  { type: "error", name: "UnknownRelay", inputs: [{ name: "relay", type: "address" }] },
  { type: "error", name: "NoRelays", inputs: [] },
  { type: "error", name: "Reentrancy", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "ClaimFailed", inputs: [] },
  { type: "error", name: "ZeroReward", inputs: [] },
  {
    type: "event",
    name: "Funded",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Relayed",
    inputs: [
      { name: "relayer", type: "address", indexed: true },
      { name: "relay", type: "address", indexed: true },
      { name: "roots", type: "uint256", indexed: false },
      { name: "rewardedRoots", type: "uint256", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
      { name: "credited", type: "uint256", indexed: false },
      { name: "shortfall", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "relayer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "function", name: "REWARD_PER_ROOT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_ROOT_AGE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_REWARDED_ROOTS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "available", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalRewarded", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rootsRewarded", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimable", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "isRelay",
    stateMutability: "view",
    inputs: [{ name: "relay", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "relayer", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  { type: "function", name: "relays", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "fund", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "relay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "chainKey", type: "uint64" },
      { name: "blockHeights", type: "uint64[]" },
      { name: "encodedTransactions", type: "bytes[]" },
      {
        name: "merkleProofs",
        type: "tuple[]",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "sharedContinuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [
      { name: "roots", type: "uint256" },
      { name: "rewardedRoots", type: "uint256" },
    ],
  },
] as const;

/** `IHumanRegistry` — nullifier ⇄ wallet binding. */
export const humanRegistryAbi = [
  {
    type: "event",
    name: "HumanRegistered",
    inputs: [
      { name: "nullifierHash", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "root", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "HumanRebound",
    inputs: [
      { name: "nullifierHash", type: "uint256", indexed: true },
      { name: "oldWallet", type: "address", indexed: true },
      { name: "newWallet", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "WalletAlreadyHuman",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "nullifierHash", type: "uint256" },
    ],
  },
  { type: "error", name: "SameWallet", inputs: [] },
  { type: "error", name: "ZeroNullifier", inputs: [] },

  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "uint256" },
      { name: "nullifierHash", type: "uint256" },
      { name: "proof", type: "uint256[8]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isHuman",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "humanOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "walletOf",
    stateMutability: "view",
    inputs: [{ name: "nullifierHash", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "registeredAt",
    stateMutability: "view",
    inputs: [{ name: "nullifierHash", type: "uint256" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "signalHashOf",
    stateMutability: "pure",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "humanCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "WORLD_ID", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "EXTERNAL_NULLIFIER_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "APP_ID", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "ACTION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** `ICreditLine` — the lender-funded pool, one line per human. */
export const creditLineAbi = [
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "lender", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "lender", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LineOpened",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "limit", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Borrowed",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "dueAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Repaid",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "remaining", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LimitChanged",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "oldLimit", type: "uint256", indexed: false },
      { name: "newLimit", type: "uint256", indexed: false },
      { name: "onTime", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Defaulted",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "writtenOff", type: "uint256", indexed: false },
      { name: "reporter", type: "address", indexed: true },
    ],
    anonymous: false,
  },

  { type: "error", name: "NotHuman", inputs: [{ name: "wallet", type: "address" }] },
  { type: "error", name: "LineExists", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "NoLine", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "LineFrozen", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "OverLimit", inputs: [{ name: "requested", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "InsufficientLiquidity", inputs: [{ name: "requested", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "NothingOwed", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "NotInDefault", inputs: [{ name: "human", type: "uint256" }, { name: "dueAt", type: "uint64" }, { name: "grace", type: "uint64" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "InsufficientShares", inputs: [{ name: "requested", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },

  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "INITIAL_LIMIT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_LIMIT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "TERM", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "GRACE", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "SECURITY_CHAIN_KEY", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "SOURCE_CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "EXPOSURE_PER_BONDED_CTC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "securityBudget",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "attestors", type: "uint32" },
      { name: "minBond", type: "uint128" },
      { name: "cap", type: "uint256" },
    ],
  },
  { type: "function", name: "exposureCap", stateMutability: "view", inputs: [], outputs: [{ name: "cap", type: "uint256" }] },
  { type: "error", name: "ExposureCapExceeded", inputs: [{ name: "wouldOwe", type: "uint256" }, { name: "cap", type: "uint256" }] },
  {
    type: "error",
    name: "WrongSecurityChain",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "recordedChainId", type: "uint64" },
      { name: "claimedChainId", type: "uint64" },
    ],
  },

  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  { type: "function", name: "openLine", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "markDefault", stateMutability: "nonpayable", inputs: [{ name: "human", type: "uint256" }], outputs: [] },

  {
    type: "function",
    name: "lineOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "limit", type: "uint256" },
          { name: "principal", type: "uint256" },
          { name: "dueAt", type: "uint64" },
          { name: "openedAt", type: "uint64" },
          { name: "loansRepaid", type: "uint32" },
          { name: "loansLate", type: "uint32" },
          { name: "frozen", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "lineOfWallet",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "limit", type: "uint256" },
          { name: "principal", type: "uint256" },
          { name: "dueAt", type: "uint64" },
          { name: "openedAt", type: "uint64" },
          { name: "loansRepaid", type: "uint32" },
          { name: "loansLate", type: "uint32" },
          { name: "frozen", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "availableCredit",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  /**
   * Outstanding principal excluding fees — fees only count once they are repaid,
   * so this is the number a lender cares about and the one `/` shows as
   * "credit outstanding".
   */
  { type: "function", name: "totalBorrowed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPrincipal", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "principalOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{ name: "lender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isInDefault",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  /** v3: the CreditHistory whose proved Aave repayments boost limits (zero on v2 lines). */
  { type: "function", name: "HISTORY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  /** v3: anyone may pay down a human's line; `EthRepay` settles Ethereum-side payments this way. */
  {
    type: "function",
    name: "repayFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "human", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  /** v3: line limit plus proved-history boost, capped at MAX_LIMIT. */
  {
    type: "function",
    name: "limitOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "boostOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** `hUSD` — the demo stablecoin, ERC-20 with a rate-limited faucet. */
export const husdAbi = [
  {
    type: "event",
    name: "Faucet",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "FaucetCooldown", inputs: [{ name: "until", type: "uint64" }] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [{ name: "spender", type: "address" }, { name: "allowance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientBalance", inputs: [{ name: "sender", type: "address" }, { name: "balance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "ERC20InvalidApprover", inputs: [{ name: "approver", type: "address" }] },
  { type: "error", name: "ERC20InvalidReceiver", inputs: [{ name: "receiver", type: "address" }] },
  { type: "error", name: "ERC20InvalidSender", inputs: [{ name: "sender", type: "address" }] },
  { type: "error", name: "ERC20InvalidSpender", inputs: [{ name: "spender", type: "address" }] },

  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "FAUCET_AMOUNT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "FAUCET_COOLDOWN", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "faucetAvailableAt",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint64" }],
  },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** `HumanGate` — the twenty-line example integration. */
export const humanGateAbi = [
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "AlreadyClaimed", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "NotHuman", inputs: [{ name: "wallet", type: "address" }] },
  { type: "function", name: "REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * `IChainInfo` at 0x0FD3.
 *
 * `get_supported_chains()` is the snake_case name the precompile exposes; the
 * returned tuple carries the attested tip per chain where the node provides it.
 */
export const chainInfoAbi = [
  {
    type: "function",
    name: "get_supported_chains",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "chainKey", type: "uint64" },
          { name: "chainId", type: "uint64" },
          { name: "chainName", type: "bytes" },
          { name: "chainEncoding", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/**
 * A second, narrower guess at the ChainInfo "latest attested height" getter.
 *
 * `docs/PLAN.md` leaves the exact selector to Task 1 ("must confirm the exact
 * selector/name … from precompiles/metadata/sol/chain_info.sol"). The relay page
 * probes this and degrades to "unavailable" if the call reverts, rather than
 * blocking the whole header on a name we cannot yet confirm.
 */
export const chainInfoHeightAbi = [
  {
    type: "function",
    name: "get_latest_attested_height",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "height", type: "uint64" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

/**
 * The two ChainInfo getters `AttestedWorldID._attestedTip()` reads, with the struct
 * layout from `contracts/src/interfaces/IChainInfo.sol` (`HeightHashResult`). The
 * self-relay planner uses them so its "is this final yet" answer is the contract's.
 */
export const chainInfoAttestationAbi = [
  {
    type: "function",
    name: "get_latest_attestation_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        name: "result",
        type: "tuple",
        components: [
          { name: "height", type: "uint64" },
          { name: "hash", type: "bytes32" },
          { name: "isAttestation", type: "bool" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "get_latest_checkpoint_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        name: "result",
        type: "tuple",
        components: [
          { name: "height", type: "uint64" },
          { name: "hash", type: "bytes32" },
          { name: "isAttestation", type: "bool" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

/** `IAttestorStash` at 0x0FD4: bonded attestor count and minimum bond (wei of CTC) per chain key. */
export const attestorStashAbi = [
  {
    type: "function",
    name: "getAttestorsCount",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "getMinBondRequirement",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ name: "minBond", type: "uint128" }],
  },
] as const;

/** ChainInfo lookups by chain key: which EVM chain a key is, and whether a height is provable. */
export const chainInfoLookupAbi = [
  {
    type: "function",
    name: "get_chain_by_key",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [
      {
        name: "result",
        type: "tuple",
        components: [
          {
            name: "info",
            type: "tuple",
            components: [
              { name: "chainKey", type: "uint64" },
              { name: "chainId", type: "uint64" },
              { name: "chainName", type: "bytes" },
              { name: "chainEncoding", type: "uint8" },
            ],
          },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "is_height_attested",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "targetHeight", type: "uint64" },
    ],
    outputs: [{ name: "isAttested", type: "bool" }],
  },
] as const;

/**
 * `INativeQueryVerifier` at 0x0FD2 — only the read-only `verify` overloads, so
 * `/judge` can prove a transaction with an `eth_call` and no wallet.
 *
 * Struct layout confirmed against
 * `@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol`:
 * `MerkleProof{bytes32 root, MerkleProofEntry[] siblings}` where
 * `MerkleProofEntry{bytes32 hash, bool isLeft}`, and
 * `ContinuityProof{bytes32 lowerEndpointDigest, bytes32[] roots}`.
 */
export const nativeQueryVerifierAbi = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
      { name: "encodedTransaction", type: "bytes" },
      {
        name: "merkleProof",
        type: "tuple",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "continuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "heights", type: "uint64[]" },
      { name: "encodedTransactions", type: "bytes[]" },
      {
        name: "merkleProofs",
        type: "tuple[]",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "continuityProof",
        type: "tuple",
        components: [
          { name: "lowerEndpointDigest", type: "bytes32" },
          { name: "roots", type: "bytes32[]" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "calculateTxIndex",
    stateMutability: "view",
    inputs: [
      {
        name: "merkleProof",
        type: "tuple",
        components: [
          { name: "root", type: "bytes32" },
          {
            name: "siblings",
            type: "tuple[]",
            components: [
              { name: "hash", type: "bytes32" },
              { name: "isLeft", type: "bool" },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: "uint64" }],
  },
] as const;

/** Minimal ERC-20 surface for arbitrary assets (used by the lender panel). */
export const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// ------------------------------------------------------------------------------------------
//                       Cross-chain credit identity (HumanLinks, CreditHistory, EthRepay)
// ------------------------------------------------------------------------------------------

/** `SourceProof`: one proof-builder proof of one Ethereum transaction, as a Solidity struct. */
const sourceProofParam = {
  name: "proof",
  type: "tuple",
  components: [
    { name: "chainKey", type: "uint64" },
    { name: "blockHeight", type: "uint64" },
    { name: "encodedTransaction", type: "bytes" },
    {
      name: "merkleProof",
      type: "tuple",
      components: [
        { name: "root", type: "bytes32" },
        {
          name: "siblings",
          type: "tuple[]",
          components: [
            { name: "hash", type: "bytes32" },
            { name: "isLeft", type: "bool" },
          ],
        },
      ],
    },
    {
      name: "continuityProof",
      type: "tuple",
      components: [
        { name: "lowerEndpointDigest", type: "bytes32" },
        { name: "roots", type: "bytes32[]" },
      ],
    },
  ],
} as const;

/** Reverts every `ProvenSource` consumer can raise before it reads the transaction's meaning. */
const provenSourceAbi = [
  { type: "function", name: "FINALITY_DEPTH", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "MIN_ATTESTORS", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  {
    type: "function",
    name: "chainIdOf",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "consumed",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "logIdOf",
    stateMutability: "pure",
    inputs: [
      { name: "queryId", type: "bytes32" },
      { name: "logIndex", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { type: "error", name: "BadSourceConfig", inputs: [] },
  {
    type: "error",
    name: "WrongSourceChain",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "recordedChainId", type: "uint64" },
      { name: "claimedChainId", type: "uint64" },
    ],
  },
  { type: "error", name: "UnsupportedSourceChain", inputs: [{ name: "chainKey", type: "uint64" }] },
  { type: "error", name: "ProofRejected", inputs: [] },
  {
    type: "error",
    name: "NotFinal",
    inputs: [
      { name: "attestedTip", type: "uint64" },
      { name: "blockHeight", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "ThinQuorum",
    inputs: [
      { name: "attestors", type: "uint32" },
      { name: "required", type: "uint32" },
    ],
  },
  { type: "error", name: "SourceTxReverted", inputs: [] },
  {
    type: "error",
    name: "WrongTxChainId",
    inputs: [
      { name: "signedFor", type: "uint64" },
      { name: "expected", type: "uint64" },
    ],
  },
  { type: "error", name: "UnprotectedLegacyTx", inputs: [] },
  { type: "error", name: "UnsupportedTxType", inputs: [{ name: "txType", type: "uint8" }] },
  {
    type: "error",
    name: "LogIndexOutOfRange",
    inputs: [
      { name: "logIndex", type: "uint256" },
      { name: "logCount", type: "uint256" },
    ],
  },
  { type: "error", name: "AlreadyConsumed", inputs: [{ name: "id", type: "bytes32" }] },
] as const;

/** `HumanLinks` — one human, many Ethereum wallets; each wallet belongs to one human forever. */
export const humanLinksAbi = [
  ...provenSourceAbi,
  { type: "function", name: "linkBySourceTx", stateMutability: "nonpayable", inputs: [sourceProofParam], outputs: [] },
  {
    type: "function",
    name: "linkBySignature",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "humanOfWallet",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "linkOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "human", type: "uint256" },
          { name: "chainKey", type: "uint64" },
          { name: "blockHeight", type: "uint64" },
          { name: "linkedAt", type: "uint64" },
          { name: "method", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "linksOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "linkCount",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "linkIntent",
    stateMutability: "view",
    inputs: [
      { name: "human", type: "uint256" },
      { name: "creditcoinWallet", type: "address" },
    ],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "linkDigest",
    stateMutability: "view",
    inputs: [
      { name: "human", type: "uint256" },
      { name: "creditcoinWallet", type: "address" },
      { name: "wallet", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "txChainId",
    stateMutability: "pure",
    inputs: [{ name: "encodedTx", type: "bytes" }],
    outputs: [{ type: "uint64" }],
  },
  { type: "function", name: "MAX_LINKS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "LINK_MARKER", stateMutability: "view", inputs: [], outputs: [{ type: "bytes4" }] },
  { type: "function", name: "REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "WalletLinked",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "method", type: "uint8", indexed: false },
      { name: "chainKey", type: "uint64", indexed: false },
      { name: "blockHeight", type: "uint64", indexed: false },
      { name: "queryId", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NotHuman", inputs: [{ name: "caller", type: "address" }] },
  {
    type: "error",
    name: "NotSelfSend",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
    ],
  },
  { type: "error", name: "NotALinkIntent", inputs: [] },
  {
    type: "error",
    name: "WrongLinkTarget",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "target", type: "address" },
    ],
  },
  {
    type: "error",
    name: "IntentForAnotherHuman",
    inputs: [
      { name: "intended", type: "uint256" },
      { name: "caller", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "IntentForAnotherWallet",
    inputs: [
      { name: "intended", type: "address" },
      { name: "caller", type: "address" },
    ],
  },
  {
    type: "error",
    name: "WalletAlreadyLinked",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "human", type: "uint256" },
    ],
  },
  { type: "error", name: "TooManyLinks", inputs: [{ name: "human", type: "uint256" }] },
  { type: "error", name: "SignatureExpired", inputs: [{ name: "deadline", type: "uint256" }] },
  {
    type: "error",
    name: "BadSignature",
    inputs: [
      { name: "recovered", type: "address" },
      { name: "wallet", type: "address" },
    ],
  },
  { type: "error", name: "ZeroWallet", inputs: [] },
] as const;

/** `CreditHistory` — Aave V3 Borrow/Repay proofs from linked wallets, turned into a bounded limit boost. */
export const creditHistoryAbi = [
  ...provenSourceAbi,
  {
    type: "function",
    name: "proveBorrow",
    stateMutability: "nonpayable",
    inputs: [sourceProofParam, { name: "logIndex", type: "uint256" }],
    outputs: [{ name: "borrowId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "proveRepay",
    stateMutability: "nonpayable",
    inputs: [sourceProofParam, { name: "logIndex", type: "uint256" }, { name: "borrowId", type: "bytes32" }],
    outputs: [{ name: "creditedUsd", type: "uint256" }],
  },
  {
    type: "function",
    name: "boostOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "repaidUsdOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "repaymentsOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "borrowOf",
    stateMutability: "view",
    inputs: [{ name: "borrowId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "human", type: "uint256" },
          { name: "wallet", type: "address" },
          { name: "reserve", type: "address" },
          { name: "chainKey", type: "uint64" },
          { name: "blockHeight", type: "uint64" },
          { name: "amount", type: "uint256" },
          { name: "remaining", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "poolOf",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "reserveDecimals",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "token", type: "address" },
    ],
    outputs: [{ type: "uint8" }],
  },
  { type: "function", name: "LINKS", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "MIN_GAP_BLOCKS", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "BOOST_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_BOOST", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "BorrowProven",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "borrowId", type: "bytes32", indexed: true },
      { name: "chainKey", type: "uint64", indexed: false },
      { name: "blockHeight", type: "uint64", indexed: false },
      { name: "reserve", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RepaymentProven",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "borrowId", type: "bytes32", indexed: true },
      { name: "repayId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "creditedUsd", type: "uint256", indexed: false },
      { name: "totalRepaidUsd", type: "uint256", indexed: false },
      { name: "boost", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "UnsupportedPool",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "emitter", type: "address" },
    ],
  },
  { type: "error", name: "NotABorrowLog", inputs: [] },
  { type: "error", name: "NotARepayLog", inputs: [] },
  {
    type: "error",
    name: "UnsupportedReserve",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "reserve", type: "address" },
    ],
  },
  {
    type: "error",
    name: "BorrowedForSomeoneElse",
    inputs: [
      { name: "user", type: "address" },
      { name: "onBehalfOf", type: "address" },
    ],
  },
  {
    type: "error",
    name: "RepaidBySomeoneElse",
    inputs: [
      { name: "user", type: "address" },
      { name: "repayer", type: "address" },
    ],
  },
  { type: "error", name: "RepaidWithATokens", inputs: [] },
  { type: "error", name: "WalletNotLinked", inputs: [{ name: "wallet", type: "address" }] },
  { type: "error", name: "UnknownBorrow", inputs: [{ name: "borrowId", type: "bytes32" }] },
  { type: "error", name: "BorrowMismatch", inputs: [{ name: "borrowId", type: "bytes32" }] },
  {
    type: "error",
    name: "TooSoon",
    inputs: [
      { name: "repayHeight", type: "uint64" },
      { name: "earliest", type: "uint64" },
    ],
  },
  { type: "error", name: "BorrowFullyRepaid", inputs: [{ name: "borrowId", type: "bytes32" }] },
  { type: "error", name: "BadParameters", inputs: [] },
] as const;

/** `EthRepay` — a proved stablecoin transfer on Ethereum repays a Creditcoin line. */
export const ethRepayAbi = [
  ...provenSourceAbi,
  {
    type: "function",
    name: "creditRepayment",
    stateMutability: "nonpayable",
    inputs: [sourceProofParam, { name: "logIndex", type: "uint256" }],
    outputs: [{ name: "applied", type: "uint256" }],
  },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "overpaidOf",
    stateMutability: "view",
    inputs: [{ name: "human", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "totalApplied", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "REPAY_ADDRESS", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "LINKS", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "CREDIT_LINE", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "stablecoinOf",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "stablecoinDecimalsOf",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "event",
    name: "RepaymentCredited",
    inputs: [
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "chainKey", type: "uint64", indexed: false },
      { name: "blockHeight", type: "uint64", indexed: false },
      { name: "sourceAmount", type: "uint256", indexed: false },
      { name: "applied", type: "uint256", indexed: false },
      { name: "overpaid", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "NotAStablecoinTransfer",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "emitter", type: "address" },
    ],
  },
  { type: "error", name: "NotToRepayAddress", inputs: [{ name: "to", type: "address" }] },
  { type: "error", name: "WalletNotLinked", inputs: [{ name: "wallet", type: "address" }] },
  {
    type: "error",
    name: "ReserveShort",
    inputs: [
      { name: "needed", type: "uint256" },
      { name: "available", type: "uint256" },
    ],
  },
  { type: "error", name: "ZeroTransfer", inputs: [] },
  { type: "error", name: "BadParameters", inputs: [] },
  { type: "error", name: "Reentrancy", inputs: [] },
] as const;

/** `HumanPoll` — one person, one vote, built on `HumanGated` from `@humanline/sdk`. */
export const humanPollAbi = [
  { type: "function", name: "HUMAN_REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "MAX_OPTIONS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pollCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "ballotOf",
    stateMutability: "view",
    inputs: [
      { name: "pollId", type: "uint256" },
      { name: "human", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "usedBy",
    stateMutability: "view",
    inputs: [
      { name: "scope", type: "bytes32" },
      { name: "human", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getPoll",
    stateMutability: "view",
    inputs: [{ name: "pollId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "creatorHuman", type: "uint256" },
      { name: "closesAt", type: "uint64" },
      { name: "question", type: "string" },
      { name: "options", type: "string[]" },
      { name: "tally", type: "uint256[]" },
      { name: "voters", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "createPoll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question", type: "string" },
      { name: "options", type: "string[]" },
      { name: "duration", type: "uint64" },
    ],
    outputs: [{ name: "pollId", type: "uint256" }],
  },
  {
    type: "function",
    name: "vote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pollId", type: "uint256" },
      { name: "option", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "PollCreated",
    inputs: [
      { name: "pollId", type: "uint256", indexed: true },
      { name: "creatorHuman", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: false },
      { name: "question", type: "string", indexed: false },
      { name: "options", type: "string[]", indexed: false },
      { name: "closesAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Voted",
    inputs: [
      { name: "pollId", type: "uint256", indexed: true },
      { name: "human", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: false },
      { name: "option", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NotHuman", inputs: [{ name: "wallet", type: "address" }] },
  { type: "error", name: "AlreadyUsed", inputs: [{ name: "scope", type: "bytes32" }, { name: "human", type: "uint256" }] },
  { type: "error", name: "ZeroRegistry", inputs: [] },
  { type: "error", name: "BadPoll", inputs: [] },
  { type: "error", name: "UnknownPoll", inputs: [{ name: "pollId", type: "uint256" }] },
  { type: "error", name: "PollClosed", inputs: [{ name: "pollId", type: "uint256" }, { name: "closedAt", type: "uint64" }] },
  { type: "error", name: "UnknownOption", inputs: [{ name: "option", type: "uint256" }, { name: "optionCount", type: "uint256" }] },
  { type: "error", name: "AlreadyVoted", inputs: [{ name: "pollId", type: "uint256" }, { name: "human", type: "uint256" }] },
] as const;
