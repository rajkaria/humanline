// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {Fixtures} from "./Fixtures.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {MockWorldID} from "./mocks/MockWorldID.sol";
import {TxBytes} from "./harness/TxBytes.sol";
import {EthRepayHarness, MockLinks, MockHistory, CreditHistoryHarness} from "./harness/CrossChainHarness.sol";
import {BoostedCreditLineHarness} from "./harness/CreditLineHarness.sol";

import {HUSD} from "../src/HUSD.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {EthRepay} from "../src/EthRepay.sol";
import {ProvenSource} from "../src/ProvenSource.sol";
import {ICreditLine} from "../src/interfaces/ICreditLine.sol";
import {ICreditHistory} from "../src/interfaces/ICreditHistory.sol";
import {SourceProof} from "../src/interfaces/ISourceProof.sol";

/// @dev A credit line that re-enters `EthRepay` while being repaid.
contract ReentrantLine {
    address public immutable ASSET;
    address public target;
    bytes public callData;
    bytes public reentryError;

    constructor(address asset) {
        ASSET = asset;
    }

    function arm(address target_, bytes memory callData_) external {
        target = target_;
        callData = callData_;
    }

    function lineOf(uint256) external pure returns (ICreditLine.Line memory line) {
        line.principal = 10e6;
    }

    function repayFor(uint256, uint256) external {
        (bool ok, bytes memory ret) = target.call(callData);
        require(!ok, "reentry must fail");
        reentryError = ret;
    }
}

/// @notice Cross-chain settlement on CreditLine v3: `EthRepay` against a real Circle USDC transfer on
///         Sepolia (0.01 USDC from 0x6dBe…A5d2 to 0x139b…764b, used here as the repayment address),
///         plus the v3 limit boost and `repayFor`.
contract EthRepayTest is Fixtures {
    using TxBytes for bytes;

    address internal constant PAYER = 0x6dBe810e3314546009bD6e1B29f9031211CdA5d2;
    address internal constant REPAY_ADDRESS = 0x139BF28F2b65Ab6DdF005dc248E1D63b1ea3764B;
    uint256 internal constant ALICE_HUMAN = uint256(keccak256("alice-nullifier"));

    HUSD internal husd;
    HumanRegistry internal registry;
    BoostedCreditLineHarness internal pool;
    MockLinks internal links;
    MockHistory internal history;
    EthRepayHarness internal repay;
    ProofFixture internal f;

    address internal alice = makeAddr("alice");
    address internal lender = makeAddr("lender");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        husd = new HUSD();
        registry = new HumanRegistry(address(new MockWorldID()), "app_87b24915fcf733f10df1b0c46dd1f783", "humanline-register");
        history = new MockHistory();
        pool = new BoostedCreditLineHarness(address(husd), address(registry), 25e6, 2_000e6, address(history));
        links = new MockLinks();
        links.setHuman(PAYER, ALICE_HUMAN);
        repay = new EthRepayHarness(address(links), address(pool), REPAY_ADDRESS, _stablecoins(6));
        f = loadFixture(USDC_TRANSFER_FIXTURE);

        uint256[8] memory proof;
        vm.prank(alice);
        registry.register(1, ALICE_HUMAN, proof);

        deal(address(husd), lender, 10_000e6);
        vm.startPrank(lender);
        husd.approve(address(pool), type(uint256).max);
        pool.deposit(5_000e6);
        vm.stopPrank();

        vm.startPrank(alice);
        pool.openLine();
        pool.borrow(10e6); // owes 10.1 hUSD
        vm.stopPrank();

        deal(address(husd), address(repay), 1_000e6);
    }

    // ------------------------------------------------------------------ EthRepay

    function test_TheRealUsdcTransferRepaysTheLine() public {
        bytes32 paymentId = repay.logIdOf(queryIdOf(1, f.headerNumber, f.txIndex), 0);

        vm.expectEmit(true, true, true, true, address(repay));
        emit EthRepay.RepaymentCredited(ALICE_HUMAN, PAYER, paymentId, 1, f.headerNumber, 10_000, 10_000, 0);
        uint256 applied = repay.creditRepayment(sourceProofOf(f), 0);

        assertEq(applied, 10_000, "0.01 USDC applied as 0.01 hUSD");
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 10.1e6 - 10_000);
        assertEq(repay.totalApplied(), 10_000);
        assertEq(repay.reserve(), 1_000e6 - 10_000);
        assertTrue(repay.consumed(paymentId));

        vm.expectRevert(abi.encodeWithSelector(ProvenSource.AlreadyConsumed.selector, paymentId));
        repay.creditRepayment(sourceProofOf(f), 0);
    }

    function test_AnOverpaymentSettlesTheLineAndRecordsTheRest() public {
        uint256 limitBefore = pool.lineOf(ALICE_HUMAN).limit;
        uint256 applied = repay.creditRepayment(sourceProofOf(f, _withValue(50e6)), 0);

        assertEq(applied, 10.1e6);
        assertEq(repay.overpaidOf(ALICE_HUMAN), 50e6 - 10.1e6);
        ICreditLine.Line memory line = pool.lineOf(ALICE_HUMAN);
        assertEq(line.principal, 0);
        assertEq(line.loansRepaid, 1, "an on-time repayment from Ethereum counts like any other");
        assertEq(line.limit, (limitBefore * 125) / 100);
    }

    function test_NothingOwedMeansAllOverpaid() public {
        vm.startPrank(alice);
        husd.approve(address(pool), type(uint256).max);
        deal(address(husd), alice, 100e6);
        pool.repay(10.1e6);
        vm.stopPrank();

        assertEq(repay.creditRepayment(sourceProofOf(f), 0), 0);
        assertEq(repay.overpaidOf(ALICE_HUMAN), 10_000);
        assertEq(repay.reserve(), 1_000e6, "no float spent");
    }

    function test_AnEmptyFloatMakesAValidProofWaitNotDisappear() public {
        deal(address(husd), address(repay), 0);
        vm.expectRevert(abi.encodeWithSelector(EthRepay.ReserveShort.selector, 10_000, 0));
        repay.creditRepayment(sourceProofOf(f), 0);

        deal(address(husd), address(repay), 1e6);
        assertEq(repay.creditRepayment(sourceProofOf(f), 0), 10_000, "the same proof works once refilled");
    }

    function test_OnlyTransfersToTheRepaymentAddress() public {
        EthRepayHarness elsewhere = new EthRepayHarness(address(links), address(pool), treasury, _stablecoins(6));
        vm.expectRevert(abi.encodeWithSelector(EthRepay.NotToRepayAddress.selector, REPAY_ADDRESS));
        elsewhere.creditRepayment(sourceProofOf(f), 0);
    }

    function test_OnlyTheConfiguredStablecoin() public {
        EvmV1Decoder.LogEntryTuple memory log = f.txBytes.logAt(0);
        address fake = makeAddr("fake USDC");
        log.address_ = fake;
        vm.expectRevert(abi.encodeWithSelector(EthRepay.NotAStablecoinTransfer.selector, 1, fake));
        repay.creditRepayment(sourceProofOf(f, f.txBytes.withLogAt(0, log)), 0);

        log = f.txBytes.logAt(0);
        log.topics[0] = keccak256("Approval(address,address,uint256)");
        vm.expectRevert(abi.encodeWithSelector(EthRepay.NotAStablecoinTransfer.selector, 1, SEPOLIA_USDC));
        repay.creditRepayment(sourceProofOf(f, f.txBytes.withLogAt(0, log)), 0);
    }

    function test_OnlyLinkedPayers() public {
        links.setHuman(PAYER, 0);
        vm.expectRevert(abi.encodeWithSelector(EthRepay.WalletNotLinked.selector, PAYER));
        repay.creditRepayment(sourceProofOf(f), 0);
    }

    function test_EighteenDecimalStablecoinsAreRescaled() public {
        EthRepayHarness dai = new EthRepayHarness(address(links), address(pool), REPAY_ADDRESS, _stablecoins(18));
        deal(address(husd), address(dai), 100e6);
        assertEq(dai.creditRepayment(sourceProofOf(f, _withValue(3e18)), 0), 3e6);

        SourceProof memory dust = sourceProofOf(f, _withValue(1e11));
        dust.merkleProof = syntheticMerkleProof(7, 8);
        vm.expectRevert(EthRepay.ZeroTransfer.selector);
        dai.creditRepayment(dust, 0);
    }

    function test_ConstructorRefusesZeroAddresses() public {
        vm.expectRevert(EthRepay.BadParameters.selector);
        new EthRepayHarness(address(links), address(pool), address(0), _stablecoins(6));
        vm.expectRevert(EthRepay.BadParameters.selector);
        new EthRepayHarness(address(0), address(pool), REPAY_ADDRESS, _stablecoins(6));
        vm.expectRevert(EthRepay.BadParameters.selector);
        new EthRepayHarness(address(links), address(0), REPAY_ADDRESS, _stablecoins(6));
    }

    function test_ConstructorRefusesABadStablecoin() public {
        EthRepay.Stablecoin[] memory s = _stablecoins(6);
        s[0].token = address(0);
        vm.expectRevert(EthRepay.BadParameters.selector);
        new EthRepayHarness(address(links), address(pool), REPAY_ADDRESS, s);

        vm.expectRevert(EthRepay.BadParameters.selector);
        new EthRepayHarness(address(links), address(pool), REPAY_ADDRESS, _stablecoins(37));

        EthRepayHarness widest = new EthRepayHarness(address(links), address(pool), REPAY_ADDRESS, _stablecoins(36));
        assertEq(widest.stablecoinDecimalsOf(1), 36, "36 decimals is the largest accepted");
    }

    function test_AFloatExactlyEqualToTheRepaymentIsEnough() public {
        deal(address(husd), address(repay), 10_000); // the proved transfer is 0.01 USDC
        assertEq(repay.creditRepayment(sourceProofOf(f), 0), 10_000);
        assertEq(repay.reserve(), 0, "the float is used to the last unit");
    }

    /// @dev Only the exact error proves the lock stopped it: without `nonReentrant` the inner call
    ///      would still fail, on `AlreadyConsumed`.
    function test_ReentryThroughTheCreditLineFailsOnTheLockItself() public {
        ReentrantLine line = new ReentrantLine(address(husd));
        EthRepayHarness guarded = new EthRepayHarness(address(links), address(line), REPAY_ADDRESS, _stablecoins(6));
        deal(address(husd), address(guarded), 1_000e6);
        SourceProof memory p = sourceProofOf(f);
        line.arm(address(guarded), abi.encodeCall(EthRepay.creditRepayment, (p, 0)));

        assertEq(guarded.creditRepayment(p, 0), 10_000);
        assertEq(bytes4(line.reentryError()), EthRepay.Reentrancy.selector, "stopped by the lock");
    }

    // ------------------------------------------------------------------ CreditLine v3

    function test_AnyoneCanRepayForAHuman() public {
        address friend = makeAddr("friend");
        deal(address(husd), friend, 20e6);
        vm.startPrank(friend);
        husd.approve(address(pool), type(uint256).max);
        vm.expectEmit(true, true, false, true, address(pool));
        emit ICreditLine.Repaid(ALICE_HUMAN, friend, 4e6, 6.1e6);
        pool.repayFor(ALICE_HUMAN, 4e6);
        vm.stopPrank();
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 6.1e6);

        vm.expectRevert(abi.encodeWithSelector(ICreditLine.NoLine.selector, 42));
        vm.prank(friend);
        pool.repayFor(42, 1e6);
    }

    function test_HistoryBoostRaisesTheLimitUpToMax() public {
        assertEq(pool.limitOf(ALICE_HUMAN), 25e6);
        history.setBoost(ALICE_HUMAN, 21e6);
        assertEq(pool.boostOf(ALICE_HUMAN), 21e6);
        assertEq(pool.limitOf(ALICE_HUMAN), 46e6);
        assertEq(pool.availableCredit(ALICE_HUMAN), 46e6 - 10.1e6);

        // Borrow into the boost.
        vm.prank(alice);
        pool.borrow(30e6);
        assertEq(pool.lineOf(ALICE_HUMAN).principal, 10.1e6 + 30.3e6);

        vm.expectRevert();
        vm.prank(alice);
        pool.borrow(10e6);

        history.setBoost(ALICE_HUMAN, 1e30);
        assertEq(pool.limitOf(ALICE_HUMAN), 2_000e6, "never above MAX_LIMIT");
        assertEq(pool.limitOf(424_242), 0, "no line, no limit");
    }

    function test_RealAaveHistoryRaisesARealLimit() public {
        // Full wiring: CreditHistory (real Aave fixtures) → CreditLine v3.
        MockLinks aaveLinks = new MockLinks();
        aaveLinks.setHuman(0x2D39338894D7D3Be4908d6fbfc3500440C788F01, ALICE_HUMAN);
        ICreditHistory.AavePool[] memory pools = new ICreditHistory.AavePool[](1);
        pools[0] = ICreditHistory.AavePool({chainKey: 1, chainId: 11_155_111, pool: SEPOLIA_AAVE_POOL});
        ICreditHistory.Reserve[] memory reserves = new ICreditHistory.Reserve[](1);
        reserves[0] = ICreditHistory.Reserve({chainKey: 1, token: SEPOLIA_AAVE_USDC, decimals: 6});
        CreditHistoryHarness real = new CreditHistoryHarness(address(aaveLinks), pools, reserves, 7_200, 2_500, 500e6);
        BoostedCreditLineHarness v3 = new BoostedCreditLineHarness(address(husd), address(registry), 25e6, 2_000e6, address(real));

        vm.prank(alice);
        v3.openLine();
        assertEq(v3.limitOf(ALICE_HUMAN), 25e6);

        bytes32 borrowId = real.proveBorrow(sourceProofOf(loadFixture(AAVE_BORROW_FIXTURE)), 4);
        real.proveRepay(sourceProofOf(loadFixture(AAVE_REPAY_FIXTURE)), 6, borrowId);

        assertEq(v3.limitOf(ALICE_HUMAN), 25e6 + 21_307_873, "25 hUSD + 25% of 85.231495 proved repaid");
    }

    function testFuzz_ApplicationNeverExceedsWhatIsOwedOrWhatWasSent(uint256 value) public {
        value = bound(value, 1, 1e24);
        uint256 owed = pool.lineOf(ALICE_HUMAN).principal;
        deal(address(husd), address(repay), 1e30);
        uint256 applied = repay.creditRepayment(sourceProofOf(f, _withValue(value)), 0);
        assertEq(applied, value < owed ? value : owed);
        assertEq(repay.overpaidOf(ALICE_HUMAN), value - applied);
        assertEq(pool.lineOf(ALICE_HUMAN).principal, owed - applied);
    }

    // ------------------------------------------------------------------ helpers

    function _stablecoins(uint8 decimals) internal pure returns (EthRepay.Stablecoin[] memory s) {
        s = new EthRepay.Stablecoin[](1);
        s[0] = EthRepay.Stablecoin({chainKey: 1, chainId: 11_155_111, token: SEPOLIA_USDC, decimals: decimals});
    }

    function _withValue(uint256 value) internal view returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple memory log = f.txBytes.logAt(0);
        log.data = abi.encode(value);
        return f.txBytes.withLogAt(0, log);
    }
}
