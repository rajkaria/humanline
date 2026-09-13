// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {GasProbe} from "../script/GasProbe.sol";

contract Burner {
    uint256[] internal slots;

    function burn(uint256 n) external returns (uint256) {
        for (uint256 i; i < n; ++i) slots.push(i);
        return n;
    }

    function fail() external pure {
        revert("nope");
    }
}

/// @notice The measurement probe `worker measure` runs through state overrides reports the gas an
///         inner call really used, its success flag and its return data.
contract GasProbeTest is Test {
    GasProbe internal probe;
    Burner internal burner;

    function setUp() public {
        probe = new GasProbe();
        burner = new Burner();
    }

    function _measure(bytes memory data) internal returns (bool ok, uint256 used, bytes memory ret) {
        (bool outer, bytes memory out) = address(probe).call(abi.encode(address(burner), data));
        assertTrue(outer, "the probe itself never reverts");
        (ok, used, ret) = abi.decode(out, (bool, uint256, bytes));
    }

    function test_ReportsGasThatGrowsWithTheWork() public {
        (bool ok1, uint256 one,) = _measure(abi.encodeCall(Burner.burn, (1)));
        (bool ok5, uint256 five, bytes memory ret) = _measure(abi.encodeCall(Burner.burn, (5)));
        assertTrue(ok1 && ok5);
        assertEq(abi.decode(ret, (uint256)), 5);
        assertGt(one, 20_000, "one cold SSTORE at least");
        // The first push also pays for the array's length slot, so five pushes cost ~3.4x one.
        assertGt(five, one * 3, "gas grows with the work done");
    }

    function test_ReportsAFailedInnerCallWithItsRevertData() public {
        (bool ok, uint256 used, bytes memory ret) = _measure(abi.encodeCall(Burner.fail, ()));
        assertFalse(ok);
        assertGt(used, 0);
        assertEq(bytes4(ret), bytes4(keccak256("Error(string)")));
    }
}
