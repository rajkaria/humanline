#!/usr/bin/env bash
# Verify a deployment's contracts on Creditcoin CC3 Blockscout.
#
#   contracts/script/verify-blockscout.sh                         # verifies deployments/cc3-testnet.json
#   DEPLOYMENT=deployments/cc3-testnet.production.json contracts/script/verify-blockscout.sh
#   ONLY="HumanRegistry CreditLine" contracts/script/verify-blockscout.sh
#
# Constructor arguments are re-encoded from the deployment file's own `config`
# block, so the script can never drift from what was actually deployed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
FORGE="${FORGE:-$ROOT_DIR/.tools/forge}"
CAST="${CAST:-$ROOT_DIR/.tools/cast}"
VERIFIER_URL="${VERIFIER_URL:-https://creditcoin-testnet.blockscout.com/api}"
DEPLOYMENT="${DEPLOYMENT:-$ROOT_DIR/deployments/cc3-testnet.json}"
ONLY="${ONLY:-AttestedWorldIDMainnet AttestedWorldIDSepolia HUSD HumanRegistry CreditLine HumanGate}"

MAINNET_CHAIN_KEY=3
MAINNET_IDENTITY_MANAGER=0xf7134CE138832c1456F2a91D64621eE90c2bddEa
SEPOLIA_CHAIN_KEY=1
SEPOLIA_IDENTITY_MANAGER=0xb2EaD588f14e69266d1b87936b75325181377076
FINALITY_DEPTH=32
MIN_ATTESTORS=3

field() { DEPLOYMENT="$DEPLOYMENT" P="$1" bun -e '
  const doc = JSON.parse(await Bun.file(process.env.DEPLOYMENT).text());
  const value = process.env.P.split(".").reduce((o, k) => o?.[k], doc);
  if (value === undefined || value === null) process.exit(1);
  console.log(String(value));
'; }

CHAIN_ID="$(field chainId)"
HUSD_ADDR="$(field contracts.HUSD)"
REGISTRY_ADDR="$(field contracts.HumanRegistry)"
APP_ID="$(field config.appId)"
ACTION="$(field config.action)"
SOURCE_BLOCK_TIME="$(field config.sourceBlockTime)"
INITIAL_LIMIT="$(field config.initialLimit)"
MAX_LIMIT="$(field config.maxLimit)"
FEE_BPS="$(field config.feeBps)"
TERM_SECONDS="$(field config.termSeconds)"
GRACE_SECONDS="$(field config.graceSeconds)"
WORLD_ID_SOURCE="$(field config.worldIdSource)"

if [[ "$WORLD_ID_SOURCE" == "mainnet" ]]; then
  WORLD_ID_ADDRESS="$(field contracts.AttestedWorldIDMainnet)"
else
  WORLD_ID_ADDRESS="$(field contracts.AttestedWorldIDSepolia)"
fi

cd "$CONTRACTS_DIR"

verify() { # verify <label> <path:Contract> [ctor_sig] [args...]
  local label="$1" target="$2" ctor_sig="${3:-}"
  shift 3 2>/dev/null || shift 2
  case " $ONLY " in *" $label "*) ;; *) return 0 ;; esac
  local address args=()
  address="$(field "contracts.$label")" || { echo "  $label — not in $DEPLOYMENT, skipping"; return 0; }
  if [[ -n "$ctor_sig" ]]; then
    args=(--constructor-args "$("$CAST" abi-encode "$ctor_sig" "$@")")
  fi
  echo "→ $label  $address"
  "$FORGE" verify-contract "$address" "$target" \
    --chain-id "$CHAIN_ID" --verifier blockscout --verifier-url "$VERIFIER_URL" \
    --compiler-version 0.8.28 --num-of-optimizations 200 --via-ir --watch "${args[@]}" 2>&1 | tail -4
}

verify AttestedWorldIDMainnet src/AttestedWorldID.sol:AttestedWorldID "constructor(uint64,address,uint64,uint32,uint64)" \
  "$MAINNET_CHAIN_KEY" "$MAINNET_IDENTITY_MANAGER" "$FINALITY_DEPTH" "$MIN_ATTESTORS" "$SOURCE_BLOCK_TIME"
verify AttestedWorldIDSepolia src/AttestedWorldID.sol:AttestedWorldID "constructor(uint64,address,uint64,uint32,uint64)" \
  "$SEPOLIA_CHAIN_KEY" "$SEPOLIA_IDENTITY_MANAGER" "$FINALITY_DEPTH" "$MIN_ATTESTORS" "$SOURCE_BLOCK_TIME"
verify HUSD src/HUSD.sol:HUSD ""
verify HumanRegistry src/HumanRegistry.sol:HumanRegistry "constructor(address,string,string)" \
  "$WORLD_ID_ADDRESS" "$APP_ID" "$ACTION"
verify CreditLine src/CreditLine.sol:CreditLine "constructor(address,address,uint256,uint256,uint256,uint64,uint64)" \
  "$HUSD_ADDR" "$REGISTRY_ADDR" "$INITIAL_LIMIT" "$MAX_LIMIT" "$FEE_BPS" "$TERM_SECONDS" "$GRACE_SECONDS"
verify HumanGate src/examples/HumanGate.sol:HumanGate "constructor(address)" "$REGISTRY_ADDR"
