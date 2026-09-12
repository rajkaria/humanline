// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";

import {Fixtures} from "./Fixtures.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";

import {AttestedWorldID} from "../src/AttestedWorldID.sol";
import {IAttestedWorldID} from "../src/interfaces/IAttestedWorldID.sol";
import {ChainInfo, HeightHashResult} from "../src/interfaces/IChainInfo.sol";

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Live tests against Creditcoin CC3 testnet. Skipped unless `CC3_FORK` is set:
///
///     CC3_FORK=1 ../.tools/forge test --match-contract Fork -vv
///
/// @dev `--fork-url https://rpc.cc3-testnet.creditcoin.network` does NOT work with Foundry 1.5.1:
///      CC3 block headers carry no `mixHash`, so revm rejects the forked environment with
///      "header validation error: `prevrandao` not set" before any test body runs (and
///      `--block-prevrandao` does not override it). These tests therefore talk to the live node
///      through `vm.rpc("cc3", ...)`, using the `cc3` alias already in `foundry.toml`, which needs
///      no fork and reaches exactly the same chain state.
///
/// @dev Creditcoin's BlockProver (`0x0FD2`), ChainInfo (`0x0FD3`) and AttestorStash (`0x0FD4`) are
///      *native* Substrate precompiles: they have no EVM bytecode (`NativeQueryVerifierLib` says so
///      itself), so `--fork-url` state replay cannot bring them into Foundry's local EVM. These
///      tests therefore read them the only honest way - `vm.rpc("eth_call", ...)` against the live
///      node - and then pin the local EVM to those real answers with `vm.etch` before driving the
///      contract end to end. Every number the contract sees here came off the real chain.
contract AttestedWorldIDForkTest is Fixtures {
    /// @dev Alias from `[rpc_endpoints]` in foundry.toml.
    string internal constant CC3_RPC_ALIAS = "cc3";

    uint64 internal constant FINALITY_DEPTH = 32;
    uint32 internal constant MIN_ATTESTORS = 3;

    modifier onlyFork() {
        if (!_forkEnabled()) {
            vm.skip(true);
            return;
        }
        _;
    }

    function _forkEnabled() internal view returns (bool) {
        return bytes(vm.envOr("CC3_FORK", string(""))).length != 0;
    }

    // -----------------------------------------------------------------------------------

    /// @notice Read the real ChainInfo precompile: supported chains and the attested tip we gate on.
    function testFork_ChainInfoReportsTheSourceChains() public onlyFork {
        ChainInfo[] memory chains = abi.decode(
            _ethCall(CHAIN_INFO, abi.encodeWithSignature("get_supported_chains()")), (ChainInfo[])
        );
        assertGt(chains.length, 0, "CC3 tracks at least one source chain");
        for (uint256 i; i < chains.length; ++i) {
            console.log(
                "chainKey %s chainId %s name %s",
                vm.toString(chains[i].chainKey),
                vm.toString(chains[i].chainId),
                string(chains[i].chainName)
            );
        }

        HeightHashResult memory attestation = _latestAttestation(3);
        console.log("mainnet attested tip:", vm.toString(attestation.height));
        HeightHashResult memory checkpoint = _latestCheckpoint(3);
        console.log("mainnet checkpoint tip:", vm.toString(checkpoint.height));

        assertTrue(attestation.exists || checkpoint.exists, "chain key 3 has an attested or checkpointed tip");
    }

    /// @notice Read the real AttestorStash precompile.
    function testFork_AttestorStashReportsBondedAttestors() public onlyFork {
        uint32 mainnetAttestors = _attestorCount(3);
        uint32 sepoliaAttestors = _attestorCount(1);
        console.log("bonded attestors - mainnet(3):", vm.toString(mainnetAttestors));
        console.log("bonded attestors - sepolia(1):", vm.toString(sepoliaAttestors));
        assertGt(mainnetAttestors, 0, "mainnet has bonded attestors");
    }

    /// @notice The real block prover accepts the real fixture proof, and agrees on the tx index.
    function testFork_BlockProverVerifiesTheMainnetFixture() public onlyFork {
        ProofFixture memory f = loadFixture(MAINNET_FIXTURE);

        bool verified = abi.decode(
            _ethCall(
                BLOCK_PROVER,
                abi.encodeWithSelector(
                    bytes4(
                        keccak256(
                            "verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))"
                        )
                    ),
                    f.chainKey,
                    f.headerNumber,
                    f.txBytes,
                    merkleProofOf(f),
                    continuityProofOf(f)
                )
            ),
            (bool)
        );
        assertTrue(verified, "0x0FD2 verifies the mainnet fixture");

        uint64 txIndex = abi.decode(
            _ethCall(
                BLOCK_PROVER,
                abi.encodeWithSelector(
                    bytes4(keccak256("calculateTxIndex((bytes32,(bytes32,bool)[]))")), merkleProofOf(f)
                )
            ),
            (uint64)
        );
        assertEq(txIndex, f.txIndex, "0x0FD2 agrees on the transaction index");
    }

    function testFork_BlockProverVerifiesTheSepoliaFixture() public onlyFork {
        ProofFixture memory f = loadFixture(SEPOLIA_FIXTURE);
        bool verified = abi.decode(
            _ethCall(
                BLOCK_PROVER,
                abi.encodeWithSelector(
                    bytes4(
                        keccak256(
                            "verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))"
                        )
                    ),
                    f.chainKey,
                    f.headerNumber,
                    f.txBytes,
                    merkleProofOf(f),
                    continuityProofOf(f)
                )
            ),
            (bool)
        );
        assertTrue(verified, "0x0FD2 verifies the sepolia fixture");
    }

    /// @notice Documents why these tests read the precompiles over RPC instead of calling them.
    /// @dev Creditcoin's natives have no EVM bytecode at all, so no Foundry EVM - forked or not -
    ///      can execute them. If a future Foundry ever does, this asserts the answers agree.
    function testFork_NativePrecompilesHaveNoEvmBytecode() public onlyFork {
        uint32 viaRpc = _attestorCount(3);
        (bool ok, bytes memory ret) =
            ATTESTOR_STASH.staticcall(abi.encodeWithSignature("getAttestorsCount(uint64)", uint64(3)));
        if (ok && ret.length == 32) {
            assertEq(abi.decode(ret, (uint32)), viaRpc, "direct and RPC answers agree");
        } else {
            console.log("0x0FD4 is unreachable from the local EVM, as expected");
            assertEq(ATTESTOR_STASH.code.length, 0, "native precompile carries no EVM bytecode");
            assertEq(CHAIN_INFO.code.length, 0, "native precompile carries no EVM bytecode");
            assertEq(BLOCK_PROVER.code.length, 0, "native precompile carries no EVM bytecode");
        }
    }

    /// @notice Full relay on the fork: real proof, real prover answer, real finality and quorum.
    function testFork_RelaysTheMainnetFixtureEndToEnd() public onlyFork {
        ProofFixture memory f = loadFixture(MAINNET_FIXTURE);

        // Real answers from the live precompiles.
        uint64 realTxIndex = f.txIndex;
        HeightHashResult memory attestation = _latestAttestation(f.chainKey);
        HeightHashResult memory checkpoint = _latestCheckpoint(f.chainKey);
        uint64 realTip = attestation.exists ? attestation.height : 0;
        if (checkpoint.exists && checkpoint.height > realTip) realTip = checkpoint.height;
        uint32 realAttestors = _attestorCount(f.chainKey);

        console.log("real attested tip:", vm.toString(realTip));
        console.log("real attestor count:", vm.toString(realAttestors));
        assertGe(realTip, f.headerNumber + FINALITY_DEPTH, "the fixture block is final on CC3");
        assertGe(realAttestors, MIN_ATTESTORS, "the quorum floor is met on CC3");

        // Pin the local EVM to those real answers, since the natives are unreachable from revm.
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        _stubChainInfo(f.chainKey, realTip);
        _stubAttestorStash(f.chainKey, realAttestors);

        AttestedWorldID relay =
            new AttestedWorldID(f.chainKey, MAINNET_IDENTITY_MANAGER, FINALITY_DEPTH, MIN_ATTESTORS);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(f.txBytes);
        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, TREE_CHANGED_TOPIC);
        uint256 preRoot = uint256(logs[0].topics[1]);
        uint256 postRoot = uint256(logs[0].topics[3]);

        vm.expectEmit(true, true, true, false, address(relay));
        emit IAttestedWorldID.RootRelayed(
            queryIdOf(f.chainKey, f.headerNumber, realTxIndex),
            f.headerNumber,
            postRoot,
            preRoot,
            0,
            0,
            realTxIndex,
            address(this)
        );

        relay.execute(
            0,
            f.chainKey,
            f.headerNumber,
            f.txBytes,
            f.merkleRoot,
            f.siblings,
            f.lowerEndpointDigest,
            f.continuityRoots
        );

        assertEq(relay.latestRoot(), postRoot, "latestRoot mirrors the real World ID root");
        assertTrue(relay.isValidRoot(preRoot), "preRoot bootstrapped");
        assertEq(relay.humansAddedTotal(), 100, "100 real humans");
    }

    /// @notice bn128 precompiles, which the Semaphore verifier needs, exist on CC3.
    function testFork_Bn128PrecompilesExist() public onlyFork {
        (bool okAdd,) = address(0x06).staticcall(new bytes(128));
        (bool okMul,) = address(0x07).staticcall(new bytes(96));
        (bool okPairing,) = address(0x08).staticcall(new bytes(0));
        assertTrue(okAdd && okMul && okPairing, "0x06/0x07/0x08 answer");
    }

    // -----------------------------------------------------------------------------------
    //                                        HELPERS
    // -----------------------------------------------------------------------------------

    function _ethCall(address to, bytes memory data) internal returns (bytes memory) {
        string memory params = string.concat(
            '[{"to":"', vm.toString(to), '","input":"', vm.toString(data), '"},"latest"]'
        );
        return vm.rpc(CC3_RPC_ALIAS, "eth_call", params);
    }

    function _latestAttestation(uint64 chainKey) internal returns (HeightHashResult memory) {
        return abi.decode(
            _ethCall(
                CHAIN_INFO, abi.encodeWithSignature("get_latest_attestation_height_and_hash(uint64)", chainKey)
            ),
            (HeightHashResult)
        );
    }

    function _latestCheckpoint(uint64 chainKey) internal returns (HeightHashResult memory) {
        return abi.decode(
            _ethCall(
                CHAIN_INFO, abi.encodeWithSignature("get_latest_checkpoint_height_and_hash(uint64)", chainKey)
            ),
            (HeightHashResult)
        );
    }

    function _attestorCount(uint64 chainKey) internal returns (uint32) {
        return abi.decode(
            _ethCall(ATTESTOR_STASH, abi.encodeWithSignature("getAttestorsCount(uint64)", chainKey)), (uint32)
        );
    }

    function _stubChainInfo(uint64 chainKey, uint64 tip) internal {
        vm.etch(CHAIN_INFO, address(new StubChainInfo()).code);
        vm.mockCall(
            CHAIN_INFO,
            abi.encodeWithSignature("get_latest_attestation_height_and_hash(uint64)", chainKey),
            abi.encode(HeightHashResult({height: tip, hash: bytes32(0), isAttestation: true, exists: true}))
        );
        vm.mockCall(
            CHAIN_INFO,
            abi.encodeWithSignature("get_latest_checkpoint_height_and_hash(uint64)", chainKey),
            abi.encode(HeightHashResult({height: tip, hash: bytes32(0), isAttestation: false, exists: true}))
        );
    }

    function _stubAttestorStash(uint64 chainKey, uint32 count) internal {
        vm.etch(ATTESTOR_STASH, address(new StubChainInfo()).code);
        vm.mockCall(
            ATTESTOR_STASH, abi.encodeWithSignature("getAttestorsCount(uint64)", chainKey), abi.encode(count)
        );
    }
}

/// @dev `vm.mockCall` needs the target to have code; these precompiles have none.
contract StubChainInfo {
    fallback() external payable {}
}
