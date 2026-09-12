// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {TxBytes} from "./harness/TxBytes.sol";
import {AttestedWorldIDHarness} from "./harness/AttestedWorldIDHarness.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";

import {RelayReward} from "../src/RelayReward.sol";
import {IAttestedWorldID} from "../src/interfaces/IAttestedWorldID.sol";

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @dev A relayer contract with no way to receive native tCTC.
contract NoReceive {
    function relay(RelayReward vault, address target, bytes memory callData) external {
        (bool ok, bytes memory ret) = address(vault).call(callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        target;
    }

    function claim(RelayReward vault) external {
        vault.claim();
    }
}

/// @dev Receives the reward and immediately tries to re-enter the vault.
contract Reenterer {
    RelayReward public vault;
    bool public reentered;
    bytes4 public reentrySelector;

    function arm(RelayReward v, bytes4 selector) external {
        vault = v;
        reentrySelector = selector;
    }

    function go(bytes memory callData) external {
        (bool ok, bytes memory ret) = address(vault).call(callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {
        (bool ok,) = address(vault).call(abi.encodeWithSelector(reentrySelector));
        reentered = ok;
        require(!ok, "reentry must fail");
        revert("reject payment");
    }
}

contract RelayRewardTest is Fixtures {
    uint64 internal constant FINALITY_DEPTH = 32;
    uint64 internal constant TIP_LEAD = 1_000; // 12,000 s of source-block age
    uint256 internal constant REWARD = 0.002 ether;
    uint256 internal constant MAX_AGE = 6 hours;

    AttestedWorldIDHarness internal relay;
    AttestedWorldIDHarness internal other;
    RelayReward internal vault;
    ProofFixture internal mainnet;

    address internal alice = makeAddr("alice");
    uint256 internal bootRoot;

    function setUp() public {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        relay = new AttestedWorldIDHarness(3, MAINNET_IDENTITY_MANAGER, FINALITY_DEPTH, 3, 12);
        other = new AttestedWorldIDHarness(1, SEPOLIA_IDENTITY_MANAGER, FINALITY_DEPTH, 3, 12);
        mainnet = loadFixture(MAINNET_FIXTURE);
        vm.warp(1_760_000_000);
        relay.setAttestedTip(uint64(mainnet.headerNumber) + TIP_LEAD);

        address[] memory relays = new address[](2);
        relays[0] = address(relay);
        relays[1] = address(other);
        vault = new RelayReward(relays, REWARD, MAX_AGE);
        vm.deal(address(this), 100 ether);
        vault.fund{value: 1 ether}();
    }

    // -----------------------------------------------------------------------------------
    //                                       PAYING
    // -----------------------------------------------------------------------------------

    function test_PaysTheCallerPerFreshRoot() public {
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 2);

        uint256 before = alice.balance;
        vm.expectEmit(true, true, false, true, address(vault));
        emit RelayReward.Relayed(alice, address(relay), 2, 2, 2 * REWARD, 0, 0);
        vm.prank(alice);
        (uint256 roots, uint256 rewarded) = vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));

        assertEq(roots, 2);
        assertEq(rewarded, 2);
        assertEq(alice.balance - before, 2 * REWARD, "paid 2 roots");
        assertEq(vault.rootsRewarded(), 2);
        assertEq(vault.totalRewarded(), 2 * REWARD);
        assertEq(relay.rootCount(), 4, "the relay itself happened");
    }

    function test_TheRelayRecordsTheVaultAsMsgSender() public {
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        vm.expectEmit(false, false, false, false, address(relay));
        emit IAttestedWorldID.RootRelayed(bytes32(0), 0, 0, 0, 0, 0, 0, address(vault));
        vm.prank(alice);
        vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
    }

    function test_BootstrapThroughTheVaultPaysAtMostTenRoots() public {
        (uint256 pre,, uint256 post) = _treeChangeFromLogs(mainnet.txBytes);
        pre;
        uint64[] memory h = new uint64[](10);
        bytes[] memory txs = new bytes[](10);
        INativeQueryVerifier.MerkleProof[] memory p = new INativeQueryVerifier.MerkleProof[](10);
        h[0] = mainnet.headerNumber;
        txs[0] = mainnet.txBytes;
        p[0] = merkleProofOf(mainnet);
        uint256 root = post;
        for (uint256 i = 1; i < 10; ++i) {
            uint256 next = uint256(keccak256(abi.encode("cap", i)));
            h[i] = mainnet.headerNumber + uint64(i);
            txs[i] = _registerTx(root, next, 1);
            p[i] = syntheticMerkleProof(uint64(i), 6);
            root = next;
        }
        vm.prank(alice);
        (uint256 roots, uint256 rewarded) = vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        assertEq(roots, 11, "bootstrap records the pre-root too");
        assertEq(rewarded, 10, "capped");
        assertEq(alice.balance, 10 * REWARD);
    }

    // -----------------------------------------------------------------------------------
    //                                    NOT PAYING
    // -----------------------------------------------------------------------------------

    function test_ASideFillThatDoesNotMoveTheTipEarnsNothing() public {
        _bootstrapDirect();
        (uint256 pre,,) = _treeChangeFromLogs(mainnet.txBytes);
        // Advance the tip first so preRoot is historical, then side-fill a sibling of it.
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        relay.executeBatch(3, h, txs, p, continuityProofOf(mainnet));

        uint64[] memory h2 = new uint64[](1);
        bytes[] memory t2 = new bytes[](1);
        INativeQueryVerifier.MerkleProof[] memory p2 = new INativeQueryVerifier.MerkleProof[](1);
        h2[0] = mainnet.headerNumber + 50;
        t2[0] = _registerTx(pre, uint256(keccak256("side")), 1);
        p2[0] = syntheticMerkleProof(40, 6);

        vm.prank(alice);
        (uint256 roots, uint256 rewarded) = vault.relay(address(relay), 3, h2, t2, p2, continuityProofOf(mainnet));
        assertEq(roots, 1, "recorded");
        assertEq(rewarded, 0, "tip did not move");
        assertEq(alice.balance, 0);
    }

    function test_AStaleTipEarnsNothing() public {
        _bootstrapDirect();
        // 3,000 blocks * 12 s = 10 h of source-block age, past the 6 h limit.
        relay.setAttestedTip(uint64(mainnet.headerNumber) + 3_000);
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        vm.prank(alice);
        (, uint256 rewarded) = vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        assertEq(rewarded, 0);
        assertEq(alice.balance, 0);
    }

    function test_AnUnlistedRelayIsRefused() public {
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(1, 1);
        vm.expectRevert(abi.encodeWithSelector(RelayReward.UnknownRelay.selector, address(0xdead)));
        vault.relay(address(0xdead), 3, h, txs, p, continuityProofOf(mainnet));
    }

    function test_ARejectedRelayRevertsAndPaysNothing() public {
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAttestedWorldID.WrongSourceChain.selector, uint64(1), uint64(3)));
        vault.relay(address(relay), 1, h, txs, p, continuityProofOf(mainnet));
        assertEq(address(vault).balance, 1 ether);
    }

    function test_TheSameRootCannotBePaidTwice() public {
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        vm.prank(alice);
        vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        vm.prank(alice);
        vm.expectRevert();
        vault.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        assertEq(alice.balance, REWARD);
    }

    // -----------------------------------------------------------------------------------
    //                                  FUNDING EDGES
    // -----------------------------------------------------------------------------------

    function test_AnEmptyVaultStillRelaysAndReportsTheShortfall() public {
        address[] memory relays = new address[](1);
        relays[0] = address(relay);
        RelayReward empty = new RelayReward(relays, REWARD, MAX_AGE);
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 2);
        vm.expectEmit(true, true, false, true, address(empty));
        emit RelayReward.Relayed(alice, address(relay), 2, 2, 0, 0, 2 * REWARD);
        vm.prank(alice);
        empty.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        assertEq(relay.rootCount(), 4);
    }

    function test_APartlyFundedVaultPaysWhatItHas() public {
        address[] memory relays = new address[](1);
        relays[0] = address(relay);
        RelayReward thin = new RelayReward(relays, REWARD, MAX_AGE);
        (bool ok,) = address(thin).call{value: REWARD / 2}("");
        assertTrue(ok);
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        vm.prank(alice);
        thin.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        assertEq(alice.balance, REWARD / 2);
        assertEq(address(thin).balance, 0);
    }

    function test_ARelayerThatCannotReceiveIsCreditedAndCanClaimNothingElse() public {
        NoReceive bot = new NoReceive();
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        bot.relay(vault, address(relay), abi.encodeCall(RelayReward.relay, (address(relay), 3, h, txs, p, continuityProofOf(mainnet))));
        assertEq(vault.claimable(address(bot)), REWARD);
        assertEq(vault.totalClaimable(), REWARD);
        assertEq(vault.available(), 1 ether - REWARD, "reserved for the claim");
        vm.expectRevert(RelayReward.ClaimFailed.selector);
        bot.claim(vault);
    }

    function test_ClaimWithNothingOwedReverts() public {
        vm.expectRevert(RelayReward.NothingToClaim.selector);
        vault.claim();
    }

    function test_ReentryDuringPaymentIsRefusedAndTheRewardIsCredited() public {
        Reenterer bot = new Reenterer();
        bot.arm(vault, RelayReward.claim.selector);
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, 1);
        bot.go(abi.encodeCall(RelayReward.relay, (address(relay), 3, h, txs, p, continuityProofOf(mainnet))));
        assertEq(vault.claimable(address(bot)), REWARD, "payment failed, so it was credited");
        assertEq(address(vault).balance, 1 ether, "nothing left the vault");
    }

    function test_FundingEmitsAndIsAccepted() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit RelayReward.Funded(address(this), 3 ether);
        (bool ok,) = address(vault).call{value: 3 ether}("");
        assertTrue(ok);
        assertEq(vault.available(), 4 ether);
    }

    function test_ConstructorGuards() public {
        address[] memory none = new address[](0);
        vm.expectRevert(RelayReward.NoRelays.selector);
        new RelayReward(none, REWARD, MAX_AGE);

        address[] memory one = new address[](1);
        one[0] = address(relay);
        vm.expectRevert(RelayReward.ZeroReward.selector);
        new RelayReward(one, 0, MAX_AGE);

        address[] memory dupes = new address[](2);
        dupes[0] = address(relay);
        dupes[1] = address(relay);
        assertEq(new RelayReward(dupes, REWARD, MAX_AGE).relays().length, 1, "de-duplicated");
    }

    function test_ConfigurationIsPublic() public view {
        assertEq(vault.REWARD_PER_ROOT(), REWARD);
        assertEq(vault.MAX_ROOT_AGE(), MAX_AGE);
        assertEq(vault.MAX_REWARDED_ROOTS(), 10);
        assertTrue(vault.isRelay(address(relay)));
        assertTrue(vault.isRelay(address(other)));
        assertEq(vault.relays().length, 2);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_NeverPaysMoreThanItHoldsOrOwes(uint96 funding, uint8 n) public {
        uint256 count = bound(n, 1, 9);
        address[] memory relays = new address[](1);
        relays[0] = address(relay);
        RelayReward v = new RelayReward(relays, REWARD, MAX_AGE);
        vm.deal(address(v), uint256(funding));
        _bootstrapDirect();
        (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p) = _chain(bootRoot, count);
        vm.prank(alice);
        v.relay(address(relay), 3, h, txs, p, continuityProofOf(mainnet));
        uint256 owed = count * REWARD;
        uint256 expected = owed < funding ? owed : funding;
        assertEq(alice.balance, expected, "pays min(owed, balance)");
        assertEq(address(v).balance, uint256(funding) - expected, "no other outflow");
        assertEq(v.totalClaimable(), 0);
    }

    // -----------------------------------------------------------------------------------
    //                                       HELPERS
    // -----------------------------------------------------------------------------------

    function _bootstrapDirect() internal {
        (,, bootRoot) = _treeChangeFromLogs(mainnet.txBytes);
        relay.execute(
            0,
            mainnet.chainKey,
            mainnet.headerNumber,
            mainnet.txBytes,
            mainnet.merkleRoot,
            mainnet.siblings,
            mainnet.lowerEndpointDigest,
            mainnet.continuityRoots
        );
    }

    /// @dev `count` chained register transactions starting from `from`, one block apart.
    function _chain(uint256 from, uint256 count)
        internal
        view
        returns (uint64[] memory h, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory p)
    {
        h = new uint64[](count);
        txs = new bytes[](count);
        p = new INativeQueryVerifier.MerkleProof[](count);
        uint256 root = from;
        for (uint256 i; i < count; ++i) {
            uint256 next = uint256(keccak256(abi.encode("chain", from, i)));
            h[i] = mainnet.headerNumber + 1 + uint64(i);
            txs[i] = _registerTx(root, next, 2);
            p[i] = syntheticMerkleProof(uint64(10 + i), 6);
            root = next;
        }
    }

    function _registerTx(uint256 preRoot, uint256 postRoot, uint32 humansAdded) internal view returns (bytes memory) {
        (,,,,,, bytes memory data) = TxBytes.common(mainnet.txBytes);
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = TREE_CHANGED_TOPIC;
        topics[1] = bytes32(preRoot);
        topics[2] = bytes32(0);
        topics[3] = bytes32(postRoot);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: MAINNET_IDENTITY_MANAGER, topics: topics, data: ""});
        return TxBytes.withLogs(
            TxBytes.withData(mainnet.txBytes, TxBytes.retargetRegister(data, preRoot, postRoot, humansAdded)),
            logs
        );
    }

    function _treeChangeFromLogs(bytes memory txBytes) internal pure returns (uint256 pre, uint8 kind, uint256 post) {
        (,, EvmV1Decoder.LogEntryTuple[] memory logs,) = TxBytes.receipt(txBytes);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == TREE_CHANGED_TOPIC) {
                return (uint256(logs[i].topics[1]), uint8(uint256(logs[i].topics[2])), uint256(logs[i].topics[3]));
            }
        }
        revert("no TreeChanged");
    }
}
