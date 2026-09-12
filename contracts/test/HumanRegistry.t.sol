// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "./mocks/MockWorldID.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {IHumanRegistry} from "../src/interfaces/IHumanRegistry.sol";
import {ByteHasher} from "../src/libraries/ByteHasher.sol";

contract HumanRegistryTest is Test {
    using ByteHasher for bytes;

    /// @dev The real Humanline World app and action, so the external nullifier under test is the
    ///      production value the World App will actually sign over.
    string internal constant APP_ID = "app_87b24915fcf733f10df1b0c46dd1f783";
    string internal constant ACTION = "humanline-register";

    /// @dev Computed independently (keccak256, >> 8) outside Solidity.
    uint256 internal constant EXPECTED_EXTERNAL_NULLIFIER =
        36596970293774605613734671771514449078566945350393905550375231679264283006;

    MockWorldID internal worldId;
    HumanRegistry internal registry;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant NULLIFIER = uint256(keccak256("alice-nullifier"));
    uint256 internal constant ROOT = uint256(keccak256("a world id root"));

    uint256[8] internal proof;

    function setUp() public {
        worldId = new MockWorldID();
        registry = new HumanRegistry(address(worldId), APP_ID, ACTION);
        vm.warp(1_760_000_000);
    }

    function test_ExternalNullifierMatchesTheProductionVector() public view {
        assertEq(registry.EXTERNAL_NULLIFIER_HASH(), EXPECTED_EXTERNAL_NULLIFIER, "external nullifier");
        assertEq(registry.APP_ID(), APP_ID, "app id");
        assertEq(registry.ACTION(), ACTION, "action");
        assertEq(registry.WORLD_ID(), address(worldId), "world id");
    }

    function test_RegisterBindsTheWalletAndProvesTheRightInputs() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit IHumanRegistry.HumanRegistered(NULLIFIER, alice, ROOT);

        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);

        assertTrue(registry.isHuman(alice), "alice is human");
        assertEq(registry.humanOf(alice), NULLIFIER, "humanOf");
        assertEq(registry.walletOf(NULLIFIER), alice, "walletOf");
        assertEq(registry.registeredAt(NULLIFIER), uint64(block.timestamp), "registeredAt");
        assertEq(registry.humanCount(), 1, "humanCount");

        assertEq(worldId.lastRoot(), ROOT, "root forwarded");
        assertEq(worldId.lastNullifierHash(), NULLIFIER, "nullifier forwarded");
        assertEq(
            worldId.lastSignalHash(), abi.encodePacked(alice).hashToField(), "signal is the caller wallet"
        );
        assertEq(
            worldId.lastExternalNullifierHash(), EXPECTED_EXTERNAL_NULLIFIER, "external nullifier forwarded"
        );
    }

    function test_RebindMovesTheHumanToANewWallet() public {
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);
        uint64 firstSeen = registry.registeredAt(NULLIFIER);

        vm.warp(block.timestamp + 30 days);
        vm.expectEmit(true, true, true, true, address(registry));
        emit IHumanRegistry.HumanRebound(NULLIFIER, alice, bob);

        vm.prank(bob);
        registry.register(ROOT, NULLIFIER, proof);

        assertFalse(registry.isHuman(alice), "old wallet unbound");
        assertEq(registry.humanOf(alice), 0, "old wallet cleared");
        assertEq(registry.humanOf(bob), NULLIFIER, "new wallet bound");
        assertEq(registry.walletOf(NULLIFIER), bob, "walletOf follows");
        assertEq(registry.registeredAt(NULLIFIER), firstSeen, "first-seen timestamp is preserved");
        assertEq(registry.humanCount(), 1, "still one human");
    }

    function test_RevertsWhenTheWalletAlreadyBelongsToAnotherHuman() public {
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);

        uint256 otherHuman = uint256(keccak256("someone-else"));
        vm.expectRevert(
            abi.encodeWithSelector(IHumanRegistry.WalletAlreadyHuman.selector, alice, NULLIFIER)
        );
        vm.prank(alice);
        registry.register(ROOT, otherHuman, proof);
    }

    function test_RevertsOnRegisteringTheSameWalletTwice() public {
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);
        vm.expectRevert(IHumanRegistry.SameWallet.selector);
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);
    }

    function test_RevertsOnAZeroNullifier() public {
        vm.expectRevert(IHumanRegistry.ZeroNullifier.selector);
        vm.prank(alice);
        registry.register(ROOT, 0, proof);
    }

    function test_RevertsWhenTheProofIsRejected() public {
        worldId.setAccepts(false);
        vm.expectRevert(MockWorldID.ProofRejected.selector);
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);
        assertEq(registry.humanCount(), 0, "nothing bound");
    }

    /// @dev A proof carries the wallet it was generated for, so lifting it out of the mempool and
    ///      submitting it from another wallet changes the signal hash the verifier is asked about.
    function test_TheSignalHashIsCallerSpecific() public {
        vm.prank(alice);
        registry.register(ROOT, NULLIFIER, proof);
        uint256 aliceSignal = worldId.lastSignalHash();

        uint256 bobNullifier = uint256(keccak256("bob-nullifier"));
        vm.prank(bob);
        registry.register(ROOT, bobNullifier, proof);

        assertTrue(aliceSignal != worldId.lastSignalHash(), "different wallets, different signals");
        assertEq(registry.signalHashOf(bob), worldId.lastSignalHash(), "helper agrees");
        assertEq(registry.humanCount(), 2, "two humans");
    }
}
