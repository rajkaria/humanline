// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {SourceProof} from "../src/interfaces/ISourceProof.sol";

/// @notice Loader for the real Attestcoin proofs in `test/fixtures/`.
/// @dev These are verbatim `getProof` outputs from the Creditcoin CC3 proof builder for two real
///      World ID identity-manager transactions, and they verify true against the live `0x0FD2`
///      precompile. Nothing in them is synthesised.
abstract contract Fixtures is Test {
    struct ProofFixture {
        bytes32 txHash;
        uint64 chainKey;
        uint64 headerNumber;
        uint64 txIndex;
        bytes txBytes;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
    }

    string internal constant MAINNET_FIXTURE = "test/fixtures/mainnet-0x81ece311.json";
    string internal constant SEPOLIA_FIXTURE = "test/fixtures/sepolia-0x36678603.json";
    /// @notice Aave V3 Sepolia `Borrow` of 120 USDC by 0x2D39…8F01 (log 4), block 11607886.
    string internal constant AAVE_BORROW_FIXTURE = "test/fixtures/sepolia-aave-borrow-0xe4723adf.json";
    /// @notice The same wallet's `Repay` of 85.231495 USDC (log 6), block 11690827: 82,941 blocks later.
    string internal constant AAVE_REPAY_FIXTURE = "test/fixtures/sepolia-aave-repay-0xf3770ee1.json";
    /// @notice Circle Sepolia USDC `Transfer` of 0.01 USDC from 0x6dBe…A5d2 to 0x139b…764b (log 0).
    string internal constant USDC_TRANSFER_FIXTURE = "test/fixtures/sepolia-usdc-transfer-0x2e34a903.json";

    /// @notice Aave V3 Pool on Sepolia and its USDC / DAI / USDT reserves.
    address internal constant SEPOLIA_AAVE_POOL = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;
    address internal constant SEPOLIA_AAVE_USDC = 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8;
    address internal constant SEPOLIA_AAVE_DAI = 0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357;
    address internal constant SEPOLIA_AAVE_USDT = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0;
    /// @notice Circle's USDC on Sepolia.
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    /// @notice Ethereum mainnet Orb identity manager (chain key 3).
    address internal constant MAINNET_IDENTITY_MANAGER = 0xf7134CE138832c1456F2a91D64621eE90c2bddEa;
    /// @notice Ethereum Sepolia staging identity manager (chain key 1).
    address internal constant SEPOLIA_IDENTITY_MANAGER = 0xb2EaD588f14e69266d1b87936b75325181377076;

    bytes32 internal constant TREE_CHANGED_TOPIC =
        0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04;

    address internal constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;
    address internal constant CHAIN_INFO = 0x0000000000000000000000000000000000000fD3;
    address internal constant ATTESTOR_STASH = 0x0000000000000000000000000000000000000fd4;

    function loadFixture(string memory path) internal view returns (ProofFixture memory fixture) {
        string memory json = vm.readFile(path);
        fixture.txHash = vm.parseJsonBytes32(json, ".txHash");
        fixture.chainKey = uint64(vm.parseJsonUint(json, ".chainKey"));
        fixture.headerNumber = uint64(vm.parseJsonUint(json, ".headerNumber"));
        fixture.txIndex = uint64(vm.parseJsonUint(json, ".txIndex"));
        fixture.txBytes = vm.parseJsonBytes(json, ".txBytes");
        fixture.merkleRoot = vm.parseJsonBytes32(json, ".merkleProof.root");
        fixture.siblings = abi.decode(
            vm.parseJson(json, ".merkleProof.siblings"), (INativeQueryVerifier.MerkleProofEntry[])
        );
        fixture.lowerEndpointDigest = vm.parseJsonBytes32(json, ".continuityProof.lowerEndpointDigest");
        fixture.continuityRoots = vm.parseJsonBytes32Array(json, ".continuityProof.roots");
    }

    function merkleProofOf(ProofFixture memory fixture)
        internal
        pure
        returns (INativeQueryVerifier.MerkleProof memory)
    {
        return INativeQueryVerifier.MerkleProof({root: fixture.merkleRoot, siblings: fixture.siblings});
    }

    function continuityProofOf(ProofFixture memory fixture)
        internal
        pure
        returns (INativeQueryVerifier.ContinuityProof memory)
    {
        return INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: fixture.lowerEndpointDigest,
            roots: fixture.continuityRoots
        });
    }

    /// @notice The fixture as the `SourceProof` struct `ProvenSource` consumers take.
    function sourceProofOf(ProofFixture memory fixture) internal pure returns (SourceProof memory) {
        return sourceProofOf(fixture, fixture.txBytes);
    }

    /// @notice The fixture's proof around substituted transaction bytes (the mock verifier accepts it).
    function sourceProofOf(ProofFixture memory fixture, bytes memory txBytes) internal pure returns (SourceProof memory) {
        return SourceProof({
            chainKey: fixture.chainKey,
            blockHeight: fixture.headerNumber,
            encodedTransaction: txBytes,
            merkleProof: merkleProofOf(fixture),
            continuityProof: continuityProofOf(fixture)
        });
    }

    /// @notice `ASCBase`'s query id: keccak(chainKey, blockHeight << 192, txIndex).
    function queryIdOf(uint64 chainKey, uint64 blockHeight, uint256 txIndex) internal pure returns (bytes32 id) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            id := keccak256(ptr, 72)
        }
    }

    /// @notice Build a synthetic Merkle proof whose sibling flags encode `txIndex`.
    function syntheticMerkleProof(uint64 txIndex, uint8 depth)
        internal
        pure
        returns (INativeQueryVerifier.MerkleProof memory proof)
    {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](depth);
        for (uint256 i; i < depth; ++i) {
            siblings[i] = INativeQueryVerifier.MerkleProofEntry({
                hash: keccak256(abi.encode("sibling", txIndex, i)),
                isLeft: (txIndex >> i) & 1 == 1
            });
        }
        proof = INativeQueryVerifier.MerkleProof({
            root: keccak256(abi.encode("root", txIndex)),
            siblings: siblings
        });
    }
}
