// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICreditLine} from "./interfaces/ICreditLine.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";

/// @title CreditLine
/// @notice Unsecured revolving credit, one line per human, funded by an open lender pool.
/// @dev The collateral is the identity. A human gets one line for life: they cannot walk away from
///      a default and come back with a fresh wallet, because the line is keyed by the World ID
///      nullifier and the freeze travels with it.
///
///      Pool accounting. `totalAssets = idle balance + totalBorrowed`. Borrowing moves value from
///      idle to outstanding and books the term fee into `totalBorrowed` immediately, so lenders'
///      shares appreciate the moment a loan is drawn. A default burns the whole outstanding
///      principal, fee included, straight out of `totalBorrowed`: the pool eats the loss pro rata,
///      exactly as an uncollateralised lender should.
///
///      No owner, no pause, no upgrade. Every parameter is an immutable constructor argument.
contract CreditLine is ICreditLine {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @inheritdoc ICreditLine
    address public immutable override ASSET;
    /// @inheritdoc ICreditLine
    address public immutable override REGISTRY;
    /// @inheritdoc ICreditLine
    uint256 public immutable override INITIAL_LIMIT;
    /// @inheritdoc ICreditLine
    uint256 public immutable override MAX_LIMIT;
    /// @inheritdoc ICreditLine
    uint256 public immutable override FEE_BPS;
    /// @inheritdoc ICreditLine
    uint64 public immutable override TERM;
    /// @inheritdoc ICreditLine
    uint64 public immutable override GRACE;

    /// @inheritdoc ICreditLine
    uint256 public override totalBorrowed;
    /// @inheritdoc ICreditLine
    uint256 public override totalShares;
    /// @inheritdoc ICreditLine
    mapping(address => uint256) public override sharesOf;

    mapping(uint256 => Line) private _lines;

    constructor(
        address asset,
        address registry,
        uint256 initialLimit,
        uint256 maxLimit,
        uint256 feeBps,
        uint64 term,
        uint64 grace
    ) {
        ASSET = asset;
        REGISTRY = registry;
        INITIAL_LIMIT = initialLimit;
        MAX_LIMIT = maxLimit;
        FEE_BPS = feeBps;
        TERM = term;
        GRACE = grace;
    }

    // ---------------------------------------------------------------------------------------
    //                                        LENDERS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditLine
    function deposit(uint256 assets) external override returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();

        uint256 supply = totalShares;
        // Priced against the pool as it stands *before* the incoming transfer.
        shares = supply == 0 ? assets : (assets * supply) / totalAssets();
        if (shares == 0) revert ZeroAmount();

        totalShares = supply + shares;
        sharesOf[msg.sender] += shares;

        IERC20(ASSET).safeTransferFrom(msg.sender, address(this), assets);
        emit Deposited(msg.sender, assets, shares);
    }

    /// @inheritdoc ICreditLine
    /// @dev Withdrawals are paid from idle liquidity only. Money that is out on loan cannot be
    ///      recalled early; the lender waits for repayments, like any credit fund.
    function withdraw(uint256 shares) external override returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        uint256 held = sharesOf[msg.sender];
        if (held < shares) revert InsufficientShares(held, shares);

        assets = (shares * totalAssets()) / totalShares;

        uint256 idle = IERC20(ASSET).balanceOf(address(this));
        if (assets > idle) revert InsufficientLiquidity(assets, idle);

        sharesOf[msg.sender] = held - shares;
        totalShares -= shares;

        IERC20(ASSET).safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    // ---------------------------------------------------------------------------------------
    //                                       BORROWERS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditLine
    function openLine() external override {
        uint256 human = _humanOf(msg.sender);
        Line storage line = _lines[human];
        if (line.openedAt != 0) revert LineExists(human);

        line.limit = INITIAL_LIMIT;
        line.openedAt = uint64(block.timestamp);

        emit LineOpened(human, msg.sender, INITIAL_LIMIT);
    }

    /// @inheritdoc ICreditLine
    /// @dev The term fee is charged up front and counts against the limit, so the number a borrower
    ///      sees as "available" is what they can actually owe, not what they can receive.
    function borrow(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        uint256 human = _humanOf(msg.sender);
        Line storage line = _lines[human];
        if (line.openedAt == 0) revert NoLine(human);
        if (line.frozen) revert LineFrozen(human);

        uint256 fee = (amount * FEE_BPS) / BPS;
        uint256 owed = amount + fee;

        uint256 available = line.limit - line.principal;
        if (owed > available) revert OverLimit(owed, available);

        uint256 idle = IERC20(ASSET).balanceOf(address(this));
        if (amount > idle) revert InsufficientLiquidity(amount, idle);

        if (line.principal == 0) line.dueAt = uint64(block.timestamp) + TERM;
        line.principal += owed;
        totalBorrowed += owed;

        IERC20(ASSET).safeTransfer(msg.sender, amount);
        emit Borrowed(human, msg.sender, amount, fee, line.dueAt);
    }

    /// @inheritdoc ICreditLine
    /// @dev Overpayment is capped at the outstanding balance rather than rejected, so a borrower
    ///      racing a repayment against accrued state can always clear the line in one call.
    function repay(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        uint256 human = _humanOf(msg.sender);
        Line storage line = _lines[human];
        if (line.openedAt == 0) revert NoLine(human);

        uint256 principal = line.principal;
        if (principal == 0) revert NothingOwed(human);

        uint256 paid = amount > principal ? principal : amount;
        uint256 remaining = principal - paid;

        line.principal = remaining;
        totalBorrowed -= paid;

        IERC20(ASSET).safeTransferFrom(msg.sender, address(this), paid);
        emit Repaid(human, msg.sender, paid, remaining);

        if (remaining == 0) _settle(human, line);
    }

    /// @inheritdoc ICreditLine
    /// @dev Permissionless: anyone can report a default once the grace period has run out. The
    ///      writer-off gets nothing for it; the point is that the freeze is not the lender's to
    ///      withhold.
    function markDefault(uint256 human) external override {
        Line storage line = _lines[human];
        if (line.openedAt == 0) revert NoLine(human);

        uint256 principal = line.principal;
        if (principal == 0) revert NothingOwed(human);

        uint64 deadline = line.dueAt + GRACE;
        if (block.timestamp <= deadline) revert NotInDefault(human, line.dueAt, GRACE);

        line.frozen = true;
        line.principal = 0;
        totalBorrowed -= principal;

        emit Defaulted(human, principal, msg.sender);
    }

    // ---------------------------------------------------------------------------------------
    //                                          VIEWS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditLine
    function lineOf(uint256 human) external view override returns (Line memory) {
        return _lines[human];
    }

    /// @inheritdoc ICreditLine
    function availableCredit(uint256 human) external view override returns (uint256) {
        Line storage line = _lines[human];
        if (line.openedAt == 0 || line.frozen) return 0;
        return line.limit - line.principal;
    }

    /// @inheritdoc ICreditLine
    function totalAssets() public view override returns (uint256) {
        return IERC20(ASSET).balanceOf(address(this)) + totalBorrowed;
    }

    /// @inheritdoc ICreditLine
    function isInDefault(uint256 human) external view override returns (bool) {
        Line storage line = _lines[human];
        return line.principal != 0 && block.timestamp > line.dueAt + GRACE;
    }

    /// @notice The line belonging to a wallet, resolved through the registry. Convenience for the
    ///         web app, which knows wallets rather than nullifiers.
    function lineOfWallet(address wallet) external view returns (Line memory) {
        return _lines[IHumanRegistry(REGISTRY).humanOf(wallet)];
    }

    // ---------------------------------------------------------------------------------------
    //                                        INTERNALS
    // ---------------------------------------------------------------------------------------

    /// @dev A cleared balance re-prices the limit: paid on time and it grows by a quarter, capped;
    ///      paid late and it halves, floored at half the starting limit so a late payer keeps a
    ///      way back rather than being pushed towards walking away.
    function _settle(uint256 human, Line storage line) private {
        bool onTime = block.timestamp <= line.dueAt;
        uint256 oldLimit = line.limit;
        uint256 newLimit;

        if (onTime) {
            newLimit = (oldLimit * 125) / 100;
            if (newLimit > MAX_LIMIT) newLimit = MAX_LIMIT;
            line.loansRepaid += 1;
        } else {
            newLimit = oldLimit / 2;
            uint256 floorLimit = INITIAL_LIMIT / 2;
            if (newLimit < floorLimit) newLimit = floorLimit;
            line.loansLate += 1;
        }

        line.limit = newLimit;
        emit LimitChanged(human, oldLimit, newLimit, onTime);
    }

    function _humanOf(address wallet) private view returns (uint256 human) {
        human = IHumanRegistry(REGISTRY).humanOf(wallet);
        if (human == 0) revert NotHuman(wallet);
    }
}
