/**
 * The attack list from `docs/SPEC.md` §9, paired with the named custom error the
 * contract reverts with and the Foundry test that fires it.
 *
 * **Both columns are verified, not asserted.** `test/abi.test.ts` checks every
 * `error` against the compiled artifact in `contracts/abi/*.json`, and every
 * `test` name against the source of `contracts/test/*.t.sol`. `/judge` is the
 * page whose whole premise is "check it yourself", so it must never print a test
 * name that does not exist or an error the contracts do not raise.
 *
 * The filter `/judge` prints — {@link NEGATIVE_PATH_FILTER} — follows the suite's
 * naming convention, selects all 52 negative tests and no happy-path ones.
 * `test/abi.test.ts` proves both halves of that claim.
 */

export type NegativePath = {
  threat: string;
  /** What stops it. */
  defence: string;
  /** The custom error the transaction reverts with, when there is one. */
  error?: string;
  /** The Foundry test that exercises it, exactly as it appears in the suite. */
  test: string;
  suite: "AttestedWorldID" | "HumanRegistry" | "CreditLine";
};

/** The regex `/judge` hands a judge to run the whole negative-path suite. */
export const NEGATIVE_PATH_FILTER =
  "Revert|Rejects|Ignores|Cannot|Survives|Expire|Specific";

export const NEGATIVE_PATHS: NegativePath[] = [
  // ------------------------------------------------------------- Attestcoin
  {
    threat: "Forged root",
    defence:
      "The 0x0FD2 precompile rejects a proof that does not match Creditcoin's attested view of Ethereum, so a fabricated root never reaches the contract's own guards.",
    error: "BatchProofRejected()",
    test: "test_SingleExecuteRevertsWhenTheProverRejectsTheProof",
    suite: "AttestedWorldID",
  },
  {
    threat: "Tampered payload",
    defence:
      "Flipping a byte of the encoded transaction breaks Merkle inclusion, and the precompile refuses the batch.",
    error: "BatchProofRejected()",
    test: "test_BatchRevertsWhenTheProverRejectsTheProof",
    suite: "AttestedWorldID",
  },
  {
    threat: "Wrong source chain",
    defence:
      "A mainnet proof submitted to the Sepolia instance is refused before anything else runs.",
    error: "WrongSourceChain(uint64,uint64)",
    test: "test_RevertsOnWrongSourceChain",
    suite: "AttestedWorldID",
  },
  {
    threat: "Reverted source transaction",
    defence: "A failed registerIdentities proves nothing; the receipt status must be 1.",
    error: "SourceTxReverted()",
    test: "test_RevertsWhenTheSourceTxReverted",
    suite: "AttestedWorldID",
  },
  {
    threat: "Transaction sent to another contract",
    defence: "The proven transaction's callee must be World's identity manager.",
    error: "NotIdentityManager(address)",
    test: "test_RevertsWhenTheCalleeIsNotTheIdentityManager",
    suite: "AttestedWorldID",
  },
  {
    threat: "Decoy TreeChanged from another emitter",
    defence:
      "A look-alike event emitted by a different contract in the same transaction is ignored, not consumed.",
    test: "test_IgnoresDecoyTreeChangedFromAnotherEmitter",
    suite: "AttestedWorldID",
  },
  {
    threat: "Contract creation instead of a call",
    defence: "A transaction with no callee cannot be a root update.",
    error: "NotIdentityManager(address)",
    test: "test_RevertsWhenTheTransactionIsAContractCreation",
    suite: "AttestedWorldID",
  },
  {
    threat: "No TreeChanged log at all",
    defence: "A genuine transaction to the manager that changed no root is refused.",
    error: "NoTreeChange()",
    test: "test_RevertsWhenThereIsNoTreeChange",
    suite: "AttestedWorldID",
  },
  {
    threat: "Two genuine TreeChanged logs",
    defence:
      "Ambiguity is refused rather than guessed at: exactly one tree change per proven transaction.",
    error: "AmbiguousTreeChange(uint256)",
    test: "test_RevertsOnTwoGenuineTreeChangedLogs",
    suite: "AttestedWorldID",
  },
  {
    threat: "An unknown function selector",
    defence: "Only registerIdentities and deleteIdentities are accepted entrypoints.",
    error: "UnsupportedEntrypoint(bytes4)",
    test: "test_RevertsOnAnUnknownSelector",
    suite: "AttestedWorldID",
  },
  {
    threat: "Truncated calldata",
    defence: "Calldata too short to carry the roots is refused before it is decoded.",
    error: "UnsupportedEntrypoint(bytes4)",
    test: "test_RevertsOnTruncatedCalldata",
    suite: "AttestedWorldID",
  },
  {
    threat: "Calldata that disagrees with the log",
    defence: "The roots decoded from calldata must equal the ones in the TreeChanged log.",
    error: "CalldataLogMismatch()",
    test: "test_RevertsWhenCalldataRootsDisagreeWithTheLog",
    suite: "AttestedWorldID",
  },
  {
    threat: "Out-of-order root",
    defence:
      "After bootstrap, preRoot must chain to a root the contract already knows, so roots can only arrive in sequence.",
    error: "UnknownPreRoot(uint256)",
    test: "test_RevertsOnAnUnknownPreRootAfterBootstrap",
    suite: "AttestedWorldID",
  },
  {
    threat: "Root from an unfinalised block",
    defence: "The source block must be FINALITY_DEPTH behind the tip 0x0FD3 reports.",
    error: "NotFinal(uint64,uint64)",
    test: "test_RevertsWhenTheSourceBlockIsNotFinalYet",
    suite: "AttestedWorldID",
  },
  {
    threat: "Thin attestor set",
    defence: "0x0FD4 must report at least MIN_ATTESTORS backing the source chain.",
    error: "ThinQuorum(uint32,uint32)",
    test: "test_RevertsOnThinAttestorQuorum",
    suite: "AttestedWorldID",
  },
  {
    threat: "Replayed query",
    defence:
      "queryId = keccak(chainKey, blockHeight, txIndex) is recorded; a second submission is refused.",
    error: "QueryAlreadyProcessed(bytes32)",
    test: "test_RevertsOnReplayOfTheSameQuery",
    suite: "AttestedWorldID",
  },
  {
    threat: "A query replayed inside a batch",
    defence: "Batching does not launder a replay — the same guard applies per entry.",
    error: "QueryAlreadyProcessed(bytes32)",
    test: "test_BatchRejectsARepeatedQueryInsideOneBatch",
    suite: "AttestedWorldID",
  },
  {
    threat: "A batch replaying a root already relayed singly",
    defence: "The replay key is global, not per call.",
    error: "QueryAlreadyProcessed(bytes32)",
    test: "test_BatchRejectsAQueryAlreadyRelayedSingly",
    suite: "AttestedWorldID",
  },
  {
    threat: "Overwriting a recorded root",
    defence:
      "A root already in history cannot be re-dated to buy itself a fresh expiry window.",
    error: "CannotOverwriteRoot()",
    test: "test_RevertsWhenARootWouldBeOverwritten",
    suite: "AttestedWorldID",
  },
  {
    threat: "Oversized batch",
    defence:
      "executeBatch caps the number of transactions sharing one continuity proof at MAX_BATCH.",
    error: "BatchTooLarge(uint256)",
    test: "test_BatchRejectsMoreThanTen",
    suite: "AttestedWorldID",
  },
  {
    threat: "Out-of-order batch",
    defence:
      "Heights inside one batch must ascend, so a batch cannot smuggle a root past the chaining check.",
    error: "BatchOutOfOrder()",
    test: "test_BatchRejectsOutOfOrderHeights",
    suite: "AttestedWorldID",
  },
  {
    threat: "Empty batch",
    defence: "A batch with nothing in it is refused rather than silently succeeding.",
    error: "EmptyBatch()",
    test: "test_BatchRejectsEmpty",
    suite: "AttestedWorldID",
  },
  {
    threat: "Mismatched batch arrays",
    defence: "Heights, transactions and proofs must line up one for one.",
    error: "BatchLengthMismatch()",
    test: "test_BatchRejectsMismatchedLengths",
    suite: "AttestedWorldID",
  },
  {
    threat: "Stale root past expiry",
    defence:
      "rootHistory entries expire after a week, so an identity set cannot be replayed forever.",
    error: "ExpiredRoot()",
    test: "test_RootsExpireAfterOneWeek",
    suite: "AttestedWorldID",
  },
  {
    threat: "An ancient root side-filled for a fresh expiry",
    defence:
      "A root is dated by its source block, not by arrival, so back-filling an old genuine root does not hand it a new week of validity.",
    error: "ExpiredRoot()",
    test: "test_AnAncientSideFilledRootArrivesAlreadyExpired",
    suite: "AttestedWorldID",
  },
  {
    threat: "A proof against a root that was never relayed",
    defence: "verifyProof checks root membership before it spends gas on Groth16.",
    error: "NonExistentRoot()",
    test: "test_VerifyProofRejectsAnUnknownRootBeforeTouchingTheVerifier",
    suite: "AttestedWorldID",
  },
  {
    threat: "A garbage zero-knowledge proof",
    defence: "The Semaphore verifier on bn128 rejects it on Creditcoin itself.",
    test: "test_VerifyProofRejectsAGarbageProof",
    suite: "AttestedWorldID",
  },

  // -------------------------------------------------------------- personhood
  {
    threat: "Proof for a different wallet, or reused across actions",
    defence:
      "signalHash binds the proof to msg.sender and externalNullifierHash binds it to this app id and action; either mismatch fails Groth16.",
    test: "test_RevertsWhenTheProofIsRejected",
    suite: "HumanRegistry",
  },
  {
    threat: "A signal that is not the caller",
    defence:
      "signalHashOf is derived from msg.sender, so a proof cannot be lifted to another wallet.",
    test: "test_TheSignalHashIsCallerSpecific",
    suite: "HumanRegistry",
  },
  {
    threat: "Double registration",
    defence: "A wallet already bound to one nullifier cannot be claimed by another human.",
    error: "WalletAlreadyHuman(address,uint256)",
    test: "test_RevertsWhenTheWalletAlreadyBelongsToAnotherHuman",
    suite: "HumanRegistry",
  },
  {
    threat: "Re-binding to the wallet already bound",
    defence: "A no-op re-bind is refused rather than emitting a misleading HumanRebound event.",
    error: "SameWallet()",
    test: "test_RevertsOnRegisteringTheSameWalletTwice",
    suite: "HumanRegistry",
  },
  {
    threat: "Registering a zero nullifier",
    defence: "Nullifier 0 is the sentinel for 'not a human'; it can never be bound to a wallet.",
    error: "ZeroNullifier()",
    test: "test_RevertsOnAZeroNullifier",
    suite: "HumanRegistry",
  },

  // ------------------------------------------------------------------ credit
  {
    threat: "Acting from a non-human wallet",
    defence: "Every line function resolves the human through the registry first.",
    error: "NotHuman(address)",
    test: "test_NonHumansCannotTouchTheLine",
    suite: "CreditLine",
  },
  {
    threat: "Borrowing without a line",
    defence: "borrow requires an opened line, keyed by nullifier.",
    error: "NoLine(uint256)",
    test: "test_BorrowingWithoutALineReverts",
    suite: "CreditLine",
  },
  {
    threat: "Borrowing over the limit",
    defence: "borrow checks principal + amount + fee against the line's limit.",
    error: "OverLimit(uint256,uint256)",
    test: "test_BorrowingPastTheLimitReverts",
    suite: "CreditLine",
  },
  {
    threat: "Borrowing more than the pool holds",
    defence:
      "borrow checks the requested amount against idle liquidity, not just against the limit.",
    error: "InsufficientLiquidity(uint256,uint256)",
    test: "test_BorrowingMoreThanTheIdleBalanceReverts",
    suite: "CreditLine",
  },
  {
    threat: "A second line for the same human",
    defence: "Lines are keyed by nullifier, so a re-bound wallet finds the existing line.",
    error: "LineExists(uint256)",
    test: "test_ASecondWalletCannotOpenASecondLine",
    suite: "CreditLine",
  },
  {
    threat: "Opening twice from one wallet",
    defence: "The same guard, from the obvious direction.",
    error: "LineExists(uint256)",
    test: "test_OpeningTwiceFromTheSameWalletReverts",
    suite: "CreditLine",
  },
  {
    threat: "Default freeze survives a re-bind",
    defence: "The freeze lives on the human, not the wallet; binding a fresh key changes nothing.",
    error: "LineFrozen(uint256)",
    test: "test_DefaultSurvivesAWalletRebind",
    suite: "CreditLine",
  },
  {
    threat: "Declaring a default too early",
    defence: "markDefault requires now > dueAt + GRACE and a non-zero principal.",
    error: "NotInDefault(uint256,uint64,uint64)",
    test: "test_MarkDefaultBeforeGraceEndsReverts",
    suite: "CreditLine",
  },
  {
    threat: "Declaring a default on a clean line",
    defence: "Nothing is owed, so there is nothing to write off.",
    error: "NothingOwed(uint256)",
    test: "test_MarkDefaultOnACleanLineReverts",
    suite: "CreditLine",
  },
  {
    threat: "Withdrawing more shares than you own",
    defence: "withdraw checks the lender's share balance before touching the pool.",
    error: "InsufficientShares(uint256,uint256)",
    test: "test_WithdrawingMoreSharesThanHeldReverts",
    suite: "CreditLine",
  },
  {
    threat: "A first-depositor donation attack",
    defence:
      "A virtual-share offset bounds the classic inflation attack, so an attacker cannot skim the next depositor.",
    test: "test_ADonationAttackCannotSkimTheNextDepositor",
    suite: "CreditLine",
  },
  {
    threat: "Zero-value calls",
    defence:
      "Deposit, withdraw, borrow and repay all refuse zero rather than emitting empty events.",
    error: "ZeroAmount()",
    test: "test_ZeroAmountsRevert",
    suite: "CreditLine",
  },
];
