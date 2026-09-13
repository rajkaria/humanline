// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "./mocks/MockWorldID.sol";
import {HumanPoll} from "../src/examples/HumanPoll.sol";
import {HumanGated} from "../src/sdk/HumanGated.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";

/// @dev The smallest possible `HumanGated` consumer, for the modifiers themselves.
contract GatedDrop is HumanGated {
    uint256 public claims;

    constructor(address registry) HumanGated(registry) {}

    function claim() external oncePerHuman("drop-1") {
        claims += 1;
    }

    function claimSecondDrop() external oncePerHuman("drop-2") {
        claims += 1;
    }

    function humansOnly() external view onlyHuman returns (bool) {
        return true;
    }
}

contract HumanPollTest is Test {
    HumanRegistry internal registry;
    HumanPoll internal poll;
    GatedDrop internal drop;

    address internal alice = address(0xA11CE);
    address internal aliceNewWallet = address(0xA11CE2);
    address internal bob = address(0xB0B);
    address internal stranger = address(0x57A);

    uint256 internal constant ALICE = uint256(keccak256("alice-nullifier"));
    uint256 internal constant BOB = uint256(keccak256("bob-nullifier"));
    uint256[8] internal proof;

    function setUp() public {
        registry = new HumanRegistry(address(new MockWorldID()), "app_87b24915fcf733f10df1b0c46dd1f783", "humanline-register");
        poll = new HumanPoll(address(registry));
        drop = new GatedDrop(address(registry));
        vm.prank(alice);
        registry.register(1, ALICE, proof);
        vm.prank(bob);
        registry.register(1, BOB, proof);
    }

    function _options(uint256 n) internal pure returns (string[] memory o) {
        o = new string[](n);
        for (uint256 i; i < n; ++i) o[i] = string(abi.encodePacked("option ", bytes1(uint8(65 + i))));
    }

    function _open() internal returns (uint256 id) {
        vm.prank(alice);
        id = poll.createPoll("Should Humanline launch on mainnet?", _options(2), 1 days);
    }

    // ------------------------------------------------------------------ polls

    function test_AHumanOpensAPoll() public {
        vm.expectEmit(true, true, false, true, address(poll));
        emit HumanPoll.PollCreated(0, ALICE, alice, "Should Humanline launch on mainnet?", _options(2), uint64(block.timestamp + 1 days));
        uint256 id = _open();

        (address creator, uint256 creatorHuman, uint64 closesAt, string memory question, string[] memory options, uint256[] memory tally, uint256 voters) =
            poll.getPoll(id);
        assertEq(creator, alice);
        assertEq(creatorHuman, ALICE);
        assertEq(closesAt, block.timestamp + 1 days);
        assertEq(question, "Should Humanline launch on mainnet?");
        assertEq(options.length, 2);
        assertEq(tally.length, 2);
        assertEq(voters, 0);
        assertEq(poll.pollCount(), 1);
    }

    function test_OnlyHumansOpenPolls() public {
        vm.expectRevert(abi.encodeWithSelector(HumanGated.NotHuman.selector, stranger));
        vm.prank(stranger);
        poll.createPoll("spam", _options(2), 1 days);
    }

    function test_RefusesMalformedPolls() public {
        vm.startPrank(alice);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("", _options(2), 1 days);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll(string(new bytes(281)), _options(2), 1 days);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", _options(1), 1 days);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", _options(9), 1 days);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", _options(2), 10 minutes - 1);
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", _options(2), 90 days + 1);

        string[] memory emptyOption = _options(2);
        emptyOption[1] = "";
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", emptyOption, 1 days);
        emptyOption[1] = string(new bytes(65));
        vm.expectRevert(HumanPoll.BadPoll.selector);
        poll.createPoll("q", emptyOption, 1 days);

        // The boundaries themselves are fine.
        string[] memory widest = _options(8);
        widest[0] = string(new bytes(64));
        poll.createPoll(string(new bytes(280)), widest, 90 days);
        poll.createPoll("q", _options(2), 10 minutes);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ ballots

    function test_EachHumanVotesOnce() public {
        uint256 id = _open();
        vm.expectEmit(true, true, false, true, address(poll));
        emit HumanPoll.Voted(id, ALICE, alice, 1);
        vm.prank(alice);
        poll.vote(id, 1);
        vm.prank(bob);
        poll.vote(id, 0);

        (,,,,, uint256[] memory tally, uint256 voters) = poll.getPoll(id);
        assertEq(tally[0], 1);
        assertEq(tally[1], 1);
        assertEq(voters, 2);
        assertEq(poll.ballotOf(id, ALICE), 2, "option + 1");

        vm.expectRevert(abi.encodeWithSelector(HumanPoll.AlreadyVoted.selector, id, ALICE));
        vm.prank(alice);
        poll.vote(id, 0);
    }

    /// @dev The product claim: a new wallet is not a new voter.
    function test_ANewWalletIsNotANewVote() public {
        uint256 id = _open();
        vm.prank(alice);
        poll.vote(id, 0);

        vm.prank(aliceNewWallet);
        registry.register(1, ALICE, proof);
        vm.expectRevert(abi.encodeWithSelector(HumanPoll.AlreadyVoted.selector, id, ALICE));
        vm.prank(aliceNewWallet);
        poll.vote(id, 1);

        // And the old wallet no longer speaks for anyone.
        vm.expectRevert(abi.encodeWithSelector(HumanGated.NotHuman.selector, alice));
        vm.prank(alice);
        poll.vote(id, 1);
    }

    function test_StrangersCannotVote() public {
        uint256 id = _open();
        vm.expectRevert(abi.encodeWithSelector(HumanGated.NotHuman.selector, stranger));
        vm.prank(stranger);
        poll.vote(id, 0);
    }

    function test_BallotsCloseOnTime() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 days - 1);
        vm.prank(alice);
        poll.vote(id, 0);

        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(HumanPoll.PollClosed.selector, id, uint64(block.timestamp)));
        vm.prank(bob);
        poll.vote(id, 0);
    }

    function test_RefusesUnknownPollsAndOptions() public {
        vm.expectRevert(abi.encodeWithSelector(HumanPoll.UnknownPoll.selector, 7));
        vm.prank(alice);
        poll.vote(7, 0);
        vm.expectRevert(abi.encodeWithSelector(HumanPoll.UnknownPoll.selector, 7));
        poll.getPoll(7);

        uint256 id = _open();
        vm.expectRevert(abi.encodeWithSelector(HumanPoll.UnknownOption.selector, 2, 2));
        vm.prank(alice);
        poll.vote(id, 2);
    }

    function testFuzz_TallyEqualsVoters(uint8 aliceChoice, uint8 bobChoice) public {
        vm.prank(alice);
        uint256 id = poll.createPoll("q", _options(8), 1 days);
        vm.prank(alice);
        poll.vote(id, aliceChoice % 8);
        vm.prank(bob);
        poll.vote(id, bobChoice % 8);
        (,,,,, uint256[] memory tally, uint256 voters) = poll.getPoll(id);
        uint256 sum;
        for (uint256 i; i < tally.length; ++i) sum += tally[i];
        assertEq(sum, voters);
        assertEq(voters, 2);
    }

    // ------------------------------------------------------------------ HumanGated

    function test_OncePerHumanIsPerScope() public {
        vm.prank(alice);
        drop.claim();
        assertTrue(drop.usedBy("drop-1", ALICE));
        assertFalse(drop.usedBy("drop-2", ALICE));

        vm.expectRevert(abi.encodeWithSelector(HumanGated.AlreadyUsed.selector, bytes32("drop-1"), ALICE));
        vm.prank(alice);
        drop.claim();

        vm.prank(alice);
        drop.claimSecondDrop();
        vm.prank(bob);
        drop.claim();
        assertEq(drop.claims(), 3);
    }

    function test_OnlyHumanModifier() public {
        vm.prank(alice);
        assertTrue(drop.humansOnly());
        vm.expectRevert(abi.encodeWithSelector(HumanGated.NotHuman.selector, stranger));
        vm.prank(stranger);
        drop.humansOnly();
    }

    function test_RefusesAZeroRegistry() public {
        vm.expectRevert(HumanGated.ZeroRegistry.selector);
        new GatedDrop(address(0));
        vm.expectRevert(HumanGated.ZeroRegistry.selector);
        new HumanPoll(address(0));
    }
}
