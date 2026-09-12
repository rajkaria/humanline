/**
 * The attack list from `docs/SPEC.md` §9, paired with the named custom error the
 * contract reverts with and the Foundry test that fires it.
 *
 * Every custom error named here is asserted to exist in the compiled artifact by
 * `test/abi.test.ts`, so `/judge` can never advertise an error the contracts do
 * not actually raise. The test names follow the suite's `test_RevertWhen_*`
 * convention; `/judge` also prints the single command that runs the whole
 * negative-path suite, which is the check that does not depend on any individual
 * name.
 */

export type NegativePath = {
  threat: string;
  /** What stops it. */
  defence: string;
  /** The custom error the transaction reverts with, when there is one. */
  error?: string;
  /** The Foundry test that exercises it. */
  test: string;
  suite: "AttestedWorldID" | "HumanRegistry" | "CreditLine";
};

export const NEGATIVE_PATHS: NegativePath[] = [
  {
    threat: "Forged root",
    defence: "The 0x0FD2 precompile rejects a proof that does not match Creditcoin's attested view of Ethereum.",
    test: "test_RevertWhen_ForgedRoot",
    suite: "AttestedWorldID",
  },
  {
    threat: "Tampered payload",
    defence: "Flipping a byte of the encoded transaction breaks Merkle inclusion.",
    test: "test_RevertWhen_TamperedPayload",
    suite: "AttestedWorldID",
  },
  {
    threat: "Wrong source chain",
    defence: "A mainnet proof submitted to the Sepolia instance is refused before anything else runs.",
    error: "WrongSourceChain(uint64,uint64)",
    test: "test_RevertWhen_WrongSourceChain",
    suite: "AttestedWorldID",
  },
  {
    threat: "Reverted source transaction",
    defence: "A failed registerIdentities proves nothing; the receipt status must be 1.",
    error: "SourceTxReverted()",
    test: "test_RevertWhen_SourceTxReverted",
    suite: "AttestedWorldID",
  },
  {
    threat: "Decoy TreeChanged from another contract",
    defence: "Both the transaction target and the log emitter must be World's identity manager.",
    error: "NotIdentityManager(address)",
    test: "test_RevertWhen_DecoyEmitter",
    suite: "AttestedWorldID",
  },
  {
    threat: "Calldata that disagrees with the log",
    defence: "The postRoot decoded from calldata must equal the one in the TreeChanged log.",
    error: "CalldataLogMismatch()",
    test: "test_RevertWhen_CalldataLogMismatch",
    suite: "AttestedWorldID",
  },
  {
    threat: "Replayed query",
    defence: "queryId = keccak(chainKey, blockHeight, txIndex) is recorded; a second submission is refused.",
    error: "QueryAlreadyProcessed(bytes32)",
    test: "test_RevertWhen_QueryReplayed",
    suite: "AttestedWorldID",
  },
  {
    threat: "Out-of-order root",
    defence: "preRoot must chain to a root the contract already knows, so roots can only arrive in sequence.",
    error: "UnknownPreRoot(uint256)",
    test: "test_RevertWhen_OutOfOrderRoot",
    suite: "AttestedWorldID",
  },
  {
    threat: "Root from an unfinalised block",
    defence: "The source block must be FINALITY_DEPTH behind the tip 0x0FD3 reports.",
    error: "NotFinal(uint64,uint64)",
    test: "test_RevertWhen_NotFinal",
    suite: "AttestedWorldID",
  },
  {
    threat: "Thin attestor set",
    defence: "0x0FD4 must report at least MIN_ATTESTORS backing the source chain.",
    error: "ThinQuorum(uint32,uint32)",
    test: "test_RevertWhen_ThinQuorum",
    suite: "AttestedWorldID",
  },
  {
    threat: "Stale root past expiry",
    defence:
      "rootHistory entries expire after a week. verifyProof refuses a proof built against a root older than that, so an identity set cannot be replayed forever.",
    error: "ExpiredRoot()",
    test: "test_RevertWhen_RootExpired",
    suite: "AttestedWorldID",
  },
  {
    threat: "Proof for a different wallet",
    defence: "signalHash is hashToField(abi.encodePacked(msg.sender)); a proof for another address fails Groth16.",
    test: "test_RevertWhen_SignalMismatch",
    suite: "HumanRegistry",
  },
  {
    threat: "Proof reused across actions",
    defence: "externalNullifierHash pins the proof to this app id and action.",
    test: "test_RevertWhen_WrongExternalNullifier",
    suite: "HumanRegistry",
  },
  {
    threat: "Double registration",
    defence: "A wallet already bound to a nullifier cannot be bound to a second one.",
    error: "WalletAlreadyHuman(address,uint256)",
    test: "test_RevertWhen_WalletAlreadyHuman",
    suite: "HumanRegistry",
  },
  {
    threat: "A transaction that is not registerIdentities or deleteIdentities",
    defence: "The function selector on the proven transaction must be one the contract understands.",
    error: "UnsupportedEntrypoint(bytes4)",
    test: "test_RevertWhen_UnsupportedEntrypoint",
    suite: "AttestedWorldID",
  },
  {
    threat: "Out-of-order batch",
    defence: "Roots inside one batch must ascend, so a batch cannot smuggle a root past the chaining check.",
    error: "BatchOutOfOrder()",
    test: "test_RevertWhen_BatchOutOfOrder",
    suite: "AttestedWorldID",
  },
  {
    threat: "Registering a zero nullifier",
    defence: "Nullifier 0 is the sentinel for 'not a human'; it can never be bound to a wallet.",
    error: "ZeroNullifier()",
    test: "test_RevertWhen_ZeroNullifier",
    suite: "HumanRegistry",
  },
  {
    threat: "Re-binding to the wallet already bound",
    defence: "A no-op re-bind is refused rather than emitting a misleading HumanRebound event.",
    error: "SameWallet()",
    test: "test_RevertWhen_SameWallet",
    suite: "HumanRegistry",
  },
  {
    threat: "Borrowing more than the pool holds",
    defence: "borrow checks the requested amount against idle liquidity, not just against the limit.",
    error: "InsufficientLiquidity(uint256,uint256)",
    test: "test_RevertWhen_InsufficientLiquidity",
    suite: "CreditLine",
  },
  {
    threat: "Withdrawing more shares than you own",
    defence: "withdraw checks the lender's share balance before touching the pool.",
    error: "InsufficientShares(uint256,uint256)",
    test: "test_RevertWhen_InsufficientShares",
    suite: "CreditLine",
  },
  {
    threat: "Borrowing over the limit",
    defence: "borrow checks principal + amount + fee against the line's limit.",
    error: "OverLimit(uint256,uint256)",
    test: "test_RevertWhen_OverLimit",
    suite: "CreditLine",
  },
  {
    threat: "Acting from a non-human wallet",
    defence: "Every line function resolves the human through the registry first.",
    error: "NotHuman(address)",
    test: "test_RevertWhen_NotHuman",
    suite: "CreditLine",
  },
  {
    threat: "A second line for the same human",
    defence: "Lines are keyed by nullifier, so a re-bound wallet finds the existing line.",
    error: "LineExists(uint256)",
    test: "test_RevertWhen_LineExists",
    suite: "CreditLine",
  },
  {
    threat: "Default freeze survives a re-bind",
    defence: "The freeze lives on the human, not the wallet; binding a fresh key changes nothing.",
    error: "LineFrozen(uint256)",
    test: "test_FreezeSurvivesRebind",
    suite: "CreditLine",
  },
  {
    threat: "Declaring a default too early",
    defence: "markDefault requires now > dueAt + GRACE and a non-zero principal.",
    error: "NotInDefault(uint256,uint64,uint64)",
    test: "test_RevertWhen_NotInDefault",
    suite: "CreditLine",
  },
  {
    threat: "Oversized batch",
    defence: "executeBatch bounds the number of transactions sharing one continuity proof at MAX_BATCH.",
    error: "BatchTooLarge(uint256)",
    test: "test_RevertWhen_BatchTooLarge",
    suite: "AttestedWorldID",
  },
];
