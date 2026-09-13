// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {Fixtures} from "./Fixtures.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {TxBytes} from "./harness/TxBytes.sol";
import {CreditHistoryHarness, MockLinks} from "./harness/CrossChainHarness.sol";

import {CreditHistory} from "../src/CreditHistory.sol";
import {ProvenSource} from "../src/ProvenSource.sol";
import {ICreditHistory} from "../src/interfaces/ICreditHistory.sol";
import {SourceProof} from "../src/interfaces/ISourceProof.sol";

/// @notice `CreditHistory` against two real Aave V3 Sepolia transactions: wallet 0x2D39…8F01 borrowed
///         120 USDC at block 11,607,886 and repaid 85.231495 USDC at block 11,690,827. Negative cases
///         rewrite exactly one field of those real receipts.
contract CreditHistoryTest is Fixtures {
    using TxBytes for bytes;

    address internal constant BORROWER = 0x2D39338894D7D3Be4908d6fbfc3500440C788F01;
    uint256 internal constant BORROW_LOG = 4;
    uint256 internal constant REPAY_LOG = 6;
    uint256 internal constant HUMAN = uint256(keccak256("borrower-nullifier"));

    uint64 internal constant MIN_GAP = 7_200; // one day of Ethereum blocks
    uint256 internal constant BOOST_BPS = 2_500;
    uint256 internal constant MAX_BOOST = 500e6;

    CreditHistoryHarness internal history;
    MockLinks internal links;
    ProofFixture internal borrowF;
    ProofFixture internal repayF;

    function setUp() public {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        links = new MockLinks();
        links.setHuman(BORROWER, HUMAN);
        history = _deploy(MIN_GAP, MAX_BOOST);
        borrowF = loadFixture(AAVE_BORROW_FIXTURE);
        repayF = loadFixture(AAVE_REPAY_FIXTURE);
    }

    // ------------------------------------------------------------------ the real history

    function test_ProvesTheRealBorrow() public {
        bytes32 expectedId = history.logIdOf(queryIdOf(1, borrowF.headerNumber, borrowF.txIndex), BORROW_LOG);

        vm.expectEmit(true, true, true, true, address(history));
        emit ICreditHistory.BorrowProven(HUMAN, BORROWER, expectedId, 1, borrowF.headerNumber, SEPOLIA_AAVE_USDC, 120e6);
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);

        assertEq(borrowId, expectedId);
        ICreditHistory.BorrowRecord memory b = history.borrowOf(borrowId);
        assertEq(b.human, HUMAN);
        assertEq(b.wallet, BORROWER);
        assertEq(b.reserve, SEPOLIA_AAVE_USDC);
        assertEq(b.chainKey, 1);
        assertEq(b.blockHeight, 11_607_886);
        assertEq(b.amount, 120e6);
        assertEq(b.remaining, 120e6);
    }

    function test_ProvesTheRealRepaymentAndBoostsTheHuman() public {
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        uint256 credited = history.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId);

        assertEq(credited, 85_231_495, "85.231495 USDC at $1");
        assertEq(history.repaidUsdOf(HUMAN), 85_231_495);
        assertEq(history.repaymentsOf(HUMAN), 1);
        assertEq(history.borrowOf(borrowId).remaining, 120e6 - 85_231_495);
        assertEq(history.boostOf(HUMAN), (85_231_495 * BOOST_BPS) / 10_000, "a quarter of verified repaid dollars");
    }

    function test_EachLogCountsOnce() public {
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.AlreadyConsumed.selector, borrowId));
        history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);

        history.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId);
        bytes32 repayId = history.logIdOf(queryIdOf(1, repayF.headerNumber, repayF.txIndex), REPAY_LOG);
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.AlreadyConsumed.selector, repayId));
        history.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId);
    }

    // ------------------------------------------------------------------ anti-wash rules

    function test_ARepaymentNeedsAProvedBorrow() public {
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.UnknownBorrow.selector, bytes32(uint256(1))));
        history.proveRepay(sourceProofOf(repayF), REPAY_LOG, bytes32(uint256(1)));
    }

    function test_ARepaymentTooSoonAfterTheBorrowDoesNotCount() public {
        CreditHistoryHarness strict = _deploy(100_000, MAX_BOOST);
        bytes32 borrowId = strict.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        uint64 earliest = borrowF.headerNumber + 100_000;
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.TooSoon.selector, repayF.headerNumber, earliest));
        strict.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId);
    }

    function test_CreditIsCappedAtTheBorrowAndABorrowIsUsedUp() public {
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);

        // A repayment of 500 USDC against a 120 USDC borrow credits 120.
        bytes memory big = _withRepayAmount(repayF.txBytes, 500e6, false);
        assertEq(history.proveRepay(sourceProofOf(repayF, big), REPAY_LOG, borrowId), 120e6);

        // A second, distinct repayment transaction finds nothing left to back it.
        SourceProof memory second = sourceProofOf(repayF);
        second.merkleProof = syntheticMerkleProof(99, 8);
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.BorrowFullyRepaid.selector, borrowId));
        history.proveRepay(second, REPAY_LOG, borrowId);
    }

    function test_OwnDebtOwnMoney() public {
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);

        address someoneElse = makeAddr("benefactor");
        EvmV1Decoder.LogEntryTuple memory log = repayF.txBytes.logAt(REPAY_LOG);
        log.topics[3] = bytes32(uint256(uint160(someoneElse)));
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.RepaidBySomeoneElse.selector, BORROWER, someoneElse));
        history.proveRepay(sourceProofOf(repayF, repayF.txBytes.withLogAt(REPAY_LOG, log)), REPAY_LOG, borrowId);

        vm.expectRevert(ICreditHistory.RepaidWithATokens.selector);
        history.proveRepay(sourceProofOf(repayF, _withRepayAmount(repayF.txBytes, 1e6, true)), REPAY_LOG, borrowId);

        EvmV1Decoder.LogEntryTuple memory b = borrowF.txBytes.logAt(BORROW_LOG);
        (, uint256 amount, uint8 mode, uint256 rate) = abi.decode(b.data, (address, uint256, uint8, uint256));
        b.data = abi.encode(someoneElse, amount, mode, rate);
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.BorrowedForSomeoneElse.selector, someoneElse, BORROWER));
        history.proveBorrow(sourceProofOf(borrowF, borrowF.txBytes.withLogAt(BORROW_LOG, b)), BORROW_LOG);
    }

    function test_TheRepaymentMustMatchTheBorrowReserve() public {
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        EvmV1Decoder.LogEntryTuple memory log = repayF.txBytes.logAt(REPAY_LOG);
        log.topics[1] = bytes32(uint256(uint160(SEPOLIA_AAVE_DAI)));
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.BorrowMismatch.selector, borrowId));
        history.proveRepay(sourceProofOf(repayF, repayF.txBytes.withLogAt(REPAY_LOG, log)), REPAY_LOG, borrowId);
    }

    function test_UnlinkedWalletsDoNotCount() public {
        links.setHuman(BORROWER, 0);
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.WalletNotLinked.selector, BORROWER));
        history.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
    }

    // ------------------------------------------------------------------ emitter, reserve, log shape

    function test_OnlyTheAavePoolsLogsCount() public {
        // Log 3 of the borrow is USDC's own Transfer; log 2 is the pool's ReserveDataUpdated.
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.UnsupportedPool.selector, 1, SEPOLIA_AAVE_USDC));
        history.proveBorrow(sourceProofOf(borrowF), 3);

        vm.expectRevert(ICreditHistory.NotABorrowLog.selector);
        history.proveBorrow(sourceProofOf(borrowF), 2);

        vm.expectRevert(abi.encodeWithSelector(ProvenSource.LogIndexOutOfRange.selector, 5, 5));
        history.proveBorrow(sourceProofOf(borrowF), 5);

        vm.expectRevert(ICreditHistory.NotARepayLog.selector);
        history.proveRepay(sourceProofOf(borrowF), BORROW_LOG, bytes32(0));
    }

    function test_OnlyConfiguredReservesCount() public {
        address weth = 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c;
        EvmV1Decoder.LogEntryTuple memory log = borrowF.txBytes.logAt(BORROW_LOG);
        log.topics[1] = bytes32(uint256(uint160(weth)));
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.UnsupportedReserve.selector, 1, weth));
        history.proveBorrow(sourceProofOf(borrowF, borrowF.txBytes.withLogAt(BORROW_LOG, log)), BORROW_LOG);
    }

    function test_EighteenDecimalReservesAreScaledToDollars() public {
        EvmV1Decoder.LogEntryTuple memory b = borrowF.txBytes.logAt(BORROW_LOG);
        b.topics[1] = bytes32(uint256(uint160(SEPOLIA_AAVE_DAI)));
        (address user,, uint8 mode, uint256 rate) = abi.decode(b.data, (address, uint256, uint8, uint256));
        b.data = abi.encode(user, 250e18, mode, rate);
        bytes32 borrowId = history.proveBorrow(sourceProofOf(borrowF, borrowF.txBytes.withLogAt(BORROW_LOG, b)), BORROW_LOG);

        EvmV1Decoder.LogEntryTuple memory r = repayF.txBytes.logAt(REPAY_LOG);
        r.topics[1] = bytes32(uint256(uint160(SEPOLIA_AAVE_DAI)));
        r.data = abi.encode(uint256(200e18), false);
        uint256 credited = history.proveRepay(sourceProofOf(repayF, repayF.txBytes.withLogAt(REPAY_LOG, r)), REPAY_LOG, borrowId);
        assertEq(credited, 200e6, "200 DAI is 200 dollars in six decimals");
        assertEq(history.reserveDecimals(1, SEPOLIA_AAVE_DAI), 18);
    }

    function test_TheBoostIsCapped() public {
        CreditHistoryHarness capped = _deploy(MIN_GAP, 5e6);
        bytes32 borrowId = capped.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        capped.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId);
        assertEq(capped.boostOf(HUMAN), 5e6);
    }

    function test_OnlyConfiguredChainsAndSafeParameters() public {
        SourceProof memory p = sourceProofOf(borrowF);
        p.chainKey = 3;
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.UnsupportedSourceChain.selector, 3));
        history.proveBorrow(p, BORROW_LOG);

        ICreditHistory.AavePool[] memory pools = _pools();
        ICreditHistory.Reserve[] memory reserves = _reserves();
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), pools, reserves, 0, BOOST_BPS, MAX_BOOST);
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), pools, reserves, MIN_GAP, 10_001, MAX_BOOST);

        reserves[0].chainKey = 3; // no pool configured on chain key 3
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), pools, reserves, MIN_GAP, BOOST_BPS, MAX_BOOST);

        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(0), _pools(), _reserves(), MIN_GAP, BOOST_BPS, MAX_BOOST);

        ICreditHistory.AavePool[] memory noPool = _pools();
        noPool[0].pool = address(0);
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), noPool, _reserves(), MIN_GAP, BOOST_BPS, MAX_BOOST);

        // A zero pool is refused on its own, not only because a reserve on that chain then has no pool:
        // here the zero pool sits on Ethereum mainnet (chain key 3), where no reserve is configured.
        ICreditHistory.AavePool[] memory extraZero = new ICreditHistory.AavePool[](2);
        extraZero[0] = _pools()[0];
        extraZero[1] = ICreditHistory.AavePool({chainKey: 3, chainId: 1, pool: address(0)});
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), extraZero, _reserves(), MIN_GAP, BOOST_BPS, MAX_BOOST);

        assertEq(
            address(new CreditHistoryHarness(address(links), _pools(), _reserves(), MIN_GAP, 10_000, MAX_BOOST)) != address(0),
            true,
            "a 100% boost is the largest accepted"
        );

        ICreditHistory.Reserve[] memory widest = _reserves();
        widest[0].decimals = 36;
        CreditHistoryHarness wide = new CreditHistoryHarness(address(links), _pools(), widest, MIN_GAP, BOOST_BPS, MAX_BOOST);
        assertEq(wide.reserveDecimals(widest[0].chainKey, widest[0].token), 36, "36 decimals is the largest accepted");
        widest[0].decimals = 37;
        vm.expectRevert(ICreditHistory.BadParameters.selector);
        new CreditHistoryHarness(address(links), _pools(), widest, MIN_GAP, BOOST_BPS, MAX_BOOST);
    }

    /// @dev The gap rule is "at least MIN_GAP blocks later", so a repayment exactly at the gap counts.
    function test_ARepaymentExactlyAtTheMinimumGapCounts() public {
        uint64 gap = uint64(repayF.headerNumber - borrowF.headerNumber);
        CreditHistoryHarness exact = _deploy(gap, MAX_BOOST);
        bytes32 borrowId = exact.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        assertEq(exact.proveRepay(sourceProofOf(repayF), REPAY_LOG, borrowId), 85_231_495);

        CreditHistoryHarness oneMore = _deploy(gap + 1, MAX_BOOST);
        bytes32 id2 = oneMore.proveBorrow(sourceProofOf(borrowF), BORROW_LOG);
        vm.expectRevert();
        oneMore.proveRepay(sourceProofOf(repayF), REPAY_LOG, id2);
    }

    function test_ReserveDecimalsOnlyForReservesThatCount() public {
        assertEq(history.reserveDecimals(1, SEPOLIA_AAVE_USDC), 6);
        vm.expectRevert(abi.encodeWithSelector(ICreditHistory.UnsupportedReserve.selector, uint64(1), address(0xdead)));
        history.reserveDecimals(1, address(0xdead));
    }

    function testFuzz_CreditNeverExceedsTheBorrowAndBoostNeverExceedsTheCap(uint256 borrowAmt, uint256 repayAmt, uint256 cap)
        public
    {
        borrowAmt = bound(borrowAmt, 1, 1e30);
        repayAmt = bound(repayAmt, 1, 1e30);
        cap = bound(cap, 0, 1e30);
        CreditHistoryHarness h = _deploy(MIN_GAP, cap);

        EvmV1Decoder.LogEntryTuple memory b = borrowF.txBytes.logAt(BORROW_LOG);
        (address user,, uint8 mode, uint256 rate) = abi.decode(b.data, (address, uint256, uint8, uint256));
        b.data = abi.encode(user, borrowAmt, mode, rate);
        bytes32 borrowId = h.proveBorrow(sourceProofOf(borrowF, borrowF.txBytes.withLogAt(BORROW_LOG, b)), BORROW_LOG);

        uint256 credited = h.proveRepay(sourceProofOf(repayF, _withRepayAmount(repayF.txBytes, repayAmt, false)), REPAY_LOG, borrowId);

        assertLe(credited, borrowAmt);
        assertEq(credited, repayAmt < borrowAmt ? repayAmt : borrowAmt);
        assertLe(h.boostOf(HUMAN), cap);
        assertEq(h.borrowOf(borrowId).remaining, borrowAmt - credited);
    }

    // ------------------------------------------------------------------ helpers

    function _deploy(uint64 minGap, uint256 maxBoost) internal returns (CreditHistoryHarness) {
        return new CreditHistoryHarness(address(links), _pools(), _reserves(), minGap, BOOST_BPS, maxBoost);
    }

    function _pools() internal pure returns (ICreditHistory.AavePool[] memory pools) {
        pools = new ICreditHistory.AavePool[](1);
        pools[0] = ICreditHistory.AavePool({chainKey: 1, chainId: 11_155_111, pool: SEPOLIA_AAVE_POOL});
    }

    function _reserves() internal pure returns (ICreditHistory.Reserve[] memory reserves) {
        reserves = new ICreditHistory.Reserve[](3);
        reserves[0] = ICreditHistory.Reserve({chainKey: 1, token: SEPOLIA_AAVE_USDC, decimals: 6});
        reserves[1] = ICreditHistory.Reserve({chainKey: 1, token: SEPOLIA_AAVE_DAI, decimals: 18});
        reserves[2] = ICreditHistory.Reserve({chainKey: 1, token: SEPOLIA_AAVE_USDT, decimals: 6});
    }

    function _withRepayAmount(bytes memory txBytes, uint256 amount, bool useATokens) internal pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple memory log = TxBytes.logAt(txBytes, REPAY_LOG);
        log.data = abi.encode(amount, useATokens);
        return TxBytes.withLogAt(txBytes, REPAY_LOG, log);
    }
}
