// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockNativeQueryVerifier} from "../mocks/MockNativeQueryVerifier.sol";
import {MockWorldID} from "../mocks/MockWorldID.sol";
import {HumanLinksHarness} from "../harness/CrossChainHarness.sol";
import {HumanRegistry} from "../../src/HumanRegistry.sol";

/// @notice Random humans try to link random wallets (whose owners always cooperate) by signature.
contract HumanLinksHandler is Test {
    HumanLinksHarness public links;
    HumanRegistry public registry;

    address[3] public humanWallets;
    uint256[3] public humans;
    uint256[12] public walletKeys;

    mapping(address wallet => uint256 human) public ghostOwner;
    uint256 public linked;
    uint256 public refused;
    uint256 public overwrites;

    constructor(HumanLinksHarness links_, HumanRegistry registry_) {
        links = links_;
        registry = registry_;
        uint256[8] memory proof;
        for (uint256 i; i < 3; ++i) {
            humans[i] = uint256(keccak256(abi.encode("links-human", i)));
            humanWallets[i] = makeAddr(string.concat("cc-wallet", vm.toString(i)));
            vm.prank(humanWallets[i]);
            registry.register(1, humans[i], proof);
        }
        for (uint256 i; i < 12; ++i) {
            walletKeys[i] = uint256(keccak256(abi.encode("eth-wallet", i))) % (2 ** 250) + 1;
        }
    }

    function link(uint256 humanSeed, uint256 walletSeed) external {
        uint256 h = humanSeed % 3;
        uint256 key = walletKeys[walletSeed % 12];
        address wallet = vm.addr(key);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, links.linkDigest(humans[h], humanWallets[h], wallet, deadline));

        vm.prank(humanWallets[h]);
        try links.linkBySignature(wallet, deadline, abi.encodePacked(r, s, v)) {
            if (ghostOwner[wallet] != 0) overwrites++;
            ghostOwner[wallet] = humans[h];
            linked++;
        } catch {
            refused++;
        }
    }

    function walletAt(uint256 i) external view returns (address) {
        return vm.addr(walletKeys[i]);
    }

    function humanAt(uint256 i) external view returns (uint256) {
        return humans[i];
    }
}

/// @notice A wallet belongs to exactly one human, forever, and every link list is consistent.
contract HumanLinksInvariantTest is Test {
    HumanLinksHandler internal handler;
    HumanLinksHarness internal links;

    function setUp() public {
        vm.etch(0x0000000000000000000000000000000000000FD2, address(new MockNativeQueryVerifier()).code);
        HumanRegistry registry = new HumanRegistry(address(new MockWorldID()), "app_x", "act");
        uint64[] memory keys = new uint64[](1);
        uint64[] memory ids = new uint64[](1);
        keys[0] = 1;
        ids[0] = 11_155_111;
        links = new HumanLinksHarness(address(registry), keys, ids);
        handler = new HumanLinksHandler(links, registry);
        targetContract(address(handler));
    }

    function invariant_AWalletNeverChangesHuman() public view {
        assertEq(handler.overwrites(), 0);
        for (uint256 i; i < 12; ++i) {
            address wallet = handler.walletAt(i);
            assertEq(links.humanOfWallet(wallet), handler.ghostOwner(wallet));
        }
    }

    function invariant_LinkListsAreConsistentAndBounded() public view {
        uint256 total;
        for (uint256 h; h < 3; ++h) {
            uint256 human = handler.humanAt(h);
            address[] memory wallets = links.linksOf(human);
            assertLe(wallets.length, links.MAX_LINKS());
            assertEq(wallets.length, links.linkCount(human));
            for (uint256 i; i < wallets.length; ++i) {
                assertEq(links.humanOfWallet(wallets[i]), human, "every listed wallet maps back");
            }
            total += wallets.length;
        }
        assertEq(total, handler.linked());
    }

    function afterInvariant() public view {
        assertGt(handler.linked(), 0, "wallets were linked");
    }
}
