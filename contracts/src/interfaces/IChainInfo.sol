// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One source chain tracked by the Creditcoin attestation set.
struct ChainInfo {
    uint64 chainKey;
    uint64 chainId;
    bytes chainName;
    uint8 chainEncoding;
}

/// @notice `ChainInfo` plus a presence flag (precompiles never revert on "not found").
struct ChainInfoResult {
    ChainInfo info;
    bool exists;
}

/// @notice A height plus a presence flag.
struct HeightResult {
    uint64 height;
    bool exists;
}

/// @notice A height, its agreed-upon digest, and whether it came from an attestation
///         (`true`) or from a checkpoint (`false`).
struct HeightHashResult {
    uint64 height;
    bytes32 hash;
    bool isAttestation;
    bool exists;
}

/// @title IChainInfo
/// @notice Minimal, independently written interface for the Creditcoin ChainInfo precompile at
///         `0x0000000000000000000000000000000000000fD3`. Only the getters Humanline needs are
///         declared; the full precompile exposes more.
/// @dev Selectors confirmed against `precompiles/metadata/sol/chain_info.sol` in gluwa/creditcoin3:
///        get_supported_chains()                             -> 0x69e18c3c
///        get_chain_by_key(uint64)                           -> 0x2d256bfa
///        get_latest_attestation_height_and_hash(uint64)     -> 0x809112da
///        get_latest_checkpoint_height_and_hash(uint64)      -> 0xd773a786
///        is_height_attested(uint64,uint64)                  -> 0x9c68eccf
interface IChainInfo {
    /// @notice Every chain the attestation set currently tracks.
    function get_supported_chains() external view returns (ChainInfo[] memory chains);

    /// @notice Look up a single tracked chain by its Creditcoin chain key.
    function get_chain_by_key(uint64 chainKey) external view returns (ChainInfoResult memory result);

    /// @notice Highest source-chain height the attestors have attested to.
    /// @dev This is the "attested tip" Humanline's finality guard reads.
    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);

    /// @notice Highest source-chain height covered by a checkpoint.
    function get_latest_checkpoint_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);

    /// @notice Whether `targetHeight` can be proven via the continuity chain.
    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool isAttested);
}

/// @notice Canonical address of the ChainInfo precompile on Creditcoin 3.
library ChainInfoLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

    function get() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE);
    }
}
