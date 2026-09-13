// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SourceProof} from "./ISourceProof.sol";

/// @title ICreditHistory
/// @notice Real Aave V3 repayment history from a human's linked Ethereum wallets, proved through
///         Attestcoin, turned into a bounded credit-limit boost.
interface ICreditHistory {
    /// @notice An Aave V3 pool whose logs count, on one source chain.
    struct AavePool {
        uint64 chainKey;
        uint64 chainId;
        address pool;
    }

    /// @notice A reserve that counts, valued at one US dollar per whole token.
    struct Reserve {
        uint64 chainKey;
        address token;
        uint8 decimals;
    }

    /// @notice A proved borrow a later repayment can be matched against.
    struct BorrowRecord {
        uint256 human;
        address wallet;
        address reserve;
        uint64 chainKey;
        uint64 blockHeight;
        uint256 amount;
        uint256 remaining;
    }

    event BorrowProven(
        uint256 indexed human,
        address indexed wallet,
        bytes32 indexed borrowId,
        uint64 chainKey,
        uint64 blockHeight,
        address reserve,
        uint256 amount
    );

    event RepaymentProven(
        uint256 indexed human,
        address indexed wallet,
        bytes32 indexed borrowId,
        bytes32 repayId,
        uint256 amount,
        uint256 creditedUsd,
        uint256 totalRepaidUsd,
        uint256 boost
    );

    error UnsupportedPool(uint64 chainKey, address emitter);
    error NotABorrowLog();
    error NotARepayLog();
    error UnsupportedReserve(uint64 chainKey, address reserve);
    /// @notice The debt was opened on behalf of another address.
    error BorrowedForSomeoneElse(address user, address onBehalfOf);
    /// @notice The debt was repaid by another address.
    error RepaidBySomeoneElse(address user, address repayer);
    /// @notice Repaying with aTokens nets a deposit against a debt; it does not count.
    error RepaidWithATokens();
    error WalletNotLinked(address wallet);
    error UnknownBorrow(bytes32 borrowId);
    error BorrowMismatch(bytes32 borrowId);
    /// @notice The repayment came too soon after the borrow to count.
    error TooSoon(uint64 repayHeight, uint64 earliest);
    error BorrowFullyRepaid(bytes32 borrowId);
    error BadParameters();

    function proveBorrow(SourceProof calldata proof, uint256 logIndex) external returns (bytes32 borrowId);
    function proveRepay(SourceProof calldata proof, uint256 logIndex, bytes32 borrowId)
        external
        returns (uint256 creditedUsd);

    /// @notice Limit boost for a human, in six-decimal dollars.
    function boostOf(uint256 human) external view returns (uint256);
    function repaidUsdOf(uint256 human) external view returns (uint256);
    function repaymentsOf(uint256 human) external view returns (uint32);
    function borrowOf(bytes32 borrowId) external view returns (BorrowRecord memory);

    function LINKS() external view returns (address);
    function MIN_GAP_BLOCKS() external view returns (uint64);
    function BOOST_BPS() external view returns (uint256);
    function MAX_BOOST() external view returns (uint256);
}
