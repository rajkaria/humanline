// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "./mocks/MockWorldID.sol";
import {HumanGate} from "../src/examples/HumanGate.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";

contract HumanGateTest is Test {
    MockWorldID internal worldId;
    HumanRegistry internal registry;
    HumanGate internal gate;

    address internal alice = address(0xA11CE);
    address internal aliceNewWallet = address(0xA11CE2);
    address internal stranger = address(0x57A);

    uint256 internal constant ALICE_HUMAN = uint256(keccak256("alice-nullifier"));
    uint256 internal constant ROOT = uint256(keccak256("root"));
    uint256[8] internal proof;

    function setUp() public {
        worldId = new MockWorldID();
        registry = new HumanRegistry(address(worldId), "app_87b24915fcf733f10df1b0c46dd1f783", "humanline-register");
        gate = new HumanGate(address(registry));
        vm.prank(alice);
        registry.register(ROOT, ALICE_HUMAN, proof);
    }

    function test_AHumanCanClaimOnce() public {
        vm.expectEmit(true, true, true, true, address(gate));
        emit HumanGate.Claimed(ALICE_HUMAN, alice);
        vm.prank(alice);
        gate.claim();

        assertTrue(gate.claimed(ALICE_HUMAN), "recorded against the human");

        vm.expectRevert(abi.encodeWithSelector(HumanGate.AlreadyClaimed.selector, ALICE_HUMAN));
        vm.prank(alice);
        gate.claim();
    }

    /// @dev The point of the whole project: a new wallet is not a new person.
    function test_ANewWalletCannotClaimAgain() public {
        vm.prank(alice);
        gate.claim();

        vm.prank(aliceNewWallet);
        registry.register(ROOT, ALICE_HUMAN, proof);

        vm.expectRevert(abi.encodeWithSelector(HumanGate.AlreadyClaimed.selector, ALICE_HUMAN));
        vm.prank(aliceNewWallet);
        gate.claim();
    }

    function test_AWalletWithNoHumanCannotClaim() public {
        vm.expectRevert(abi.encodeWithSelector(HumanGate.NotHuman.selector, stranger));
        vm.prank(stranger);
        gate.claim();
    }

    function test_DifferentHumansClaimIndependently() public {
        uint256 bobHuman = uint256(keccak256("bob-nullifier"));
        address bob = address(0xB0B);
        vm.prank(bob);
        registry.register(ROOT, bobHuman, proof);

        vm.prank(alice);
        gate.claim();
        vm.prank(bob);
        gate.claim();

        assertTrue(gate.claimed(ALICE_HUMAN) && gate.claimed(bobHuman), "both claimed");
    }
}
