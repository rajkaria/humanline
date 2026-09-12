// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Proves the fixture loader reads the real JSON correctly before anything depends on it.
contract FixtureSanityTest is Fixtures {
    function test_MainnetFixtureLoads() public view {
        ProofFixture memory f = loadFixture(MAINNET_FIXTURE);
        assertEq(f.chainKey, 3, "chainKey");
        assertEq(f.headerNumber, 25_959_565, "headerNumber");
        assertEq(f.txIndex, 173, "txIndex");
        assertEq(f.siblings.length, 9, "siblings");
        assertEq(f.continuityRoots.length, 36, "continuity roots");
        assertEq(f.merkleRoot, f.continuityRoots[0], "merkle root is the first continuity root");

        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(f.txBytes);
        assertEq(common.to, MAINNET_IDENTITY_MANAGER, "to");
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(f.txBytes);
        assertEq(receipt.receiptStatus, 1, "status");
        assertEq(receipt.receiptLogs.length, 1, "logs");
        assertEq(receipt.receiptLogs[0].topics[0], TREE_CHANGED_TOPIC, "topic0");
    }

    function test_SepoliaFixtureLoads() public view {
        ProofFixture memory f = loadFixture(SEPOLIA_FIXTURE);
        assertEq(f.chainKey, 1, "chainKey");
        assertEq(f.headerNumber, 11_687_163, "headerNumber");
        assertEq(f.txIndex, 58, "txIndex");
        assertEq(f.siblings.length, 7, "siblings");
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(f.txBytes);
        assertEq(common.to, SEPOLIA_IDENTITY_MANAGER, "to");
    }

    /// @notice The mock prover derives the transaction index from the sibling side flags. If that
    ///         rule ever diverged from the real precompile, both real fixtures would disagree here.
    function test_SiblingFlagsEncodeTheRealTxIndex() public view {
        ProofFixture memory mainnet = loadFixture(MAINNET_FIXTURE);
        assertEq(_indexFromSiblings(mainnet), mainnet.txIndex, "mainnet");
        ProofFixture memory sepolia = loadFixture(SEPOLIA_FIXTURE);
        assertEq(_indexFromSiblings(sepolia), sepolia.txIndex, "sepolia");
    }

    function _indexFromSiblings(ProofFixture memory f) private pure returns (uint64 index) {
        for (uint256 i; i < f.siblings.length; ++i) {
            if (f.siblings[i].isLeft) index |= uint64(1) << uint64(i);
        }
    }
}
