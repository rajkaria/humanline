// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HumanLinks} from "../../src/HumanLinks.sol";
import {CreditHistory} from "../../src/CreditHistory.sol";
import {EthRepay} from "../../src/EthRepay.sol";

/// @dev Native precompiles (`0x0FD3` ChainInfo, `0x0FD4` AttestorStash) do not exist in Foundry's EVM.
///      Each harness answers them from storage with CC3 testnet's real chain table; the block prover
///      `0x0FD2` is etched with `MockNativeQueryVerifier` by the tests, and the fork tests read the
///      real ones.
library ChainTable {
    function chainIdOf(uint64 chainKey) internal pure returns (bool, uint64) {
        if (chainKey == 3) return (true, 1);
        if (chainKey == 1) return (true, 11_155_111);
        return (false, 0);
    }
}

contract HumanLinksHarness is HumanLinks {
    uint64 public tip = 1e12;
    uint32 public attestors = 4;

    constructor(address registry, uint64[] memory keys, uint64[] memory ids)
        HumanLinks(registry, keys, ids, 32, 3)
    {}

    function setTip(uint64 value) external {
        tip = value;
    }

    function setAttestors(uint32 value) external {
        attestors = value;
    }

    function _attestedTip(uint64) internal view override returns (uint64) {
        return tip;
    }

    function _attestorCount(uint64) internal view override returns (uint32) {
        return attestors;
    }

    function _chainInfoChainId(uint64 chainKey) internal pure override returns (bool, uint64) {
        return ChainTable.chainIdOf(chainKey);
    }
}

contract CreditHistoryHarness is CreditHistory {
    uint64 public tip = 1e12;

    constructor(
        address links,
        AavePool[] memory pools,
        Reserve[] memory reserves,
        uint64 minGapBlocks,
        uint256 boostBps,
        uint256 maxBoost
    ) CreditHistory(links, pools, reserves, 32, 3, minGapBlocks, boostBps, maxBoost) {}

    function setTip(uint64 value) external {
        tip = value;
    }

    function _attestedTip(uint64) internal view override returns (uint64) {
        return tip;
    }

    function _attestorCount(uint64) internal pure override returns (uint32) {
        return 4;
    }

    function _chainInfoChainId(uint64 chainKey) internal pure override returns (bool, uint64) {
        return ChainTable.chainIdOf(chainKey);
    }
}

contract EthRepayHarness is EthRepay {
    constructor(address links, address creditLine, address repayAddress, Stablecoin[] memory stablecoins)
        EthRepay(links, creditLine, repayAddress, stablecoins, 32, 3, 6)
    {}

    function _attestedTip(uint64) internal pure override returns (uint64) {
        return 1e12;
    }

    function _attestorCount(uint64) internal pure override returns (uint32) {
        return 4;
    }

    function _chainInfoChainId(uint64 chainKey) internal pure override returns (bool, uint64) {
        return ChainTable.chainIdOf(chainKey);
    }
}

/// @notice The one `HumanLinks` read `CreditHistory` and `EthRepay` make, settable by tests.
contract MockLinks {
    mapping(address => uint256) public humanOfWallet;

    function setHuman(address wallet, uint256 human) external {
        humanOfWallet[wallet] = human;
    }
}

/// @notice The one `CreditHistory` read `CreditLine` makes, settable by tests.
contract MockHistory {
    mapping(uint256 => uint256) public boostOf;

    function setBoost(uint256 human, uint256 boost) external {
        boostOf[human] = boost;
    }
}
