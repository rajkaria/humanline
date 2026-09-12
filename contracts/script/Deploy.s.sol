// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {AttestedWorldID} from "../src/AttestedWorldID.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {HUSD} from "../src/HUSD.sol";
import {HumanRegistry} from "../src/HumanRegistry.sol";
import {HumanGate} from "../src/examples/HumanGate.sol";

/// @notice Deploys the whole Humanline stack to Creditcoin CC3 testnet and records the addresses.
///
///     forge script script/Deploy.s.sol:Deploy --rpc-url cc3 --broadcast
///
/// Environment (all optional, production defaults shown):
///   PRIVATE_KEY       deployer key; falls back to forge's `--account` / `--private-key`
///   WORLD_ID_SOURCE   "sepolia" (default) or "mainnet" - which relay the registry trusts
///   WORLD_APP_ID      app_87b24915fcf733f10df1b0c46dd1f783
///   WORLD_ACTION      humanline-register
///   TERM_SECONDS      2592000 (30 days)
///   GRACE_SECONDS     604800 (7 days)
///   DEPLOYMENT_OUT    ../deployments/cc3-testnet.json
///
/// @dev `TERM_SECONDS` / `GRACE_SECONDS` rather than `TERM` / `GRACE`: `TERM` is a standard shell
///      variable (`xterm-256color`), and `vm.envOr(..., uint256)` would try to parse it.
contract Deploy is Script {
    /// @notice Ethereum mainnet: Worldcoin's Orb identity manager, Creditcoin chain key 3.
    uint64 internal constant MAINNET_CHAIN_KEY = 3;
    address internal constant MAINNET_IDENTITY_MANAGER = 0xf7134CE138832c1456F2a91D64621eE90c2bddEa;
    /// @notice Ethereum Sepolia: the staging tree the World simulator writes to, chain key 1.
    uint64 internal constant SEPOLIA_CHAIN_KEY = 1;
    address internal constant SEPOLIA_IDENTITY_MANAGER = 0xb2EaD588f14e69266d1b87936b75325181377076;

    uint64 internal constant FINALITY_DEPTH = 32;
    uint32 internal constant MIN_ATTESTORS = 3;
    /// @notice Average seconds per block on both Ethereum chains; used to date relayed roots.
    uint64 internal constant SOURCE_BLOCK_TIME = 12;

    string internal constant DEFAULT_APP_ID = "app_87b24915fcf733f10df1b0c46dd1f783";
    string internal constant DEFAULT_ACTION = "humanline-register";

    uint256 internal constant INITIAL_LIMIT = 25e6;
    uint256 internal constant MAX_LIMIT = 2000e6;
    uint256 internal constant FEE_BPS = 100;

    uint64 internal constant PROD_TERM = 30 days;
    uint64 internal constant PROD_GRACE = 7 days;

    struct Deployment {
        address attestedWorldIDMainnet;
        address attestedWorldIDSepolia;
        address husd;
        address humanRegistry;
        address creditLine;
        address humanGate;
    }

    function run() external virtual returns (Deployment memory) {
        return _deploy(
            uint64(vm.envOr("TERM_SECONDS", uint256(PROD_TERM))),
            uint64(vm.envOr("GRACE_SECONDS", uint256(PROD_GRACE))),
            "prod"
        );
    }

    function _deploy(uint64 term, uint64 grace, string memory profile)
        internal
        returns (Deployment memory out)
    {
        string memory source = vm.envOr("WORLD_ID_SOURCE", string("sepolia"));
        string memory appId = vm.envOr("WORLD_APP_ID", string(DEFAULT_APP_ID));
        string memory action = vm.envOr("WORLD_ACTION", string(DEFAULT_ACTION));

        bool useMainnet = keccak256(bytes(source)) == keccak256(bytes("mainnet"));

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer;
        if (pk != 0) {
            deployer = vm.addr(pk);
            vm.startBroadcast(pk);
        } else {
            deployer = msg.sender;
            vm.startBroadcast();
        }

        AttestedWorldID mainnetRelay =
            new AttestedWorldID(
            MAINNET_CHAIN_KEY, MAINNET_IDENTITY_MANAGER, FINALITY_DEPTH, MIN_ATTESTORS, SOURCE_BLOCK_TIME
        );
        AttestedWorldID sepoliaRelay =
            new AttestedWorldID(
            SEPOLIA_CHAIN_KEY, SEPOLIA_IDENTITY_MANAGER, FINALITY_DEPTH, MIN_ATTESTORS, SOURCE_BLOCK_TIME
        );

        HUSD husd = new HUSD();
        HumanRegistry registry =
            new HumanRegistry(address(useMainnet ? mainnetRelay : sepoliaRelay), appId, action);
        CreditLine creditLine = new CreditLine(
            address(husd), address(registry), INITIAL_LIMIT, MAX_LIMIT, FEE_BPS, term, grace
        );
        HumanGate gate = new HumanGate(address(registry));

        vm.stopBroadcast();

        out = Deployment({
            attestedWorldIDMainnet: address(mainnetRelay),
            attestedWorldIDSepolia: address(sepoliaRelay),
            husd: address(husd),
            humanRegistry: address(registry),
            creditLine: address(creditLine),
            humanGate: address(gate)
        });

        _record(out, deployer, profile, source, appId, action, term, grace);
        _log(out, profile, source, term, grace, registry.EXTERNAL_NULLIFIER_HASH());
    }

    function _record(
        Deployment memory d,
        address deployer,
        string memory profile,
        string memory source,
        string memory appId,
        string memory action,
        uint64 term,
        uint64 grace
    ) internal {
        string memory contractsKey = "humanline.contracts";
        vm.serializeAddress(contractsKey, "AttestedWorldIDMainnet", d.attestedWorldIDMainnet);
        vm.serializeAddress(contractsKey, "AttestedWorldIDSepolia", d.attestedWorldIDSepolia);
        vm.serializeAddress(contractsKey, "HUSD", d.husd);
        vm.serializeAddress(contractsKey, "HumanRegistry", d.humanRegistry);
        vm.serializeAddress(contractsKey, "CreditLine", d.creditLine);
        string memory contractsJson = vm.serializeAddress(contractsKey, "HumanGate", d.humanGate);

        // Transaction hashes are not observable from inside a script; `script/record-deployment.sh`
        // fills these in from `broadcast/<script>/<chainId>/run-latest.json` after `--broadcast`.
        string memory txKey = "humanline.txHashes";
        vm.serializeString(txKey, "AttestedWorldIDMainnet", "");
        vm.serializeString(txKey, "AttestedWorldIDSepolia", "");
        vm.serializeString(txKey, "HUSD", "");
        vm.serializeString(txKey, "HumanRegistry", "");
        vm.serializeString(txKey, "CreditLine", "");
        string memory txJson = vm.serializeString(txKey, "HumanGate", "");

        string memory configKey = "humanline.config";
        vm.serializeString(configKey, "worldIdSource", source);
        vm.serializeString(configKey, "appId", appId);
        vm.serializeString(configKey, "action", action);
        vm.serializeUint(configKey, "termSeconds", term);
        vm.serializeUint(configKey, "graceSeconds", grace);
        vm.serializeUint(configKey, "sourceBlockTime", SOURCE_BLOCK_TIME);
        vm.serializeUint(configKey, "initialLimit", INITIAL_LIMIT);
        vm.serializeUint(configKey, "maxLimit", MAX_LIMIT);
        string memory configJson = vm.serializeUint(configKey, "feeBps", FEE_BPS);

        string memory rootKey = "humanline";
        vm.serializeUint(rootKey, "chainId", block.chainid);
        vm.serializeString(rootKey, "profile", profile);
        vm.serializeString(rootKey, "contracts", contractsJson);
        vm.serializeString(rootKey, "txHashes", txJson);
        vm.serializeString(rootKey, "config", configJson);
        vm.serializeUint(rootKey, "deployedAt", block.timestamp);
        string memory json = vm.serializeAddress(rootKey, "deployer", deployer);

        vm.writeJson(json, vm.envOr("DEPLOYMENT_OUT", string("../deployments/cc3-testnet.json")));
    }

    function _log(
        Deployment memory d,
        string memory profile,
        string memory source,
        uint64 term,
        uint64 grace,
        uint256 externalNullifier
    ) internal pure {
        console.log("Humanline deployed (%s profile, World ID source: %s)", profile, source);
        console.log("  AttestedWorldID (mainnet, chainKey 3):", d.attestedWorldIDMainnet);
        console.log("  AttestedWorldID (sepolia, chainKey 1):", d.attestedWorldIDSepolia);
        console.log("  HUSD                                 :", d.husd);
        console.log("  HumanRegistry                        :", d.humanRegistry);
        console.log("  CreditLine                           :", d.creditLine);
        console.log("  HumanGate                            :", d.humanGate);
        console.log("  externalNullifierHash                :", externalNullifier);
        console.log("  term / grace (seconds)               : %s / %s", term, grace);
    }
}
