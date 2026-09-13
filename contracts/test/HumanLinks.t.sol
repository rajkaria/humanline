// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {Fixtures} from "./Fixtures.sol";
import {MockNativeQueryVerifier, RejectingNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {MockWorldID} from "./mocks/MockWorldID.sol";
import {TxBytes} from "./harness/TxBytes.sol";
import {HumanLinksHarness} from "./harness/CrossChainHarness.sol";

import {HumanRegistry} from "../src/HumanRegistry.sol";
import {HumanLinks} from "../src/HumanLinks.sol";
import {ProvenSource} from "../src/ProvenSource.sol";
import {IHumanLinks} from "../src/interfaces/IHumanLinks.sol";
import {SourceProof} from "../src/interfaces/ISourceProof.sol";

/// @notice `HumanLinks` against a real Sepolia type-2 transaction whose sender, callee and calldata are
///         rewritten into a link intent. Everything the proof carries besides those three fields -
///         the signature chunk with chain id 11155111, the receipt, the Merkle and continuity proof -
///         is the real prover output.
contract HumanLinksTest is Fixtures {
    using TxBytes for bytes;

    HumanLinksHarness internal links;
    HumanRegistry internal registry;
    ProofFixture internal f;

    uint256 internal constant ALICE_HUMAN = uint256(keccak256("alice-nullifier"));
    uint256 internal constant BOB_HUMAN = uint256(keccak256("bob-nullifier"));
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal walletKey = 0xA11CE5EED;
    address internal wallet;

    function setUp() public {
        vm.etch(BLOCK_PROVER, address(new MockNativeQueryVerifier()).code);
        registry = new HumanRegistry(address(new MockWorldID()), "app_87b24915fcf733f10df1b0c46dd1f783", "humanline-register");
        links = new HumanLinksHarness(address(registry), _keys(), _ids());
        f = loadFixture(USDC_TRANSFER_FIXTURE);
        wallet = vm.addr(walletKey);

        uint256[8] memory proof;
        vm.prank(alice);
        registry.register(1, ALICE_HUMAN, proof);
        vm.prank(bob);
        registry.register(1, BOB_HUMAN, proof);
    }

    // ------------------------------------------------------------------ source-tx links

    function test_LinksTheSenderOfAProvedSelfSend() public {
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        bytes32 queryId = queryIdOf(1, f.headerNumber, f.txIndex);

        vm.expectEmit(true, true, false, true, address(links));
        emit IHumanLinks.WalletLinked(ALICE_HUMAN, wallet, IHumanLinks.Method.SourceTx, 1, f.headerNumber, queryId);
        vm.prank(alice);
        links.linkBySourceTx(p);

        assertEq(links.humanOfWallet(wallet), ALICE_HUMAN);
        IHumanLinks.Link memory link = links.linkOf(wallet);
        assertEq(uint8(link.method), uint8(IHumanLinks.Method.SourceTx));
        assertEq(link.chainKey, 1);
        assertEq(link.blockHeight, f.headerNumber);
        assertEq(link.linkedAt, block.timestamp);
        assertEq(links.linkCount(ALICE_HUMAN), 1);
        assertEq(links.linksOf(ALICE_HUMAN)[0], wallet);
        assertTrue(links.consumed(queryId), "the query id is spent");
    }

    function test_TheSameProofCannotLinkTwice() public {
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        vm.prank(alice);
        links.linkBySourceTx(p);

        vm.expectRevert(abi.encodeWithSelector(ProvenSource.AlreadyConsumed.selector, queryIdOf(1, f.headerNumber, f.txIndex)));
        vm.prank(alice);
        links.linkBySourceTx(p);
    }

    function test_RefusesACallToAnotherAddress() public {
        bytes memory tx_ = f.txBytes.withCommon(wallet, SEPOLIA_USDC, links.linkIntent(ALICE_HUMAN, alice));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.NotSelfSend.selector, wallet, SEPOLIA_USDC));
        vm.prank(alice);
        links.linkBySourceTx(sourceProofOf(f, tx_));
    }

    function test_RefusesTheUnmodifiedUsdcTransfer() public {
        // Real transaction, real proof: an ERC-20 transfer is not a link.
        (,,,, address to,,) = TxBytes.common(f.txBytes);
        (,, address from,,,,) = TxBytes.common(f.txBytes);
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.NotSelfSend.selector, from, to));
        vm.prank(alice);
        links.linkBySourceTx(sourceProofOf(f));
    }

    function test_RefusesCalldataThatIsNotALinkIntent() public {
        bytes memory good = links.linkIntent(ALICE_HUMAN, alice);

        bytes memory wrongMarker = bytes.concat(bytes4(0xdeadbeef), _tail(good));
        vm.expectRevert(IHumanLinks.NotALinkIntent.selector);
        vm.prank(alice);
        links.linkBySourceTx(_linkProof(wallet, wrongMarker));

        bytes memory tooLong = bytes.concat(good, bytes1(0x00));
        vm.expectRevert(IHumanLinks.NotALinkIntent.selector);
        vm.prank(alice);
        links.linkBySourceTx(_linkProof(wallet, tooLong));

        bytes memory dirty = abi.encodePacked(
            links.LINK_MARKER(), abi.encode(ALICE_HUMAN, uint256(uint160(alice)) | (1 << 200), block.chainid, address(links))
        );
        vm.expectRevert(IHumanLinks.NotALinkIntent.selector);
        vm.prank(alice);
        links.linkBySourceTx(_linkProof(wallet, dirty));
    }

    function test_RefusesAnIntentForAnotherChainOrDeployment() public {
        bytes memory otherChain = abi.encodePacked(links.LINK_MARKER(), abi.encode(ALICE_HUMAN, alice, uint256(102030), address(links)));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.WrongLinkTarget.selector, 102030, address(links)));
        vm.prank(alice);
        links.linkBySourceTx(_linkProof(wallet, otherChain));

        address elsewhere = makeAddr("another HumanLinks");
        bytes memory otherTarget = abi.encodePacked(links.LINK_MARKER(), abi.encode(ALICE_HUMAN, alice, block.chainid, elsewhere));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.WrongLinkTarget.selector, block.chainid, elsewhere));
        vm.prank(alice);
        links.linkBySourceTx(_linkProof(wallet, otherTarget));
    }

    function test_OnlyTheNamedCreditcoinWalletCanSubmit() public {
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.IntentForAnotherWallet.selector, alice, bob));
        vm.prank(bob);
        links.linkBySourceTx(p);
    }

    function test_TheNamedWalletMustBeTheNamedHuman() public {
        // Alice names Bob's nullifier: she cannot attach a wallet to someone else's identity.
        SourceProof memory p = _linkProof(wallet, links.linkIntent(BOB_HUMAN, alice));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.IntentForAnotherHuman.selector, BOB_HUMAN, ALICE_HUMAN));
        vm.prank(alice);
        links.linkBySourceTx(p);

        address stranger = makeAddr("stranger");
        SourceProof memory q = _linkProof(makeAddr("w2"), links.linkIntent(ALICE_HUMAN, stranger));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.NotHuman.selector, stranger));
        vm.prank(stranger);
        links.linkBySourceTx(q);
    }

    function test_RefusesARevertedTransaction() public {
        bytes memory tx_ = f.txBytes.withCommon(wallet, wallet, links.linkIntent(ALICE_HUMAN, alice)).withStatus(0);
        vm.expectRevert(ProvenSource.SourceTxReverted.selector);
        vm.prank(alice);
        links.linkBySourceTx(sourceProofOf(f, tx_));
    }

    function test_RefusesATransactionSignedForAnotherChain() public {
        bytes memory tx_ =
            f.txBytes.withCommon(wallet, wallet, links.linkIntent(ALICE_HUMAN, alice)).withType2ChainId(1);
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.WrongTxChainId.selector, 1, 11_155_111));
        vm.prank(alice);
        links.linkBySourceTx(sourceProofOf(f, tx_));
    }

    function test_RefusesAnUnconfiguredChainKey() public {
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        p.chainKey = 8;
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.UnsupportedSourceChain.selector, 8));
        vm.prank(alice);
        links.linkBySourceTx(p);
    }

    function test_RefusesAProofThePrecompileRejects() public {
        vm.etch(BLOCK_PROVER, address(new RejectingNativeQueryVerifier()).code);
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        vm.expectRevert(ProvenSource.ProofRejected.selector);
        vm.prank(alice);
        links.linkBySourceTx(p);
    }

    function test_RefusesAnUnfinalBlockAndAThinQuorum() public {
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));

        links.setTip(f.headerNumber + 31);
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.NotFinal.selector, f.headerNumber + 31, f.headerNumber));
        vm.prank(alice);
        links.linkBySourceTx(p);

        links.setTip(f.headerNumber + 32);
        links.setAttestors(2);
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.ThinQuorum.selector, 2, 3));
        vm.prank(alice);
        links.linkBySourceTx(p);

        links.setAttestors(3);
        vm.prank(alice);
        links.linkBySourceTx(p);
        assertEq(links.humanOfWallet(wallet), ALICE_HUMAN, "exactly at the bounds it links");
    }

    // ------------------------------------------------------------------ signature links

    function test_LinksByEip712Signature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletKey, links.linkDigest(ALICE_HUMAN, alice, wallet, deadline));

        vm.expectEmit(true, true, false, true, address(links));
        emit IHumanLinks.WalletLinked(ALICE_HUMAN, wallet, IHumanLinks.Method.Signature, 0, 0, bytes32(0));
        vm.prank(alice);
        links.linkBySignature(wallet, deadline, sig);

        assertEq(links.humanOfWallet(wallet), ALICE_HUMAN);
        assertEq(uint8(links.linkOf(wallet).method), uint8(IHumanLinks.Method.Signature));
    }

    function test_ASignatureIsBoundToTheHumanWhoseWalletSubmits() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletKey, links.linkDigest(ALICE_HUMAN, alice, wallet, deadline));

        // Bob lifts Alice's signature from the mempool: the digest he needs names him, not her.
        address recovered = _recover(links.linkDigest(BOB_HUMAN, bob, wallet, deadline), sig);
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.BadSignature.selector, recovered, wallet));
        vm.prank(bob);
        links.linkBySignature(wallet, deadline, sig);
    }

    function test_RefusesAnExpiredOrForeignSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(walletKey, links.linkDigest(ALICE_HUMAN, alice, wallet, deadline));

        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.SignatureExpired.selector, deadline));
        vm.prank(alice);
        links.linkBySignature(wallet, deadline, sig);

        vm.warp(deadline);
        address other = makeAddr("not the signer");
        address recovered = _recover(links.linkDigest(ALICE_HUMAN, alice, other, deadline), sig);
        assertTrue(recovered != other);
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.BadSignature.selector, recovered, other));
        vm.prank(alice);
        links.linkBySignature(other, deadline, sig);
    }

    function test_AWalletBelongsToOneHumanForever() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory aliceSig = _sign(walletKey, links.linkDigest(ALICE_HUMAN, alice, wallet, deadline));
        vm.prank(alice);
        links.linkBySignature(wallet, deadline, aliceSig);

        // The wallet's owner cooperates with Bob; it still cannot count twice.
        bytes memory bobSig = _sign(walletKey, links.linkDigest(BOB_HUMAN, bob, wallet, deadline));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.WalletAlreadyLinked.selector, wallet, ALICE_HUMAN));
        vm.prank(bob);
        links.linkBySignature(wallet, deadline, bobSig);

        // Nor can the same human link it again through a proof.
        SourceProof memory p = _linkProof(wallet, links.linkIntent(ALICE_HUMAN, alice));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.WalletAlreadyLinked.selector, wallet, ALICE_HUMAN));
        vm.prank(alice);
        links.linkBySourceTx(p);
    }

    function test_AHumanHoldsAtMostMaxLinks() public {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 max = links.MAX_LINKS();
        for (uint256 i; i < max; ++i) {
            uint256 key = 1000 + i;
            address w = vm.addr(key);
            bytes memory sig = _sign(key, links.linkDigest(ALICE_HUMAN, alice, w, deadline));
            vm.prank(alice);
            links.linkBySignature(w, deadline, sig);
        }
        address extra = vm.addr(5000);
        bytes memory sig = _sign(5000, links.linkDigest(ALICE_HUMAN, alice, extra, deadline));
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.TooManyLinks.selector, ALICE_HUMAN));
        vm.prank(alice);
        links.linkBySignature(extra, deadline, sig);
    }

    function test_SignatureLinkNeedsARegisteredCaller() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(IHumanLinks.NotHuman.selector, stranger));
        vm.prank(stranger);
        links.linkBySignature(wallet, block.timestamp, "");
    }

    // ------------------------------------------------------------------ construction and decoding

    function test_ConstructorChecksChainInfo() public {
        uint64[] memory keys = new uint64[](1);
        uint64[] memory ids = new uint64[](1);
        keys[0] = 1;
        ids[0] = 1; // chainKey 1 is Sepolia, not Ethereum
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.WrongSourceChain.selector, 1, 11_155_111, 1));
        new HumanLinksHarness(address(registry), keys, ids);

        keys[0] = 424_242;
        vm.expectRevert(abi.encodeWithSelector(ProvenSource.WrongSourceChain.selector, 424_242, 0, 1));
        new HumanLinksHarness(address(registry), keys, ids);

        vm.expectRevert(ProvenSource.BadSourceConfig.selector);
        new HumanLinksHarness(address(registry), new uint64[](2), new uint64[](1));

        assertEq(links.chainIdOf(1), 11_155_111);
        assertEq(links.chainIdOf(3), 1);
        assertEq(links.chainIdOf(8), 0);
    }

    function test_TxChainIdReadsBothRealFixtures() public view {
        assertEq(links.txChainId(f.txBytes), 11_155_111, "Sepolia USDC transfer");
        assertEq(links.txChainId(loadFixture(AAVE_REPAY_FIXTURE).txBytes), 11_155_111, "Sepolia Aave repay");
        ProofFixture memory mainnet = loadFixture(MAINNET_FIXTURE);
        (uint8 txType,) = TxBytes.split(mainnet.txBytes);
        if (txType == 2) assertEq(links.txChainId(mainnet.txBytes), 1, "Ethereum World ID update");
    }

    function test_TxChainIdHandlesLegacyAndOtherTypedTransactions() public view {
        bytes memory receipt = abi.encode(uint8(1), uint64(21_000), new EvmV1Decoder.LogEntryTuple[](0), new bytes(256));
        bytes memory common = abi.encode(uint64(0), uint64(21_000), wallet, false, wallet, uint256(0), bytes(""));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = common;
        chunks[2] = receipt;

        chunks[1] = abi.encode(uint128(1), uint256(11_155_111 * 2 + 35), bytes32(0), bytes32(0));
        assertEq(links.txChainId(abi.encode(uint8(0), chunks)), 11_155_111, "EIP-155 legacy");

        chunks[1] = abi.encode(uint64(1), uint128(1), new EvmV1Decoder.AccessListEntryBytes32[](0), uint8(0), bytes32(0), bytes32(0));
        assertEq(links.txChainId(abi.encode(uint8(1), chunks)), 1, "EIP-2930");
    }

    function test_TxChainIdRefusesUnprotectedLegacy() public {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(21_000), wallet, false, wallet, uint256(0), bytes(""));
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(uint8(1), uint64(21_000), new EvmV1Decoder.LogEntryTuple[](0), new bytes(256));
        vm.expectRevert(ProvenSource.UnprotectedLegacyTx.selector);
        links.txChainId(abi.encode(uint8(0), chunks));
    }

    function testFuzz_OnlyTheExactIntentLinks(uint256 human, address ccWallet) public {
        vm.assume(human != ALICE_HUMAN && ccWallet != alice);
        SourceProof memory p = _linkProof(wallet, links.linkIntent(human, ccWallet));
        vm.prank(alice);
        vm.expectRevert();
        links.linkBySourceTx(p);
        assertEq(links.humanOfWallet(wallet), 0);
    }

    // ------------------------------------------------------------------ helpers

    function _linkProof(address from, bytes memory data) internal view returns (SourceProof memory) {
        return sourceProofOf(f, f.txBytes.withCommon(from, from, data));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        (bytes32 r, bytes32 s) = abi.decode(sig, (bytes32, bytes32));
        return ecrecover(digest, uint8(sig[64]), r, s);
    }

    function _tail(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }

    function _keys() internal pure returns (uint64[] memory keys) {
        keys = new uint64[](2);
        keys[0] = 1;
        keys[1] = 3;
    }

    function _ids() internal pure returns (uint64[] memory ids) {
        ids = new uint64[](2);
        ids[0] = 11_155_111;
        ids[1] = 1;
    }
}
