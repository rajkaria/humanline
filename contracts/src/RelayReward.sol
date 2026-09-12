// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice The slice of `AttestedWorldID` the vault needs.
interface IRewardedRelay {
    function executeBatch(
        uint64 chainKey,
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external;

    function rootCount() external view returns (uint256);

    function latestRoot() external view returns (uint256);

    function rootHistory(uint256 root) external view returns (uint128);
}

/// @title RelayReward
/// @notice A permissionless tip jar for World ID root relayers. Anyone can fund it; anyone who
///         carries a *fresh* World ID root to Creditcoin through it is paid per root, so keeping
///         Humanline's roots current never depends on one operator staying online.
/// @dev The vault never judges a proof. It forwards to `AttestedWorldID.executeBatch`, which proves
///      the source transaction through the 0x0FD2 precompile and applies every guard, and pays only
///      for what that call demonstrably changed: the `rootCount` delta.
///
///      What stops farming:
///        - A root can be relayed exactly once (`AttestedWorldID` keys replay by query id), so the
///          same work cannot be paid twice, through the vault or around it.
///        - A call is paid only if it moved the tip (`latestRoot` changed). Side-filling genuine
///          historical roots advances nothing a borrower needs, so it earns nothing.
///        - The new tip must be fresh: `AttestedWorldID` dates roots by their *source block*, and a
///          tip older than `MAX_ROOT_AGE` earns nothing.
///        - At most `MAX_REWARDED_ROOTS` are paid per call, so padding a genuine tip advance with
///          side-fills is bounded by World's own update cadence (about one tip per hour).
///      A relayer that cannot receive native tCTC (a contract without `receive`) is credited and
///      can `claim` later. There is no owner, no withdrawal and no parameter change: funds only
///      leave as rewards.
contract RelayReward {
    /// @notice Most roots paid for in one call.
    uint256 public constant MAX_REWARDED_ROOTS = 10;

    /// @notice tCTC wei paid per rewarded root.
    uint256 public immutable REWARD_PER_ROOT;
    /// @notice A new tip older than this (by its source block) earns nothing.
    uint256 public immutable MAX_ROOT_AGE;

    /// @notice The `AttestedWorldID` instances the vault pays for.
    mapping(address relay => bool) public isRelay;
    address[] private _relays;

    /// @notice Owed to relayers whose direct payment could not be delivered.
    mapping(address relayer => uint256 amount) public claimable;
    /// @notice Sum of `claimable`; reserved, never used to pay a new reward.
    uint256 public totalClaimable;

    /// @notice Cumulative tCTC credited to relayers (paid now or claimable).
    uint256 public totalRewarded;
    /// @notice Cumulative roots rewarded.
    uint256 public rootsRewarded;

    uint256 private _locked = 1;

    event Funded(address indexed from, uint256 amount);
    /// @param relayer Who called the vault.
    /// @param relay The `AttestedWorldID` instance relayed to.
    /// @param roots Roots the call recorded (the `rootCount` delta).
    /// @param rewardedRoots Roots paid for (0 when the tip did not advance or is stale).
    /// @param paid Sent to `relayer` now.
    /// @param credited Credited to `claimable` because the transfer failed.
    /// @param shortfall Owed but not covered by the vault's free balance.
    event Relayed(
        address indexed relayer,
        address indexed relay,
        uint256 roots,
        uint256 rewardedRoots,
        uint256 paid,
        uint256 credited,
        uint256 shortfall
    );
    event Claimed(address indexed relayer, uint256 amount);

    error UnknownRelay(address relay);
    error NoRelays();
    error Reentrancy();
    error NothingToClaim();
    error ClaimFailed();
    error ZeroReward();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param relays_ The `AttestedWorldID` instances to pay for.
    /// @param rewardPerRoot tCTC wei per rewarded root.
    /// @param maxRootAge Seconds; the relayed tip's source-block age must not exceed it.
    constructor(address[] memory relays_, uint256 rewardPerRoot, uint256 maxRootAge) {
        if (relays_.length == 0) revert NoRelays();
        if (rewardPerRoot == 0) revert ZeroReward();
        for (uint256 i; i < relays_.length; ++i) {
            if (relays_[i] == address(0)) revert UnknownRelay(address(0));
            if (!isRelay[relays_[i]]) {
                isRelay[relays_[i]] = true;
                _relays.push(relays_[i]);
            }
        }
        REWARD_PER_ROOT = rewardPerRoot;
        MAX_ROOT_AGE = maxRootAge;
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Every relay instance this vault pays for.
    function relays() external view returns (address[] memory) {
        return _relays;
    }

    /// @notice Balance not reserved for pending claims: what new rewards are paid from.
    function available() public view returns (uint256) {
        return address(this).balance - totalClaimable;
    }

    /// @notice Relay a batch of World ID updates through the vault and get paid for fresh roots.
    /// @dev Arguments are exactly `AttestedWorldID.executeBatch`'s; any revert there reverts here.
    function relay(
        address target,
        uint64 chainKey,
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external nonReentrant returns (uint256 roots, uint256 rewardedRoots) {
        if (!isRelay[target]) revert UnknownRelay(target);
        IRewardedRelay r = IRewardedRelay(target);

        uint256 countBefore = r.rootCount();
        uint256 tipBefore = _tipOf(r);

        r.executeBatch(chainKey, blockHeights, encodedTransactions, merkleProofs, sharedContinuityProof);

        roots = r.rootCount() - countBefore;
        uint256 tipAfter = _tipOf(r);
        if (tipAfter != tipBefore && tipAfter != 0 && _isFresh(r.rootHistory(tipAfter))) {
            rewardedRoots = roots < MAX_REWARDED_ROOTS ? roots : MAX_REWARDED_ROOTS;
        }

        uint256 owed = rewardedRoots * REWARD_PER_ROOT;
        uint256 free = available();
        uint256 amount = owed < free ? owed : free;
        uint256 shortfall = owed - amount;

        uint256 paid;
        uint256 credited;
        if (amount > 0) {
            rootsRewarded += rewardedRoots;
            totalRewarded += amount;
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (ok) {
                paid = amount;
            } else {
                credited = amount;
                claimable[msg.sender] += amount;
                totalClaimable += amount;
            }
        }

        emit Relayed(msg.sender, target, roots, rewardedRoots, paid, credited, shortfall);
    }

    /// @notice Withdraw rewards that could not be sent directly.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert ClaimFailed();
        emit Claimed(msg.sender, amount);
    }

    /// @dev `latestRoot()` reverts `NoRootsSeen` before the first relay; that is "no tip yet".
    function _tipOf(IRewardedRelay r) private view returns (uint256) {
        try r.latestRoot() returns (uint256 root) {
            return root;
        } catch {
            return 0;
        }
    }

    function _isFresh(uint128 receivedAt) private view returns (bool) {
        return receivedAt != 0 && block.timestamp - receivedAt <= MAX_ROOT_AGE;
    }
}
