// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICreditLine} from "./interfaces/ICreditLine.sol";
import {IHumanRegistry} from "./interfaces/IHumanRegistry.sol";
import {AttestorStashLib} from "./interfaces/IAttestorStash.sol";
import {ChainInfoLib, ChainInfoResult} from "./interfaces/IChainInfo.sol";

/// @title CreditLine
/// @notice Unsecured revolving credit, one line per human, funded by an open lender pool.
/// @dev The collateral is the identity. A human gets one line for life: they cannot walk away from
///      a default and come back with a fresh wallet, because the line is keyed by the World ID
///      nullifier and the freeze travels with it.
///
///      Pool accounting. `totalAssets = idle balance + totalPrincipal`, where `totalPrincipal` is
///      the *ex-fee* amount still out on loan. A draw moves value from idle to outstanding and
///      leaves `totalAssets` unchanged: the term fee is income only once it is actually paid, so a
///      lender cannot withdraw more than they put in while a loan is still running, and cannot
///      exit ahead of a default with someone else's unearned interest. A repayment clears the
///      ex-fee principal first; whatever comes in on top is fee income, already sitting in the
///      balance. A default writes off the ex-fee principal, and the pool eats that loss pro rata,
///      exactly as an uncollateralised lender should.
///
///      Shares are priced with OpenZeppelin's virtual-offset rule:
///        `shares = assets * (totalShares + VIRTUAL_SHARES) / (totalAssets + 1)`
///        `assets = shares * (totalAssets + 1) / (totalShares + VIRTUAL_SHARES)`
///      The `+ 1` makes the pool impossible to brick: a write-off that empties it leaves the
///      denominator at 1 rather than 0, so a new deposit re-seeds the pool instead of reverting
///      with an arithmetic panic, and the worthless legacy shares stay worthless. The
///      `+ VIRTUAL_SHARES` bounds the classic first-depositor donation attack: an attacker who
///      opens with one unit and then donates has to give up most of the donation to the virtual
///      tranche, and the next depositor's rounding loss is capped at roughly `1 / VIRTUAL_SHARES`.
///
///      Security budget. Every root this pool lends against arrived through Attestcoin, so the
///      deepest assumption under every loan is the attestor quorum for the World ID source chain.
///      A quorum that attested a fake Ethereum block could mint a fake human and borrow. The pool
///      therefore never lets total outstanding principal exceed what that quorum has bonded:
///      `cap = getAttestorsCount(chainKey) × getMinBondRequirement(chainKey) × EXPOSURE_PER_BONDED_CTC`,
///      read live from AttestorStash `0x0FD4` on every draw. More attestors or a higher bond raise
///      the ceiling; a thinning set lowers it, and a set that reports zero stops new draws
///      entirely. Repayments, withdrawals and defaults are never blocked. The constructor also
///      checks through ChainInfo `0x0FD3` that the chain key really is the source chain the
///      deployer claims (chainKey 3 → Ethereum chainId 1, chainKey 1 → Sepolia 11155111), so the
///      budget can never be read from the wrong chain by a copy-paste mistake.
///
///      No owner, no pause, no upgrade. Every parameter is an immutable constructor argument.
contract CreditLine is ICreditLine {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant ONE_CTC = 1e18;

    /// @dev Virtual share tranche backed by one virtual asset. See the contract-level note.
    uint256 private constant VIRTUAL_SHARES = 1e3;

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
    uint64 public immutable override SECURITY_CHAIN_KEY;
    /// @inheritdoc ICreditLine
    uint64 public immutable override SOURCE_CHAIN_ID;
    /// @inheritdoc ICreditLine
    uint256 public immutable override EXPOSURE_PER_BONDED_CTC;

    /// @notice Ex-fee principal still out on loan across every line. This, not the borrowers'
    ///         fee-inclusive balances, is what the pool counts as an asset.
    uint256 public totalPrincipal;
    /// @inheritdoc ICreditLine
    uint256 public override totalShares;
    /// @inheritdoc ICreditLine
    mapping(address => uint256) public override sharesOf;

    mapping(uint256 => Line) private _lines;
    /// @dev Per human: the ex-fee slice of `Line.principal` that is still outstanding.
    mapping(uint256 => uint256) private _principalExFee;

    constructor(
        address asset,
        address registry,
        uint256 initialLimit,
        uint256 maxLimit,
        uint256 feeBps,
        uint64 term,
        uint64 grace,
        uint64 securityChainKey,
        uint64 sourceChainId,
        uint256 exposurePerBondedCtc
    ) {
        if (exposurePerBondedCtc == 0) revert ZeroAmount();
        (bool exists, uint64 chainId) = _chainIdOf(securityChainKey);
        if (!exists || chainId != sourceChainId) revert WrongSecurityChain(securityChainKey, chainId, sourceChainId);

        ASSET = asset;
        REGISTRY = registry;
        INITIAL_LIMIT = initialLimit;
        MAX_LIMIT = maxLimit;
        FEE_BPS = feeBps;
        TERM = term;
        GRACE = grace;
        SECURITY_CHAIN_KEY = securityChainKey;
        SOURCE_CHAIN_ID = sourceChainId;
        EXPOSURE_PER_BONDED_CTC = exposurePerBondedCtc;
    }

    // ---------------------------------------------------------------------------------------
    //                                        LENDERS
    // ---------------------------------------------------------------------------------------

    /// @inheritdoc ICreditLine
    function deposit(uint256 assets) external override returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();

        // Priced against the pool as it stands *before* the incoming transfer.
        shares = (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets() + 1);
        if (shares == 0) revert ZeroAmount();

        totalShares += shares;
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

        assets = (shares * (totalAssets() + 1)) / (totalShares + VIRTUAL_SHARES);

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

        uint256 cap = exposureCap();
        if (totalPrincipal + amount > cap) revert ExposureCapExceeded(totalPrincipal + amount, cap);

        if (line.principal == 0) line.dueAt = uint64(block.timestamp) + TERM;
        line.principal += owed;
        _principalExFee[human] += amount;
        totalPrincipal += amount;

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

        // Clear the ex-fee principal first; anything on top of it is earned fee income, which the
        // incoming transfer puts straight into the idle balance.
        uint256 exFee = _principalExFee[human];
        uint256 principalPaid = paid > exFee ? exFee : paid;
        _principalExFee[human] = exFee - principalPaid;
        totalPrincipal -= principalPaid;

        line.principal = remaining;

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

        // The pool only ever counted the ex-fee slice as an asset, so that is all it can lose.
        totalPrincipal -= _principalExFee[human];
        _principalExFee[human] = 0;

        // `writtenOff` is the borrower's whole outstanding debt, fee included; the pool's realised
        // loss is the ex-fee part of it.
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
        return IERC20(ASSET).balanceOf(address(this)) + totalPrincipal;
    }

    /// @inheritdoc ICreditLine
    /// @dev The ex-fee amount out on loan. Borrowers owe more than this - their balances carry the
    ///      term fee - but unearned fees are not pool assets.
    function totalBorrowed() external view override returns (uint256) {
        return totalPrincipal;
    }

    /// @notice The ex-fee slice of a human's outstanding balance; the rest is the accrued term fee.
    function principalOf(uint256 human) external view returns (uint256) {
        return _principalExFee[human];
    }

    /// @inheritdoc ICreditLine
    function isInDefault(uint256 human) external view override returns (bool) {
        Line storage line = _lines[human];
        return line.principal != 0 && block.timestamp > line.dueAt + GRACE;
    }

    /// @inheritdoc ICreditLine
    function securityBudget() public view override returns (uint32 attestors, uint128 minBond, uint256 cap) {
        (attestors, minBond) = _bond();
        cap = (uint256(attestors) * uint256(minBond) * EXPOSURE_PER_BONDED_CTC) / ONE_CTC;
    }

    /// @inheritdoc ICreditLine
    function exposureCap() public view override returns (uint256 cap) {
        (,, cap) = securityBudget();
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

    /// @dev Bonded attestors and the minimum bond for the security chain, from AttestorStash `0x0FD4`.
    ///      `internal virtual` only so unit tests can run without the native precompile; the fork
    ///      tests read the real one.
    function _bond() internal view virtual returns (uint32 attestors, uint128 minBond) {
        attestors = AttestorStashLib.get().getAttestorsCount(SECURITY_CHAIN_KEY);
        minBond = AttestorStashLib.get().getMinBondRequirement(SECURITY_CHAIN_KEY);
    }

    /// @dev EVM chain id Creditcoin's ChainInfo `0x0FD3` records for a chain key. Virtual for the same
    ///      reason as `_bond`.
    function _chainIdOf(uint64 chainKey) internal view virtual returns (bool exists, uint64 chainId) {
        ChainInfoResult memory result = ChainInfoLib.get().get_chain_by_key(chainKey);
        return (result.exists, result.info.chainId);
    }

    function _humanOf(address wallet) private view returns (uint256 human) {
        human = IHumanRegistry(REGISTRY).humanOf(wallet);
        if (human == 0) revert NotHuman(wallet);
    }
}
