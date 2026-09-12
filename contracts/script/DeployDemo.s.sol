// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Deploy} from "./Deploy.s.sol";

/// @notice The judge-facing deployment: identical to `Deploy`, but a loan term of ten minutes and a
///         grace period of five, so a borrow, a late repayment and a default all fit in a demo.
///
///     forge script script/DeployDemo.s.sol:DeployDemo --rpc-url cc3 --broadcast
contract DeployDemo is Deploy {
    uint64 internal constant DEMO_TERM = 600;
    uint64 internal constant DEMO_GRACE = 300;

    function run() external override returns (Deployment memory) {
        return _deploy(DEMO_TERM, DEMO_GRACE, "demo");
    }
}
