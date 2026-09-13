// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title GasProbe
/// @notice Measurement tool, never deployed: `worker measure` places this runtime code at a scratch
///         address through an `eth_call` state override and asks it how much gas one inner call used.
///         That turns a read-only call into a gas measurement, which `eth_estimateGas` cannot give for
///         a call that also needs state overrides (a fresh relay copy) on CC3.
/// @dev Calldata is `abi.encode(address target, bytes data)`; returns `abi.encode(bool ok, uint256
///      gasUsed, bytes returnData)`. `gasUsed` is execution gas of the inner call only; the worker adds
///      intrinsic transaction gas (21,000 plus calldata) when comparing with real receipts.
contract GasProbe {
    fallback(bytes calldata input) external returns (bytes memory) {
        (address target, bytes memory data) = abi.decode(input, (address, bytes));
        uint256 before = gasleft();
        (bool ok, bytes memory ret) = target.call(data);
        uint256 used = before - gasleft();
        return abi.encode(ok, used, ret);
    }
}
