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

/** `IAttestorStash` at 0x0FD4. */
export const attestorStashAbi = [
  {
    type: "function",
    name: "getAttestorsCount",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: [{ type: "uint32" }],
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
