// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title IAttestedWorldID
/// @notice Public surface of the Humanline root relay: a World ID root mirror on Creditcoin whose
///         only trusted input is an Attestcoin proof of a source-chain `registerIdentities` /
///         `deleteIdentities` transaction.
/// @dev The implementing contract is also an `IWorldID` (it inherits Worldcoin's `WorldIDBridge`),
///      so `verifyProof` / `verifyCompressedProof` / `rootHistory` / `getTreeDepth` /
///      `rootHistoryExpiry` come from there and are not redeclared here.
///      `rootHistory(uint256)` in particular CANNOT be declared in this interface: `WorldIDBridge`
///      exposes it as a public state variable, and Solidity forbids a public state variable from
///      satisfying an interface function it does not itself carry an `override` specifier for
///      (and the vendored file must not be modified). It is still present in the deployed ABI.
interface IAttestedWorldID {
    /// @notice Emitted once per successfully relayed source-chain tree update.
    /// @param queryId Attestcoin query id: keccak(chainKey, blockHeight << 192, txIndex).
    /// @param sourceBlock Source-chain block height the proved transaction was mined in.
    /// @param postRoot The new World ID root, now mirrored on Creditcoin.
    /// @param preRoot The root the source tree moved from.
    /// @param kind `TreeChanged` kind byte (0 = insertion, 1 = deletion, ...).
    /// @param humansAdded Number of identity commitments inserted by this transaction.
    /// @param sourceTxIndex Index of the proved transaction inside its source block.
    /// @param relayer `msg.sender` of the relaying call.
    event RootRelayed(
        bytes32 indexed queryId,
        uint64 indexed sourceBlock,
        uint256 indexed postRoot,
        uint256 preRoot,
        uint8 kind,
        uint32 humansAdded,
        uint256 sourceTxIndex,
        address relayer
    );

    /// @notice The proved transaction came from a chain this relay does not mirror.
    error WrongSourceChain(uint64 got, uint64 want);
    /// @notice The proved source transaction reverted (receipt status != 1).
    error SourceTxReverted();
    /// @notice The proved transaction did not call the World ID identity manager.
    error NotIdentityManager(address to);
    /// @notice The proved transaction emitted no `TreeChanged` log from the identity manager.
    error NoTreeChange();
    /// @notice More than one genuine `TreeChanged` log: the update is ambiguous.
    error AmbiguousTreeChange(uint256 count);
    /// @notice Calldata and log disagree, or the selector is not a tree-changing one.
    error CalldataLogMismatch();
    /// @notice `preRoot` is neither the latest root nor a known historical root.
    error UnknownPreRoot(uint256 preRoot);
    /// @notice The source block is not yet buried under `FINALITY_DEPTH` attested blocks.
    error NotFinal(uint64 attestedTip, uint64 sourceBlock);
    /// @notice Fewer bonded attestors than `MIN_ATTESTORS` back this source chain.
    error ThinQuorum(uint32 have, uint32 want);

    // --- batching (not enumerated in the plan's interface sketch; required by `executeBatch`) ---

    /// @notice `executeBatch` was called with no transactions.
    error EmptyBatch();
    /// @notice `executeBatch` was called with more than `MAX_BATCH` transactions.
    error BatchTooLarge(uint256 size);
    /// @notice `executeBatch` array arguments have differing lengths.
    error BatchLengthMismatch();
    /// @notice `executeBatch` block heights are not non-decreasing.
    error BatchOutOfOrder();
    /// @notice The block-prover precompile rejected the batch proof.
    error BatchProofRejected();
    /// @notice This exact source transaction has already been relayed.
    error QueryAlreadyProcessed(bytes32 queryId);
    /// @notice `_processAndEmitEvent` was reached through an entrypoint it cannot read context from.
    error UnsupportedEntrypoint(bytes4 selector);
    /// @notice The root-history expiry is fixed at one week; there is no admin to change it.
    error RootHistoryExpiryImmutable();

    /// @notice Creditcoin chain key of the source chain this relay mirrors (3 = Ethereum mainnet).
    function SOURCE_CHAIN_KEY() external view returns (uint64);
    /// @notice The World ID identity manager on the source chain.
    function IDENTITY_MANAGER() external view returns (address);
    /// @notice Attested blocks that must sit above a source block before it is relayable.
    function FINALITY_DEPTH() external view returns (uint64);
    /// @notice Minimum bonded attestor count for the source chain.
    function MIN_ATTESTORS() external view returns (uint32);
    /// @notice Largest `executeBatch` size.
    function MAX_BATCH() external view returns (uint256);

    /// @notice Most recently relayed root. Reverts `NoRootsSeen` before the first relay.
    function latestRoot() external view returns (uint256);
    /// @notice Number of roots recorded in history (bootstrap records two).
    function rootCount() external view returns (uint256);
    /// @notice Sum of identity commitments inserted across every relayed transaction.
    function humansAddedTotal() external view returns (uint256);
    /// @notice True when `root` is the latest root or an unexpired historical root.
    function isValidRoot(uint256 root) external view returns (bool);

    /// @notice Relay up to `MAX_BATCH` proved source transactions that share one continuity proof.
    /// @dev Heights must be non-decreasing; every transaction is processed in array order and
    ///      deduplicated individually by query id.
    function executeBatch(
        uint64 chainKey,
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external;
}
