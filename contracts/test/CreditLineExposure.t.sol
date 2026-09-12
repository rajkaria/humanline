// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "./mocks/MockWorldID.sol";
import {CreditLineHarness} from "./harness/CreditLineHarness.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {HUSD} from "../src/HUSD.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {ICreditLine} from "../src/interfaces/ICreditLine.sol";

/// @notice The attestor-bond exposure cap: total outstanding principal never exceeds
///         `attestors × minBond × EXPOSURE_PER_BONDED_CTC`, read live on every draw, and the pool is
///         only ever wired to the source chain ChainInfo says it is.
contract CreditLineExposureTest is Test {
    uint256 internal constant EXPOSURE = 10e6; // 10 hUSD per bonded CTC
    uint256 internal constant ROOT = uint256(keccak256("root"));

    HUSD internal husd;
    MockWorldID internal worldId;
    HumanRegistry internal registry;
    CreditLineHarness internal pool;

    address internal lender = makeAddr("lender");
    uint256[8] internal proof;

    function setUp() public {
        vm.warp(1_760_000_000);
        husd = new HUSD();
        worldId = new MockWorldID();
        registry = new HumanRegistry(address(worldId), "app_x", "act");
        pool = new CreditLineHarness(
            address(husd), address(registry), 1_000e6, 5_000e6, 100, 30 days, 7 days, 1, 11_155_111, EXPOSURE
        );
        deal(address(husd), lender, 1_000_000e6);
        vm.startPrank(lender);
        husd.approve(address(pool), type(uint256).max);
        pool.deposit(100_000e6);
        vm.stopPrank();
    }

    function _human(uint256 seed) internal returns (address wallet) {
        wallet = makeAddr(string(abi.encode("borrower", seed)));
        uint256 nullifier = uint256(keccak256(abi.encode("nullifier", seed)));
        vm.prank(wallet);
        registry.register(ROOT, nullifier, proof);
        vm.prank(wallet);
        pool.openLine();
        deal(address(husd), wallet, 10_000e6);
        vm.prank(wallet);
        husd.approve(address(pool), type(uint256).max);
    }

    // -----------------------------------------------------------------------------------

    function test_TheCapIsAttestorsTimesBondTimesExposure() public {
        pool.setBond(7, 100e18);
        (uint32 attestors, uint128 minBond, uint256 cap) = pool.securityBudget();
        assertEq(attestors, 7);
        assertEq(minBond, 100e18);
        assertEq(cap, 7_000e6, "7 x 100 CTC x 10 hUSD/CTC");
        assertEq(pool.exposureCap(), cap);
    }

    function test_ADrawThatWouldCrossTheCapReverts() public {
        pool.setBond(2, 100e18); // cap 2,000 hUSD; each line's own limit is 1,000 hUSD
        address a = _human(1);
        address b = _human(2);
        address c = _human(20);
        vm.prank(a);
        pool.borrow(900e6);
        vm.prank(b);
        pool.borrow(990e6);
        // c is well inside their own limit, but the pool as a whole would pass the bonded budget.
        vm.prank(c);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.ExposureCapExceeded.selector, 2_001e6, 2_000e6));
        pool.borrow(111e6);
        vm.prank(c);
        pool.borrow(110e6);
        assertEq(pool.totalBorrowed(), 2_000e6, "filled exactly to the cap");
    }

    function test_ExactlyAtTheCapIsAllowed() public {
        pool.setBond(1, 99e18); // cap 990 hUSD
        address a = _human(3);
        vm.prank(a);
        pool.borrow(990e6);
        assertEq(pool.totalBorrowed(), pool.exposureCap());
    }

    function test_AThinningAttestorSetLowersTheCeilingLive() public {
        pool.setBond(5, 100e18);
        address a = _human(4);
        vm.prank(a);
        pool.borrow(900e6);
        pool.setBond(1, 50e18); // cap 500 hUSD, already exceeded by 900
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.ExposureCapExceeded.selector, 901e6, 500e6));
        pool.borrow(1e6);
    }

    function test_ZeroAttestorsStopsNewDrawsButNeverRepayments() public {
        pool.setBond(3, 100e18);
        address a = _human(5);
        vm.prank(a);
        pool.borrow(500e6);
        pool.setBond(0, 100e18);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.ExposureCapExceeded.selector, 501e6, 0));
        pool.borrow(1e6);
        vm.prank(a);
        pool.repay(505e6);
        assertEq(pool.totalBorrowed(), 0, "repaid in full despite the cap");
    }

    function test_WithdrawalsAndDefaultsIgnoreTheCap() public {
        pool.setBond(3, 100e18);
        address a = _human(6);
        vm.prank(a);
        pool.borrow(500e6);
        pool.setBond(0, 0);
        vm.warp(block.timestamp + 38 days);
        pool.markDefault(registry.humanOf(a));
        vm.prank(lender);
        pool.withdraw(1_000e6);
    }

    function test_TheConstructorRefusesAChainKeyThatIsNotTheClaimedChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.WrongSecurityChain.selector, uint64(3), uint64(1), uint64(11_155_111))
        );
        new CreditLineHarness(address(husd), address(registry), 1, 2, 100, 1, 1, 3, 11_155_111, EXPOSURE);

        vm.expectRevert(abi.encodeWithSelector(ICreditLine.WrongSecurityChain.selector, uint64(8), uint64(0), uint64(56)));
        new CreditLineHarness(address(husd), address(registry), 1, 2, 100, 1, 1, 8, 56, EXPOSURE);
    }

    function test_TheConstructorRefusesAZeroExposureRate() public {
        vm.expectRevert(ICreditLine.ZeroAmount.selector);
        new CreditLineHarness(address(husd), address(registry), 1, 2, 100, 1, 1, 1, 11_155_111, 0);
    }

    function test_ConfigurationIsPublic() public view {
        assertEq(pool.SECURITY_CHAIN_KEY(), 1);
        assertEq(pool.SOURCE_CHAIN_ID(), 11_155_111);
        assertEq(pool.EXPOSURE_PER_BONDED_CTC(), EXPOSURE);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_OutstandingNeverExceedsTheCapAfterADraw(uint32 attestors, uint96 bond, uint64 amount) public {
        pool.setBond(uint32(bound(attestors, 0, 50)), uint128(bound(bond, 0, 1_000e18)));
        address a = _human(7);
        uint256 draw = bound(amount, 1, 990e6);
        vm.prank(a);
        try pool.borrow(draw) {
            assertLe(pool.totalBorrowed(), pool.exposureCap(), "a successful draw respects the cap");
        } catch (bytes memory reason) {
            // Either the cap or another guard; if it was the cap, the draw really would cross it.
            if (bytes4(reason) == ICreditLine.ExposureCapExceeded.selector) {
                assertGt(draw, pool.exposureCap());
            }
        }
    }

    function _unused() internal pure returns (CreditLine) {
        return CreditLine(address(0));
    }
}
