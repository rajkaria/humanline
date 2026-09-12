// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HUSD} from "../src/HUSD.sol";

contract HUSDTest is Test {
    HUSD internal husd;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_760_000_000);
        husd = new HUSD();
    }

    function test_Metadata() public view {
        assertEq(husd.name(), "Humanline USD", "name");
        assertEq(husd.symbol(), "hUSD", "symbol");
        assertEq(husd.decimals(), 6, "six decimals, so amounts read like dollars");
        assertEq(husd.totalSupply(), 0, "no premine");
    }

    function test_FaucetMintsOneHundred() public {
        vm.expectEmit(true, true, true, true, address(husd));
        emit HUSD.Faucet(alice, 100e6);
        vm.prank(alice);
        husd.faucet();

        assertEq(husd.balanceOf(alice), 100e6, "100 hUSD");
        assertEq(husd.totalSupply(), 100e6, "supply tracks the faucet");
        assertEq(husd.faucetAvailableAt(alice), uint64(block.timestamp) + 24 hours, "cooldown starts");
    }

    function test_FaucetIsRateLimitedPerAddress() public {
        vm.prank(alice);
        husd.faucet();
        uint64 until = uint64(block.timestamp) + 24 hours;

        vm.warp(uint256(until) - 1);
        vm.expectRevert(abi.encodeWithSelector(HUSD.FaucetCooldown.selector, until));
        vm.prank(alice);
        husd.faucet();

        // A different address is unaffected.
        vm.prank(bob);
        husd.faucet();
        assertEq(husd.balanceOf(bob), 100e6, "bob is not blocked by alice");

        vm.warp(until);
        vm.prank(alice);
        husd.faucet();
        assertEq(husd.balanceOf(alice), 200e6, "second helping after 24h");
    }

    function test_FaucetAvailableAtIsZeroForANewAddress() public view {
        assertEq(husd.faucetAvailableAt(alice), 0, "never used");
    }

    function test_TokensTransferNormally() public {
        vm.startPrank(alice);
        husd.faucet();
        husd.transfer(bob, 40e6);
        vm.stopPrank();
        assertEq(husd.balanceOf(alice), 60e6, "sender");
        assertEq(husd.balanceOf(bob), 40e6, "recipient");
    }
}
