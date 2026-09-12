// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "./mocks/MockWorldID.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {HUSD} from "../src/HUSD.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {ICreditLine} from "../src/interfaces/ICreditLine.sol";

contract CreditLineTest is Test {
    string internal constant APP_ID = "app_87b24915fcf733f10df1b0c46dd1f783";
    string internal constant ACTION = "humanline-register";

    uint256 internal constant INITIAL_LIMIT = 25e6;
    uint256 internal constant MAX_LIMIT = 2000e6;
    uint256 internal constant FEE_BPS = 100;
    uint64 internal constant TERM = 30 days;
    uint64 internal constant GRACE = 7 days;

    HUSD internal husd;
    MockWorldID internal worldId;
    HumanRegistry internal registry;
    CreditLine internal pool;
    /// @dev A second pool with a 1,000 hUSD starting limit, so the share-math tests can move
    ///      amounts large enough for rounding to be interesting without fighting the credit limit.
    CreditLine internal bigPool;

    address internal lender = address(0x1E4DE2);
    address internal lender2 = address(0x1E4DE3);
    address internal alice = address(0xA11CE);
    address internal aliceNewWallet = address(0xA11CE2);
    address internal stranger = address(0x57A);

    uint256 internal constant ALICE_HUMAN = uint256(keccak256("alice-nullifier"));
    uint256 internal constant ROOT = uint256(keccak256("root"));
    uint256[8] internal proof;

    function setUp() public {
        vm.warp(1_760_000_000);
        husd = new HUSD();
        worldId = new MockWorldID();
        registry = new HumanRegistry(address(worldId), APP_ID, ACTION);
        pool = new CreditLine(
            address(husd), address(registry), INITIAL_LIMIT, MAX_LIMIT, FEE_BPS, TERM, GRACE
        );
        bigPool = new CreditLine(
            address(husd), address(registry), 1_000e6, 5_000e6, FEE_BPS, TERM, GRACE
        );

        deal(address(husd), lender, 10_000e6);
        deal(address(husd), lender2, 10_000e6);
        deal(address(husd), alice, 1_000e6);
        deal(address(husd), aliceNewWallet, 1_000e6);

        vm.prank(lender);
        husd.approve(address(pool), type(uint256).max);
        vm.prank(lender2);
        husd.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        husd.approve(address(pool), type(uint256).max);
        vm.prank(aliceNewWallet);
        husd.approve(address(pool), type(uint256).max);

        vm.prank(lender);
        husd.approve(address(bigPool), type(uint256).max);
        vm.prank(lender2);
        husd.approve(address(bigPool), type(uint256).max);
        vm.prank(alice);
        husd.approve(address(bigPool), type(uint256).max);

        _register(alice, ALICE_HUMAN);
    }

    // -----------------------------------------------------------------------------------
    //                                      LIFECYCLE
    // -----------------------------------------------------------------------------------

    function test_FullLifecycleRepaidOnTimeRaisesTheLimit() public {
        _deposit(lender, 1_000e6);

        vm.expectEmit(true, true, true, true, address(pool));
        emit ICreditLine.LineOpened(ALICE_HUMAN, alice, INITIAL_LIMIT);
        vm.prank(alice);
        pool.openLine();

        assertEq(pool.availableCredit(ALICE_HUMAN), INITIAL_LIMIT, "starting headroom");

        uint256 amount = 10e6;
        uint256 fee = 0.1e6;
        uint64 dueAt = uint64(block.timestamp) + TERM;

        vm.expectEmit(true, true, true, true, address(pool));
        emit ICreditLine.Borrowed(ALICE_HUMAN, alice, amount, fee, dueAt);
        vm.prank(alice);
        pool.borrow(amount);

        assertEq(husd.balanceOf(alice), 1_000e6 + amount, "cash received");
        assertEq(pool.lineOf(ALICE_HUMAN).principal, amount + fee, "principal includes the fee");
        assertEq(pool.lineOf(ALICE_HUMAN).dueAt, dueAt, "due date set");
        assertEq(pool.totalBorrowed(), amount + fee, "outstanding");
        assertEq(pool.totalAssets(), 1_000e6 + fee, "the fee accrues to lenders at draw time");

        vm.warp(uint256(dueAt) - 1);
        vm.expectEmit(true, true, true, true, address(pool));
        emit ICreditLine.LimitChanged(ALICE_HUMAN, INITIAL_LIMIT, (INITIAL_LIMIT * 125) / 100, true);
        vm.prank(alice);
        pool.repay(amount + fee);

        ICreditLine.Line memory line = pool.lineOf(ALICE_HUMAN);
        assertEq(line.principal, 0, "cleared");
        assertEq(line.limit, 31.25e6, "limit up 25%");
        assertEq(line.loansRepaid, 1, "one clean loan");
        assertEq(line.loansLate, 0, "no late loans");
        assertEq(pool.totalBorrowed(), 0, "nothing outstanding");
        assertEq(pool.totalAssets(), 1_000e6 + fee, "lenders keep the fee");
    }

    function test_LateRepaymentHalvesTheLimit() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 10e6);

        vm.warp(block.timestamp + TERM + 1);
        vm.expectEmit(true, true, true, true, address(pool));
        emit ICreditLine.LimitChanged(ALICE_HUMAN, INITIAL_LIMIT, INITIAL_LIMIT / 2, false);
        vm.prank(alice);
        pool.repay(10.1e6);

        ICreditLine.Line memory line = pool.lineOf(ALICE_HUMAN);
        assertEq(line.limit, 12.5e6, "limit halved");
        assertEq(line.loansLate, 1, "one late loan");
        assertFalse(line.frozen, "late is not a default");
    }

    function test_LateLimitNeverFallsBelowHalfTheStartingLimit() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 5e6);
        vm.warp(block.timestamp + TERM + 1);
        vm.prank(alice);
        pool.repay(5.05e6);
        assertEq(pool.lineOf(ALICE_HUMAN).limit, 12.5e6, "halved once");

        vm.prank(alice);
        pool.borrow(5e6);
        vm.warp(block.timestamp + TERM + 1);
        vm.prank(alice);
        pool.repay(5.05e6);
        assertEq(pool.lineOf(ALICE_HUMAN).limit, 12.5e6, "floored at INITIAL_LIMIT / 2");
    }

    function test_LimitIsCappedAtMaxLimit() public {
        CreditLine nearMax =
            new CreditLine(address(husd), address(registry), 1_800e6, MAX_LIMIT, FEE_BPS, TERM, GRACE);
        deal(address(husd), lender, 10_000e6);
        vm.startPrank(lender);
        husd.approve(address(nearMax), type(uint256).max);
        nearMax.deposit(5_000e6);
        vm.stopPrank();

        vm.startPrank(alice);
        husd.approve(address(nearMax), type(uint256).max);
        nearMax.openLine();
        nearMax.borrow(100e6);
        nearMax.repay(101e6);
        vm.stopPrank();

        assertEq(nearMax.lineOf(ALICE_HUMAN).limit, MAX_LIMIT, "1800 * 1.25 = 2250, capped at 2000");
    }

    // -----------------------------------------------------------------------------------
    //                                       DEFAULT
    // -----------------------------------------------------------------------------------

    function test_DefaultFreezesTheLineAndThePoolAbsorbsTheLoss() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 20e6);
        uint256 writtenOff = 20.2e6;

        vm.warp(block.timestamp + TERM + GRACE + 1);
        assertTrue(pool.isInDefault(ALICE_HUMAN), "in default");

        vm.expectEmit(true, true, true, true, address(pool));
        emit ICreditLine.Defaulted(ALICE_HUMAN, writtenOff, stranger);
        vm.prank(stranger);
        pool.markDefault(ALICE_HUMAN);

        ICreditLine.Line memory line = pool.lineOf(ALICE_HUMAN);
        assertTrue(line.frozen, "frozen");
        assertEq(line.principal, 0, "written off");
        assertEq(pool.totalBorrowed(), 0, "no outstanding debt");
        assertEq(pool.totalAssets(), 980e6, "lenders are down the 20 hUSD that left the pool");
        assertEq(pool.availableCredit(ALICE_HUMAN), 0, "no headroom once frozen");
        assertFalse(pool.isInDefault(ALICE_HUMAN), "already written off");

        vm.expectRevert(abi.encodeWithSelector(ICreditLine.LineFrozen.selector, ALICE_HUMAN));
        vm.prank(alice);
        pool.borrow(1e6);
    }

    function test_DefaultSurvivesAWalletRebind() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 20e6);
        vm.warp(block.timestamp + TERM + GRACE + 1);
        vm.prank(stranger);
        pool.markDefault(ALICE_HUMAN);

        _register(aliceNewWallet, ALICE_HUMAN);

        vm.expectRevert(abi.encodeWithSelector(ICreditLine.LineFrozen.selector, ALICE_HUMAN));
        vm.prank(aliceNewWallet);
        pool.borrow(1e6);
    }

    function test_MarkDefaultBeforeGraceEndsReverts() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 5e6);
        uint64 dueAt = pool.lineOf(ALICE_HUMAN).dueAt;

        vm.warp(uint256(dueAt) + GRACE);
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.NotInDefault.selector, ALICE_HUMAN, dueAt, GRACE)
        );
        pool.markDefault(ALICE_HUMAN);
    }

    function test_MarkDefaultOnACleanLineReverts() public {
        _deposit(lender, 1_000e6);
        vm.prank(alice);
        pool.openLine();
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NothingOwed.selector, ALICE_HUMAN));
        pool.markDefault(ALICE_HUMAN);
    }

    function test_MarkDefaultOnAnUnknownHumanReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NoLine.selector, uint256(42)));
        pool.markDefault(42);
    }

    // -----------------------------------------------------------------------------------
    //                                   IDENTITY BINDING
    // -----------------------------------------------------------------------------------

    function test_ARebindCarriesTheLine() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 10e6);

        _register(aliceNewWallet, ALICE_HUMAN);

        assertEq(pool.lineOfWallet(aliceNewWallet).principal, 10.1e6, "the same debt follows the human");
        vm.prank(aliceNewWallet);
        pool.repay(10.1e6);
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 0, "repaid from the new wallet");
        assertEq(pool.lineOf(ALICE_HUMAN).loansRepaid, 1, "credited to the same human");
    }

    function test_ASecondWalletCannotOpenASecondLine() public {
        vm.prank(alice);
        pool.openLine();
        _register(aliceNewWallet, ALICE_HUMAN);

        vm.expectRevert(abi.encodeWithSelector(ICreditLine.LineExists.selector, ALICE_HUMAN));
        vm.prank(aliceNewWallet);
        pool.openLine();
    }

    function test_OpeningTwiceFromTheSameWalletReverts() public {
        vm.startPrank(alice);
        pool.openLine();
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.LineExists.selector, ALICE_HUMAN));
        pool.openLine();
        vm.stopPrank();
    }

    function test_NonHumansCannotTouchTheLine() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NotHuman.selector, stranger));
        pool.openLine();
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NotHuman.selector, stranger));
        pool.borrow(1e6);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NotHuman.selector, stranger));
        pool.repay(1e6);
        vm.stopPrank();
    }

    function test_BorrowingWithoutALineReverts() public {
        _deposit(lender, 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NoLine.selector, ALICE_HUMAN));
        vm.prank(alice);
        pool.borrow(1e6);
    }

    // -----------------------------------------------------------------------------------
    //                                      LIMITS
    // -----------------------------------------------------------------------------------

    function test_BorrowingPastTheLimitReverts() public {
        _deposit(lender, 1_000e6);
        vm.prank(alice);
        pool.openLine();

        // 25 hUSD plus the 1% fee is 25.25, which does not fit a 25 hUSD limit.
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.OverLimit.selector, uint256(25.25e6), INITIAL_LIMIT)
        );
        vm.prank(alice);
        pool.borrow(25e6);
    }

    function test_TheFeeCountsAgainstTheLimitAcrossDraws() public {
        _deposit(lender, 1_000e6);
        vm.startPrank(alice);
        pool.openLine();
        pool.borrow(20e6); // owes 20.2
        assertEq(pool.availableCredit(ALICE_HUMAN), 4.8e6, "headroom net of the fee");
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.OverLimit.selector, uint256(5.05e6), uint256(4.8e6))
        );
        pool.borrow(5e6);
        vm.stopPrank();
    }

    function test_BorrowingMoreThanTheIdleBalanceReverts() public {
        _deposit(lender, 5e6);
        vm.startPrank(alice);
        pool.openLine();
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.InsufficientLiquidity.selector, uint256(10e6), uint256(5e6))
        );
        pool.borrow(10e6);
        vm.stopPrank();
    }

    function test_FeeMath() public {
        _deposit(lender, 1_000e6);
        vm.startPrank(alice);
        pool.openLine();
        pool.borrow(1_000); // 0.001 hUSD
        vm.stopPrank();
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 1_010, "1% of 1000 is 10");

        vm.prank(alice);
        pool.repay(500);
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 510, "partial repayment leaves the rest");
    }

    function test_OverpaymentIsCappedAtTheBalance() public {
        _deposit(lender, 1_000e6);
        _openAndBorrow(alice, 10e6);
        uint256 before = husd.balanceOf(alice);

        vm.prank(alice);
        pool.repay(50e6);

        assertEq(pool.lineOf(ALICE_HUMAN).principal, 0, "cleared");
        assertEq(husd.balanceOf(alice), before - 10.1e6, "only the balance was taken");
    }

    function test_ZeroAmountsRevert() public {
        vm.startPrank(alice);
        vm.expectRevert(ICreditLine.ZeroAmount.selector);
        pool.deposit(0);
        vm.expectRevert(ICreditLine.ZeroAmount.selector);
        pool.withdraw(0);
        pool.openLine();
        vm.expectRevert(ICreditLine.ZeroAmount.selector);
        pool.borrow(0);
        vm.expectRevert(ICreditLine.ZeroAmount.selector);
        pool.repay(0);
        vm.stopPrank();
    }

    function test_RepayingNothingReverts() public {
        vm.startPrank(alice);
        pool.openLine();
        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NothingOwed.selector, ALICE_HUMAN));
        pool.repay(1e6);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------------------
    //                                    SHARE MATH
    // -----------------------------------------------------------------------------------

    function test_FirstDepositMintsOneForOne() public {
        uint256 shares = _deposit(lender, 1_000e6);
        assertEq(shares, 1_000e6, "1:1");
        assertEq(pool.totalShares(), 1_000e6, "supply");
        assertEq(pool.sharesOf(lender), 1_000e6, "balance");
        assertEq(pool.totalAssets(), 1_000e6, "assets");
    }

    function test_ALaterDepositPaysForAccruedFees() public {
        _depositIn(bigPool, lender, 1_000e6);
        _openAndBorrowIn(bigPool, alice, 100e6); // books a 1 hUSD fee, so the pool is worth 1,001

        uint256 shares = _depositIn(bigPool, lender2, 1_001e6);
        assertEq(shares, 1_000e6, "1,001 assets buys 1,000 shares once the pool is worth 1.001x");
        assertLt(shares, 1_001e6, "the late lender pays for fees they did not earn");
        assertEq(bigPool.sharesOf(lender), 1_000e6, "the early lender paid 1,000 for the same stake");
    }

    function test_TwoLendersShareAWriteOffProRata() public {
        _depositIn(bigPool, lender, 1_000e6);
        _openAndBorrowIn(bigPool, alice, 100e6); // out: 100, owed: 101, pool worth 1,001

        uint256 lender2Shares = _depositIn(bigPool, lender2, 500e6);
        uint256 lenderShares = bigPool.sharesOf(lender);

        vm.warp(block.timestamp + TERM + GRACE + 1);
        vm.prank(stranger);
        bigPool.markDefault(ALICE_HUMAN);

        uint256 assetsAfterLoss = bigPool.totalAssets();
        assertEq(assetsAfterLoss, 1_400e6, "900 idle + 500 idle; the 100 that left the pool is gone");

        uint256 lenderOut = _withdrawFrom(bigPool, lender, lenderShares);
        uint256 lender2Out = _withdrawFrom(bigPool, lender2, lender2Shares);

        // Both lenders take the same haircut per share, to the last unit of rounding.
        assertApproxEqAbs(
            (lenderOut * 1e18) / lenderShares,
            (lender2Out * 1e18) / lender2Shares,
            1e10,
            "equal value per share"
        );
        assertLt(lenderOut, 1_000e6, "the early lender took a loss");
        assertLt(lender2Out, 500e6, "so did the late lender");
        assertEq(lenderOut + lender2Out, assetsAfterLoss, "the pool is emptied exactly");
        assertEq(bigPool.totalShares(), 0, "all shares burned");
    }

    function test_WithdrawIsLimitedToIdleLiquidity() public {
        uint256 shares = _depositIn(bigPool, lender, 1_000e6);
        _openAndBorrowIn(bigPool, alice, 500e6); // 500 out, 505 owed, pool worth 1,005

        vm.expectRevert(
            abi.encodeWithSelector(
                ICreditLine.InsufficientLiquidity.selector, uint256(1_005e6), uint256(500e6)
            )
        );
        vm.prank(lender);
        bigPool.withdraw(shares);

        // A smaller slice still fits inside the idle balance.
        uint256 out = _withdrawFrom(bigPool, lender, 400e6);
        assertEq(out, 402e6, "40% of a pool worth 1,005");
        assertEq(bigPool.sharesOf(lender), 600e6, "the rest stays invested");
    }

    function test_WithdrawingMoreSharesThanHeldReverts() public {
        uint256 shares = _deposit(lender, 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(ICreditLine.InsufficientShares.selector, shares, shares + 1)
        );
        vm.prank(lender);
        pool.withdraw(shares + 1);
    }

    function test_ConfigurationIsImmutableAndPublic() public view {
        assertEq(pool.ASSET(), address(husd), "asset");
        assertEq(pool.REGISTRY(), address(registry), "registry");
        assertEq(pool.INITIAL_LIMIT(), INITIAL_LIMIT, "initial limit");
        assertEq(pool.MAX_LIMIT(), MAX_LIMIT, "max limit");
        assertEq(pool.FEE_BPS(), FEE_BPS, "fee");
        assertEq(pool.TERM(), TERM, "term");
        assertEq(pool.GRACE(), GRACE, "grace");
    }

    // -----------------------------------------------------------------------------------
    //                                       HELPERS
    // -----------------------------------------------------------------------------------

    function _register(address wallet, uint256 human) internal {
        vm.prank(wallet);
        registry.register(ROOT, human, proof);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.prank(who);
        shares = pool.deposit(assets);
    }

    function _withdraw(address who, uint256 shares) internal returns (uint256 assets) {
        vm.prank(who);
        assets = pool.withdraw(shares);
    }

    function _openAndBorrow(address who, uint256 amount) internal {
        _openAndBorrowIn(pool, who, amount);
    }

    function _depositIn(CreditLine target, address who, uint256 assets) internal returns (uint256 shares) {
        vm.prank(who);
        shares = target.deposit(assets);
    }

    function _withdrawFrom(CreditLine target, address who, uint256 shares)
        internal
        returns (uint256 assets)
    {
        vm.prank(who);
        assets = target.withdraw(shares);
    }

    function _openAndBorrowIn(CreditLine target, address who, uint256 amount) internal {
        vm.startPrank(who);
        target.openLine();
        target.borrow(amount);
        vm.stopPrank();
    }
}
