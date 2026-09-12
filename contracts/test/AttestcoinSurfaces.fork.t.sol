// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";

import {Fixtures} from "./Fixtures.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {ChainInfoResult, HeightHashResult, BoundsCheckResult} from "../src/interfaces/IChainInfo.sol";

/// @notice Live reads of every ChainInfo and AttestorStash surface Humanline's credit and relay
///         logic depends on, against Creditcoin CC3 testnet. Skipped unless `CC3_FORK` is set:
///
///     CC3_FORK=1 forge test --match-contract AttestcoinSurfacesFork -vv
///
/// @dev Same technique as `AttestedWorldID.fork.t.sol`: the precompiles are native, so they are read
///      with `vm.rpc("eth_call")` and the answers are then pinned into the local EVM where a contract
///      has to consume them.
contract AttestcoinSurfacesForkTest is Fixtures {
    string internal constant CC3 = "cc3";

    modifier onlyFork() {
        if (bytes(vm.envOr("CC3_FORK", string(""))).length == 0) {
            vm.skip(true);
            return;
        }
        _;
    }

    /// ChainInfo `get_chain_by_key`: the chain-key → EVM chain id table CreditLine asserts at deploy.
    function testFork_ChainInfoMapsChainKeysToTheRightEvmChains() public onlyFork {
        ChainInfoResult memory eth = _chain(3);
        ChainInfoResult memory sep = _chain(1);
        console.log("chainKey 3 ->", eth.info.chainId, string(eth.info.chainName));
        console.log("chainKey 1 ->", sep.info.chainId, string(sep.info.chainName));
        assertTrue(eth.exists && sep.exists, "both source chains are tracked");
        assertEq(eth.info.chainId, 1, "testnet chainKey 3 is Ethereum mainnet");
        assertEq(sep.info.chainId, 11_155_111, "testnet chainKey 1 is Sepolia");
        assertFalse(_chain(424_242).exists, "an unknown key does not exist");
    }

    /// AttestorStash `getMinBondRequirement` × `getAttestorsCount`: the live security budget.
    function testFork_SecurityBudgetIsReadable() public onlyFork {
        for (uint64 key = 1; key <= 3; key += 2) {
            uint32 count = abi.decode(_call(ATTESTOR_STASH, abi.encodeWithSignature("getAttestorsCount(uint64)", key)), (uint32));
            uint128 bond = abi.decode(_call(ATTESTOR_STASH, abi.encodeWithSignature("getMinBondRequirement(uint64)", key)), (uint128));
            console.log("chainKey", key);
            console.log("  attestors", count, "min bond (CTC)", bond / 1e18);
            console.log("  cap at 10 hUSD/CTC (hUSD)", (uint256(count) * bond * 10e6) / 1e18 / 1e6);
            assertGt(count, 0, "bonded attestors exist");
            assertGt(bond, 0, "a minimum bond is enforced");
        }
    }

    /// `is_height_attested`, `get_attestation_bounds`, `find_lowest_attested_after`: continuity around a height.
    function testFork_AttestationBoundsBracketARecentHeight() public onlyFork {
        HeightHashResult memory tip = abi.decode(
            _call(CHAIN_INFO, abi.encodeWithSignature("get_latest_attestation_height_and_hash(uint64)", uint64(3))),
            (HeightHashResult)
        );
        uint64 target = tip.height - 55;
        bool attested = abi.decode(
            _call(CHAIN_INFO, abi.encodeWithSignature("is_height_attested(uint64,uint64)", uint64(3), target)), (bool)
        );
        BoundsCheckResult memory b = abi.decode(
            _call(CHAIN_INFO, abi.encodeWithSignature("get_attestation_bounds(uint64,uint64)", uint64(3), target)),
            (BoundsCheckResult)
        );
        HeightHashResult memory after_ = abi.decode(
            _call(CHAIN_INFO, abi.encodeWithSignature("find_lowest_attested_after(uint64,uint64)", uint64(3), target)),
            (HeightHashResult)
        );
        console.log("target", target);
        console.log("  parent", b.parentHeight, "child", b.childHeight);
        assertTrue(attested && b.isAttested, "a height behind the tip is attested");
        assertLe(b.parentHeight, target);
        assertGe(b.childHeight, target);
        assertEq(after_.height, b.childHeight, "lowest attested after == the bounds' child");
        assertEq(after_.hash, b.childHash);
    }

    /// The whole CreditLine constructor guard, fed the real ChainInfo answer.
    function testFork_CreditLineAcceptsTheRealChainAndRefusesAWrongOne() public onlyFork {
        bytes memory real = _call(CHAIN_INFO, abi.encodeWithSignature("get_chain_by_key(uint64)", uint64(1)));
        vm.etch(CHAIN_INFO, hex"00");
        vm.mockCall(CHAIN_INFO, abi.encodeWithSignature("get_chain_by_key(uint64)", uint64(1)), real);

        CreditLine ok = new CreditLine(address(1), address(2), 1, 2, 100, 1, 1, 1, 11_155_111, 10e6);
        assertEq(ok.SOURCE_CHAIN_ID(), 11_155_111);

        vm.expectRevert();
        new CreditLine(address(1), address(2), 1, 2, 100, 1, 1, 1, 1, 10e6);
    }

    function _chain(uint64 key) internal returns (ChainInfoResult memory) {
        return abi.decode(_call(CHAIN_INFO, abi.encodeWithSignature("get_chain_by_key(uint64)", key)), (ChainInfoResult));
    }

    function _call(address to, bytes memory data) internal returns (bytes memory) {
        return vm.rpc(
            CC3, "eth_call", string.concat('[{"to":"', vm.toString(to), '","input":"', vm.toString(data), '"},"latest"]')
        );
    }
}
