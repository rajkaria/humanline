# Deployments

Canonical record of every Humanline contract on Creditcoin CC3 testnet.
`cc3-testnet.json` is written by the deploy script and read by the worker and the web app; treat it
as generated output, not something to hand-edit.

## Shape

```jsonc
{
  "chainId": 102031,
  "profile": "prod",                    // or "demo" (ten-minute loan terms)
  "contracts": {
    "AttestedWorldIDMainnet": "0x…",    // chainKey 3, manager 0xf7134CE1…bddEa
    "AttestedWorldIDSepolia": "0x…",    // chainKey 1, manager 0xb2EaD588…7076
    "HUSD": "0x…",
    "HumanRegistry": "0x…",
    "CreditLine": "0x…",
    "HumanGate": "0x…",
    "RelayReward": "0x…"                // shared relayer vault, added by deploy-relay-reward.sh
  },
  "txHashes": { "…": "0x…" },           // deployment transaction per contract
  "config": {
    "worldIdSource": "sepolia",         // which relay HumanRegistry trusts
    "appId": "app_87b24915fcf733f10df1b0c46dd1f783",
    "action": "humanline-register",
    "termSeconds": 2592000,
    "graceSeconds": 604800,
    "initialLimit": 25000000,           // 25 hUSD, six decimals
    "maxLimit": 2000000000,             // 2,000 hUSD
    "feeBps": 100,                      // 1% per term
    "sourceBlockTime": 12               // seconds per source block; dates relayed roots
  },
  "deployedAt": 1760000000,
  "deployer": "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3"
}
```

## Deploying

```bash
cd contracts
PROFILE=demo script/deploy-cc3.sh     # or PROFILE=prod for 30-day terms
script/export-abi.sh                  # refresh contracts/abi/*.json
```

`deploy-cc3.sh` reads `PRIVATE_KEY` from `.secrets.env` at the repo root (git-ignored), deploys all
six contracts with `cast send --create`, and writes `deployments/cc3-testnet.json` including the
transaction hashes.

### Why `cast` and not `forge script`

`script/Deploy.s.sol` and `script/DeployDemo.s.sol` are the canonical, tested description of the
deployment — they run green against a local EVM and are what the unit tests exercise. They cannot
currently be pointed at CC3, because Foundry 1.5.1 refuses to build an EVM environment from a CC3
RPC:

```
Error: Failed to deploy script: EVM error; header validation error: `prevrandao` not set
```

CC3 is a Substrate/Frontier chain whose `eth_getBlockByNumber` result has no `mixHash` field, so
revm cannot populate `block.prevrandao` and rejects the environment before the script body runs.
`--block-prevrandao` does not override it and `--skip-simulation` does not avoid it, and the same
error blocks `forge test --fork-url` (which is why the fork tests talk to the node over
`vm.rpc("cc3", …)` instead). `cast` never builds a local EVM — it signs and posts — so it works.

If a later Foundry fixes this, the forge-script path becomes:

```bash
cd contracts
forge script script/DeployDemo.s.sol:DeployDemo --rpc-url cc3 --broadcast
script/record-deployment.sh DeployDemo.s.sol 102031   # fills in txHashes
```

## Network

| | |
|---|---|
| Chain | Creditcoin CC3 testnet |
| Chain id | 102031 |
| RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fD3` |
| AttestorStash precompile | `0x0000000000000000000000000000000000000fd4` |

Live values read from those precompiles on 2026-09-12: Ethereum mainnet (chain key 3) attested tip
25,959,960 with 4 bonded attestors; Sepolia (chain key 1) with 7 bonded attestors.

## After deploying

1. Bootstrap each relay with the first root (`humanline bootstrap` in `worker/`).
2. Seed the lender pool: call `HUSD.faucet()` from a few wallets and `CreditLine.deposit`.
3. Point the web app at `deployments/cc3-testnet.json`.
