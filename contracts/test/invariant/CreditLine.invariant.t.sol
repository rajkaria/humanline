// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockWorldID} from "../mocks/MockWorldID.sol";
import {CreditLineHarness} from "../harness/CreditLineHarness.sol";
import {HUSD} from "../../src/HUSD.sol";
import {HumanRegistry} from "../../src/HumanRegistry.sol";
import {ICreditLine} from "../../src/interfaces/ICreditLine.sol";

/// @notice Drives `CreditLine` with random lenders, borrowers, wallet moves, time and a moving
///         attestor security budget, and keeps an independent ledger of every token movement.
contract CreditLineHandler is Test {
    CreditLineHarness public pool;
    HUSD public husd;
    HumanRegistry public registry;

    address[3] public lenders;
    address[4] public wallets;
    uint256[4] public humans;
    uint256 private _walletNonce;

    // Independent ledger.
    uint256 public tokensIn;
    uint256 public tokensOut;

    // What happened (anti-vacuity) and what must never happen.
    uint256 public calls;
    uint256 public opens;
    uint256 public borrows;
    uint256 public repays;
    uint256 public defaults;
    uint256 public rebinds;
    uint256 public capBreaches;
    uint256 public secondLines;
    uint256 public frozenBorrows;
    mapping(uint256 human => bool) public frozenSeen;
    mapping(uint256 human => uint256) public linesOpened;

    constructor(CreditLineHarness pool_, HUSD husd_, HumanRegistry registry_) {
        pool = pool_;
        husd = husd_;
        registry = registry_;
        uint256[8] memory proof;
        for (uint256 i; i < 3; ++i) {
            lenders[i] = makeAddr(string.concat("lender", vm.toString(i)));
            deal(address(husd), lenders[i], 1e15);
            vm.prank(lenders[i]);
            husd.approve(address(pool), type(uint256).max);
        }
        for (uint256 i; i < 4; ++i) {
            humans[i] = uint256(keccak256(abi.encode("human", i)));
            wallets[i] = _freshWallet();
            vm.prank(wallets[i]);
            registry.register(1, humans[i], proof);
        }

        // A funded pool with every line open, so a random sequence spends its calls on the
        // interesting transitions (draws, repayments, defaults, moves) instead of on setup.
        vm.prank(lenders[0]);
        pool.deposit(20_000e6);
        tokensIn += 20_000e6;
        for (uint256 i; i < 4; ++i) {
            vm.prank(wallets[i]);
            pool.openLine();
            opens++;
            linesOpened[humans[i]] = 1;
        }
    }

    // ------------------------------------------------------------------ lenders

    function deposit(uint256 who, uint256 amount) external {
        calls++;
        address lender = lenders[who % 3];
        amount = bound(amount, 1, 5_000e6);
        vm.prank(lender);
        try pool.deposit(amount) {
            tokensIn += amount;
        } catch {}
    }

    function withdraw(uint256 who, uint256 shareSeed) external {
        calls++;
        address lender = lenders[who % 3];
        uint256 held = pool.sharesOf(lender);
        if (held == 0) return;
        vm.prank(lender);
        try pool.withdraw(bound(shareSeed, 1, held)) returns (uint256 assets) {
            tokensOut += assets;
        } catch {}
    }

    // ------------------------------------------------------------------ borrowers

    function openLine(uint256 who) external {
        calls++;
        uint256 i = who % 4;
        vm.prank(wallets[i]);
        try pool.openLine() {
            opens++;
            if (++linesOpened[humans[i]] > 1) secondLines++;
        } catch {}
    }

    /// @dev Two extra entry points so draws are sampled as often as everything else combined needs.
    function borrowSmall(uint256 who, uint256 amount) external {
        _borrow(who, bound(amount, 1, 50e6));
    }

    function borrowAgain(uint256 who, uint256 amount) external {
        _borrow(who + 1, bound(amount, 1, 20e6));
    }

    function borrow(uint256 who, uint256 amount) external {
        _borrow(who, bound(amount, 1, 3_000e6));
    }

    function _borrow(uint256 who, uint256 amount) internal {
        calls++;
        uint256 i = who % 4;
        bool wasFrozen = pool.lineOf(humans[i]).frozen;
        vm.prank(wallets[i]);
        try pool.borrow(amount) {
            borrows++;
            tokensOut += amount;
            if (pool.totalPrincipal() > pool.exposureCap()) capBreaches++;
            if (wasFrozen) frozenBorrows++;
        } catch {}
    }

    function repay(uint256 who, uint256 amount) external {
        calls++;
        uint256 i = who % 4;
        uint256 owed = pool.lineOf(humans[i]).principal;
        if (owed == 0) return;
        amount = bound(amount, 1, owed);
        deal(address(husd), wallets[i], husd.balanceOf(wallets[i]) + amount);
        vm.startPrank(wallets[i]);
        husd.approve(address(pool), amount);
        try pool.repay(amount) {
            repays++;
            tokensIn += amount;
        } catch {}
        vm.stopPrank();
    }

    function repayFor(uint256 who, uint256 payer, uint256 amount) external {
        calls++;
        uint256 i = who % 4;
        uint256 owed = pool.lineOf(humans[i]).principal;
        if (owed == 0) return;
        amount = bound(amount, 1, owed);
        vm.prank(lenders[payer % 3]);
        try pool.repayFor(humans[i], amount) {
            repays++;
            tokensIn += amount;
        } catch {}
    }

    function markDefault(uint256 who) external {
        calls++;
        uint256 human = humans[who % 4];
        try pool.markDefault(human) {
            defaults++;
            frozenSeen[human] = true;
        } catch {}
    }

    /// @dev The same human proves again from a brand-new wallet: the line must follow the person.
    function rebind(uint256 who) external {
        calls++;
        uint256 i = who % 4;
        address next = _freshWallet();
        uint256[8] memory proof;
        vm.prank(next);
        registry.register(1, humans[i], proof);
        wallets[i] = next;
        rebinds++;
    }

    // ------------------------------------------------------------------ environment

    function warp(uint256 seconds_) external {
        calls++;
        vm.warp(block.timestamp + bound(seconds_, 1, 45 days));
    }

    function setBond(uint256 count) external {
        calls++;
        // Never zero here: a zero-attestor budget blocks every draw, which would make a whole run
        // vacuous. That edge is pinned by CreditLineExposure.t.sol instead.
        pool.setBond(uint32(bound(count, 1, 30)), 100e18);
    }

    function humanAt(uint256 i) external view returns (uint256) {
        return humans[i];
    }

    function lenderAt(uint256 i) external view returns (address) {
        return lenders[i];
    }

    function _freshWallet() private returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("wallet", _walletNonce++)))));
    }
}

/// @notice Stateful invariants of the credit pool.
contract CreditLineInvariantTest is Test {
    CreditLineHandler internal handler;
    CreditLineHarness internal pool;
    HUSD internal husd;

    function setUp() public {
        vm.warp(1_760_000_000);
        husd = new HUSD();
        HumanRegistry registry = new HumanRegistry(address(new MockWorldID()), "app_x", "act");
        pool = new CreditLineHarness(address(husd), address(registry), 100e6, 2_000e6, 100, 30 days, 7 days, 1, 11_155_111, 10e6);
        pool.setBond(20, 100e18); // 20 × 100 CTC × 10 hUSD = 20,000 hUSD cap to start
        handler = new CreditLineHandler(pool, husd, registry);
        targetContract(address(handler));
    }

    /// Every hUSD in the pool is accounted for by a deposit or repayment, less withdrawals and draws.
    function invariant_TokensAreConserved() public view {
        assertEq(husd.balanceOf(address(pool)), handler.tokensIn() - handler.tokensOut());
    }

    /// `totalPrincipal` is exactly the ex-fee principal of every line, and never more than what
    /// borrowers owe fee-inclusive.
    function invariant_PrincipalIsTheSumOfLines() public view {
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            uint256 human = handler.humanAt(i);
            uint256 exFee = pool.principalOf(human);
            assertLe(exFee, pool.lineOf(human).principal, "ex-fee within fee-inclusive balance");
            sum += exFee;
        }
        assertEq(pool.totalPrincipal(), sum);
        assertEq(pool.totalAssets(), husd.balanceOf(address(pool)) + sum);
    }

    /// A defaulted human stays frozen on every wallet, can never borrow again, and owes nothing.
    function invariant_FrozenStaysFrozen() public view {
        for (uint256 i; i < 4; ++i) {
            uint256 human = handler.humanAt(i);
            if (!handler.frozenSeen(human)) continue;
            ICreditLine.Line memory line = pool.lineOf(human);
            assertTrue(line.frozen, "frozen forever");
            assertEq(pool.availableCredit(human), 0, "no credit after default");
        }
        assertEq(handler.frozenBorrows(), 0, "a frozen line never draws");
    }

    /// One line per human, however many wallets they move through.
    function invariant_OneLinePerHuman() public view {
        assertEq(handler.secondLines(), 0);
    }

    /// Outstanding principal never exceeds the live attestor-bond security budget after a draw.
    function invariant_ExposureCapRespected() public view {
        assertEq(handler.capBreaches(), 0);
    }

    /// Shares are fully owned by lenders.
    function invariant_SharesAddUp() public view {
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            sum += pool.sharesOf(handler.lenderAt(i));
        }
        assertEq(sum, pool.totalShares());
    }

    /// Anti-vacuity: a run that never opened a line or drew credit proves nothing.
    function afterInvariant() public view {
        assertGt(handler.calls(), 0, "handler was called");
        assertGt(handler.opens(), 0, "lines were opened");
        assertGt(handler.borrows(), 0, "credit was drawn");
    }

    /// The handler can reach every state the invariants talk about: a default, a freeze, a move to a
    /// new wallet, a refused second line and a refused frozen draw.
    function test_HandlerReachesDefaultFreezeAndRebind() public {
        handler.deposit(0, 5_000e6);
        handler.borrow(1, 50e6);
        handler.warp(38 days);
        handler.markDefault(1);
        handler.rebind(1);
        handler.openLine(1);
        handler.borrow(1, 10e6);
        handler.repay(2, 1);
        assertEq(handler.defaults(), 1);
        assertTrue(handler.frozenSeen(handler.humanAt(1)));
        assertEq(handler.opens(), 4, "the four setup lines only: the rebound wallet could not open a second line");
        assertEq(handler.secondLines(), 0);
        assertEq(handler.borrows(), 1, "the frozen human could not draw from the new wallet");
        invariant_FrozenStaysFrozen();
        invariant_TokensAreConserved();
        invariant_PrincipalIsTheSumOfLines();
    }
}
