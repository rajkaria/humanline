// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ICreditLine
/// @notice An unsecured revolving credit line, one per human, funded by a shared lender pool.
/// @dev All borrower state is keyed by World ID nullifier, so a human who moves wallets keeps the
///      same line - limit, balance and default flag included.
interface ICreditLine {
    struct Line {
        uint256 limit;
        uint256 principal;
        uint64 dueAt;
        uint64 openedAt;
        uint32 loansRepaid;
        uint32 loansLate;
        bool frozen;
    }

    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event LineOpened(uint256 indexed human, address indexed wallet, uint256 limit);
    event Borrowed(uint256 indexed human, address indexed wallet, uint256 amount, uint256 fee, uint64 dueAt);
    event Repaid(uint256 indexed human, address indexed wallet, uint256 amount, uint256 remaining);
    event LimitChanged(uint256 indexed human, uint256 oldLimit, uint256 newLimit, bool onTime);
    event Defaulted(uint256 indexed human, uint256 writtenOff, address indexed reporter);

    /// @notice The caller has not proved personhood in the registry.
    error NotHuman(address wallet);
    /// @notice This human already has a line.
    error LineExists(uint256 human);
    /// @notice This human has no line yet.
    error NoLine(uint256 human);
    /// @notice The line was frozen by a default and can never borrow again.
    error LineFrozen(uint256 human);
    /// @notice The draw would take the balance past the credit limit.
    error OverLimit(uint256 requested, uint256 available);
    /// @notice The pool does not hold enough idle liquidity right now.
    error InsufficientLiquidity(uint256 requested, uint256 available);
    /// @notice There is nothing to repay or to default on.
    error NothingOwed(uint256 human);
    /// @notice The loan is not past its due date plus the grace period.
    error NotInDefault(uint256 human, uint64 dueAt, uint64 grace);
    /// @notice Zero-valued deposit, withdrawal, draw or repayment.
    error ZeroAmount();
    /// @notice The lender does not hold that many shares. (Not in the plan sketch; a named error
    ///         beats an arithmetic panic.)
    error InsufficientShares(uint256 have, uint256 want);
    /// @notice The draw would take total outstanding principal past what the attestor quorum has bonded.
    error ExposureCapExceeded(uint256 wouldOwe, uint256 cap);
    /// @notice ChainInfo does not record `chainKey` as the claimed source chain.
    error WrongSecurityChain(uint64 chainKey, uint64 recordedChainId, uint64 claimedChainId);

    function ASSET() external view returns (address);
    function REGISTRY() external view returns (address);
    function INITIAL_LIMIT() external view returns (uint256);
    function MAX_LIMIT() external view returns (uint256);
    function FEE_BPS() external view returns (uint256);
    function TERM() external view returns (uint64);
    function GRACE() external view returns (uint64);
    /// @notice Attestcoin chain key whose attestor bonds back this pool (the World ID source chain).
    function SECURITY_CHAIN_KEY() external view returns (uint64);
    /// @notice EVM chain id ChainInfo confirmed for `SECURITY_CHAIN_KEY` at deployment.
    function SOURCE_CHAIN_ID() external view returns (uint64);
    /// @notice Asset base units of outstanding principal allowed per 1 CTC of bonded attestor capital.
    function EXPOSURE_PER_BONDED_CTC() external view returns (uint256);
    /// @notice `CreditHistory` whose proved Aave repayments boost limits; zero for none.
    function HISTORY() external view returns (address);

    function deposit(uint256 assets) external returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 assets);
    function openLine() external;
    function borrow(uint256 amount) external;
    function repay(uint256 amount) external;
    /// @notice Repay `human`'s line from the caller's funds (used by `EthRepay`; open to anyone).
    function repayFor(uint256 human, uint256 amount) external;
    function markDefault(uint256 human) external;

    function lineOf(uint256 human) external view returns (Line memory);
    function availableCredit(uint256 human) external view returns (uint256);
    /// @notice The limit a human can draw against now: line limit plus history boost, capped.
    function limitOf(uint256 human) external view returns (uint256);
    /// @notice The proved-history boost included in `limitOf`.
    function boostOf(uint256 human) external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function totalBorrowed() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function sharesOf(address lender) external view returns (uint256);
    function isInDefault(uint256 human) external view returns (bool);
    /// @notice Live security budget: bonded attestors, minimum bond (wei) and the resulting cap.
    function securityBudget() external view returns (uint32 attestors, uint128 minBond, uint256 cap);
    /// @notice Maximum total outstanding principal right now.
    function exposureCap() external view returns (uint256);
}
