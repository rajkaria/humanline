// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditLine} from "../../src/CreditLine.sol";

/// @notice `CreditLine` with the AttestorStash (`0x0FD4`) and ChainInfo (`0x0FD3`) reads stubbed.
/// @dev Native precompiles do not exist in Foundry's EVM. The defaults describe a generous budget
///      (1,000,000 attestors × 100 CTC) so tests about anything else never meet the cap; the
///      exposure-cap tests lower it explicitly. The chain id answer is read in the constructor, so
///      it is a constant keyed by chain key rather than storage.
contract CreditLineHarness is CreditLine {
    uint32 public attestors = 1_000_000;
    uint128 public minBond = 100e18;

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
    )
        CreditLine(
            asset,
            registry,
            initialLimit,
            maxLimit,
            feeBps,
            term,
            grace,
            securityChainKey,
            sourceChainId,
            exposurePerBondedCtc
        )
    {}

    function setBond(uint32 count, uint128 bond) external {
        attestors = count;
        minBond = bond;
    }

    function _bond() internal view override returns (uint32, uint128) {
        return (attestors, minBond);
    }

    /// @dev ChainInfo's real table on CC3 testnet: chainKey 3 is Ethereum (1), 1 is Sepolia (11155111).
    function _chainIdOf(uint64 chainKey) internal pure override returns (bool, uint64) {
        if (chainKey == 3) return (true, 1);
        if (chainKey == 1) return (true, 11_155_111);
        return (false, 0);
    }
}
