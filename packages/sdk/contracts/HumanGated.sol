// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHumanRegistry} from "./IHumanRegistry.sol";

/// @title HumanGated
/// @notice Inherit this to make any function one-human-only on Creditcoin. Shipped in `@humanline/sdk`.
/// @dev A wallet counts as a human when Humanline's `HumanRegistry` binds it to a World ID nullifier,
///      proved on Creditcoin against a World ID root that reached the chain through Attestcoin.
///      Everything keys on the nullifier (`human`), never on the wallet, so a person who moves to a
///      new wallet keeps their history and cannot start over:
///
///          contract Airdrop is HumanGated {
///              constructor(address registry) HumanGated(registry) {}
///              function claim() external oncePerHuman("airdrop-1") { ... }
///          }
abstract contract HumanGated {
    /// @notice The registry that decides who is a human.
    IHumanRegistry public immutable HUMAN_REGISTRY;

    mapping(bytes32 scope => mapping(uint256 human => bool)) private _spent;

    error NotHuman(address wallet);
    error AlreadyUsed(bytes32 scope, uint256 human);
    error ZeroRegistry();

    constructor(address registry) {
        if (registry == address(0)) revert ZeroRegistry();
        HUMAN_REGISTRY = IHumanRegistry(registry);
    }

    /// @notice Only a wallet bound to a verified human may call.
    modifier onlyHuman() {
        _requireHuman(msg.sender);
        _;
    }

    /// @notice A verified human may call once per `scope`, from whichever wallet they hold today.
    modifier oncePerHuman(bytes32 scope) {
        uint256 human = _requireHuman(msg.sender);
        if (_spent[scope][human]) revert AlreadyUsed(scope, human);
        _spent[scope][human] = true;
        _;
    }

    /// @notice Whether `human` has already used `scope`.
    function usedBy(bytes32 scope, uint256 human) public view returns (bool) {
        return _spent[scope][human];
    }

    /// @dev The caller's nullifier, or a `NotHuman` revert.
    function _requireHuman(address wallet) internal view returns (uint256 human) {
        human = HUMAN_REGISTRY.humanOf(wallet);
        if (human == 0) revert NotHuman(wallet);
    }
}
