// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHumanRegistry} from "../interfaces/IHumanRegistry.sol";

/// @title HumanGate
/// @notice The whole integration pattern, in twenty lines: one claim per human, not per wallet.
/// @dev Copy this into any airdrop, faucet, vote or rate limiter. The only dependency is the
///      registry's `humanOf`, which returns 0 for a wallet that has never proved personhood.
contract HumanGate {
    IHumanRegistry public immutable REGISTRY;

    mapping(uint256 => bool) public claimed;

    error NotHuman(address wallet);
    error AlreadyClaimed(uint256 human);

    event Claimed(uint256 indexed human, address wallet);

    constructor(address registry) {
        REGISTRY = IHumanRegistry(registry);
    }

    function claim() external {
        uint256 human = REGISTRY.humanOf(msg.sender);
        if (human == 0) revert NotHuman(msg.sender);
        if (claimed[human]) revert AlreadyClaimed(human);
        claimed[human] = true;
        emit Claimed(human, msg.sender);
    }
}
