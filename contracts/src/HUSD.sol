// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title hUSD
/// @notice The Humanline test stablecoin: six decimals, so on-chain amounts read like dollars.
/// @dev Testnet only, and deliberately ownerless - the faucet is the only way tokens come into
///      existence, and it is rate limited per address rather than per human, because a faucet that
///      needed personhood would be circular.
contract HUSD is ERC20 {
    /// @notice Tokens handed out per faucet call: 100 hUSD.
    uint256 public constant FAUCET_AMOUNT = 100e6;
    /// @notice Minimum wait between faucet calls from one address.
    uint64 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice Last time each address used the faucet.
    mapping(address => uint64) public lastFaucetAt;

    /// @notice The faucet is still cooling down for this address.
    error FaucetCooldown(uint64 until);

    event Faucet(address indexed to, uint256 amount);

    constructor() ERC20("Humanline USD", "hUSD") {}

    /// @notice Six decimals, like USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint 100 hUSD to the caller, at most once every 24 hours.
    function faucet() external {
        uint64 last = lastFaucetAt[msg.sender];
        if (last != 0) {
            uint64 until = last + FAUCET_COOLDOWN;
            if (block.timestamp < until) revert FaucetCooldown(until);
        }
        lastFaucetAt[msg.sender] = uint64(block.timestamp);
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice When the caller may next use the faucet (0 = now).
    function faucetAvailableAt(address account) external view returns (uint64) {
        uint64 last = lastFaucetAt[account];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }
}
