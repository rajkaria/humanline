// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";

import {Fixtures} from "./Fixtures.sol";

/// @notice The live Creditcoin block prover `0x0FD2` accepts every cross-chain fixture the unit tests
///         build on: the Aave V3 borrow and repay and the Circle USDC transfer on Sepolia. Skipped
///         unless `CC3_FORK` is set:
///
///     CC3_FORK=1 forge test --match-contract CrossChainFixturesFork -vv
///
/// @dev Same technique as `AttestedWorldID.fork.t.sol`: the precompile is native, so it is asked with
///      `vm.rpc("eth_call")` against CC3 testnet rather than through a forked EVM.
contract CrossChainFixturesForkTest is Fixtures {
    string internal constant CC3 = "cc3";

    modifier onlyFork() {
        if (bytes(vm.envOr("CC3_FORK", string(""))).length == 0) {
            vm.skip(true);
            return;
        }
        _;
    }

    function testFork_BlockProverVerifiesTheAaveBorrow() public onlyFork {
        _assertVerifies(AAVE_BORROW_FIXTURE);
    }

    function testFork_BlockProverVerifiesTheAaveRepay() public onlyFork {
        _assertVerifies(AAVE_REPAY_FIXTURE);
    }

    function testFork_BlockProverVerifiesTheUsdcTransfer() public onlyFork {
        _assertVerifies(USDC_TRANSFER_FIXTURE);
    }

    function _assertVerifies(string memory path) internal {
        ProofFixture memory f = loadFixture(path);
        bytes memory data = abi.encodeWithSelector(
            bytes4(keccak256("verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))")),
            f.chainKey,
            f.headerNumber,
            f.txBytes,
            merkleProofOf(f),
            continuityProofOf(f)
        );
        bool verified = abi.decode(_ethCall(BLOCK_PROVER, data), (bool));
        console.log(path, "verified by 0x0FD2:", verified);
        assertTrue(verified, "0x0FD2 verifies the fixture");

        uint64 txIndex = abi.decode(
            _ethCall(
                BLOCK_PROVER,
                abi.encodeWithSelector(bytes4(keccak256("calculateTxIndex((bytes32,(bytes32,bool)[]))")), merkleProofOf(f))
            ),
            (uint64)
        );
        assertEq(txIndex, f.txIndex, "0x0FD2 agrees on the transaction index");
    }

    function _ethCall(address to, bytes memory data) internal returns (bytes memory) {
        string memory params = string.concat(
            '[{"to":"', vm.toString(to), '","data":"', vm.toString(data), '"},"latest"]'
        );
        return vm.rpc(CC3, "eth_call", params);
    }
}
