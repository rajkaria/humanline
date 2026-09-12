#!/usr/bin/env bash
# Deploy the Humanline stack to Creditcoin CC3 testnet with `cast`, and write
# deployments/cc3-testnet.json (addresses AND transaction hashes).
#
#   contracts/script/deploy-cc3.sh            # production terms (30d / 7d)
#   PROFILE=demo contracts/script/deploy-cc3.sh   # demo terms (600s / 300s)
#
# Why not `forge script`: Foundry 1.5.1 refuses to build an EVM environment from a CC3 RPC -
# CC3 block headers carry no `mixHash`, so revm fails with "header validation error: `prevrandao`
# not set" before the script runs. That affects `forge script --rpc-url` and `forge test --fork-url`
# alike, with or without --skip-simulation. `cast` never builds a local EVM, so it works.
# `script/Deploy.s.sol` stays the canonical description of what gets deployed, and is what the
# unit tests and any future Foundry release will use.
#
# Environment:
#   PRIVATE_KEY       deployer key (or put it in ../.secrets.env)
#   PROFILE           prod (default) | demo
#   WORLD_ID_SOURCE   sepolia (default) | mainnet
#   WORLD_APP_ID      app_87b24915fcf733f10df1b0c46dd1f783
#   WORLD_ACTION      humanline-register
#   RPC_URL           https://rpc.cc3-testnet.creditcoin.network
#   REUSE_FROM        path to an existing deployment JSON to take addresses from
#   REUSE             space-separated labels to take from REUSE_FROM instead of deploying,
#                     e.g. REUSE="AttestedWorldIDMainnet AttestedWorldIDSepolia HUSD".
#                     Reusing the relayed AttestedWorldID instances is what lets a second
#                     profile (production terms, Orb tree) share the roots the relayer has
#                     already carried, and share one hUSD faucet across both credit lines.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
FORGE="${FORGE:-$ROOT_DIR/.tools/forge}"
CAST="${CAST:-$ROOT_DIR/.tools/cast}"
RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
OUT="${DEPLOYMENT_OUT:-$ROOT_DIR/deployments/cc3-testnet.json}"

# shellcheck disable=SC1091
[[ -f "$ROOT_DIR/.secrets.env" ]] && source "$ROOT_DIR/.secrets.env"
# .secrets.env names the deployer key CREDITCOIN_WALLET_PRIVATE_KEY; accept either spelling.
PRIVATE_KEY="${PRIVATE_KEY:-${CREDITCOIN_WALLET_PRIVATE_KEY:-}}"
: "${PRIVATE_KEY:?set PRIVATE_KEY or CREDITCOIN_WALLET_PRIVATE_KEY (or put it in .secrets.env)}"

PROFILE="${PROFILE:-prod}"
WORLD_ID_SOURCE="${WORLD_ID_SOURCE:-sepolia}"
WORLD_APP_ID="${WORLD_APP_ID:-app_87b24915fcf733f10df1b0c46dd1f783}"
WORLD_ACTION="${WORLD_ACTION:-humanline-register}"

MAINNET_CHAIN_KEY=3
MAINNET_IDENTITY_MANAGER=0xf7134CE138832c1456F2a91D64621eE90c2bddEa
SEPOLIA_CHAIN_KEY=1
SEPOLIA_IDENTITY_MANAGER=0xb2EaD588f14e69266d1b87936b75325181377076
FINALITY_DEPTH=32
MIN_ATTESTORS=3
SOURCE_BLOCK_TIME=12        # seconds per block on both Ethereum chains; dates relayed roots

INITIAL_LIMIT=25000000     # 25 hUSD
MAX_LIMIT=2000000000       # 2,000 hUSD
FEE_BPS=100                # 1% per term

if [[ "$PROFILE" == "demo" ]]; then
  TERM_SECONDS="${TERM_SECONDS:-600}"
  GRACE_SECONDS="${GRACE_SECONDS:-300}"
else
  TERM_SECONDS="${TERM_SECONDS:-2592000}"
  GRACE_SECONDS="${GRACE_SECONDS:-604800}"
fi

cd "$CONTRACTS_DIR"
"$FORGE" build >/dev/null 2>&1

DEPLOYER="$("$CAST" wallet address --private-key "$PRIVATE_KEY")"
echo "deployer: $DEPLOYER  profile: $PROFILE  world id source: $WORLD_ID_SOURCE"

# bash 3.2 compatible (macOS): tab-separated "label\taddress" rows instead of associative arrays
ADDRESSES_JSON=""
TXHASHES_JSON=""
addr_of() { printf '%s\n' "$ADDRESSES_JSON" | awk -F'\t' -v k="$1" '$1==k{print $2}'; }

# Labels listed in $REUSE are copied out of $REUSE_FROM rather than deployed again.
REUSE="${REUSE:-}"
REUSE_FROM="${REUSE_FROM:-}"
reused_field() { # reused_field <label> <contracts|txHashes>
  [[ -n "$REUSE_FROM" ]] || return 1
  LABEL="$1" FIELD="$2" REUSE_FROM="$REUSE_FROM" bun -e '
    const doc = JSON.parse(await Bun.file(process.env.REUSE_FROM).text());
    const value = doc?.[process.env.FIELD]?.[process.env.LABEL];
    if (!value) process.exit(1);
    console.log(value);
  '
}
is_reused() {
  case " $REUSE " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

deploy() {
  local label="$1" contract="$2" ctor_sig="${3:-}"
  shift 3 || true
  local code args receipt

  if is_reused "$label"; then
    local existing existing_tx
    existing="$(reused_field "$label" contracts)" || {
      echo "REUSE lists $label but $REUSE_FROM has no address for it" >&2; exit 1; }
    existing_tx="$(reused_field "$label" txHashes || true)"
    ADDRESSES_JSON="${ADDRESSES_JSON}${label}	${existing}
"
    [[ -n "$existing_tx" ]] && TXHASHES_JSON="${TXHASHES_JSON}${label}	${existing_tx}
"
    echo "  $label -> ${existing}  (reused from $(basename "$REUSE_FROM"))"
    return 0
  fi

  code="$("$FORGE" inspect "$contract" bytecode --json | tr -d '"')"
  if [[ -n "$ctor_sig" ]]; then
    args="$("$CAST" abi-encode "$ctor_sig" "$@")"
    code="${code}${args#0x}"
  fi
  receipt="$("$CAST" send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json --create "$code")"
  local addr txh
  addr="$(printf '%s' "$receipt" | bun -e 'const r = JSON.parse(await Bun.stdin.text()); console.log(r.contractAddress)')"
  txh="$(printf '%s' "$receipt" | bun -e 'const r = JSON.parse(await Bun.stdin.text()); console.log(r.transactionHash)')"
  ADDRESSES_JSON="${ADDRESSES_JSON}${label}	${addr}
"
  TXHASHES_JSON="${TXHASHES_JSON}${label}	${txh}
"
  echo "  $label -> ${addr}  (${txh})"
}

deploy AttestedWorldIDMainnet AttestedWorldID "constructor(uint64,address,uint64,uint32,uint64)" \
  "$MAINNET_CHAIN_KEY" "$MAINNET_IDENTITY_MANAGER" "$FINALITY_DEPTH" "$MIN_ATTESTORS" "$SOURCE_BLOCK_TIME"
deploy AttestedWorldIDSepolia AttestedWorldID "constructor(uint64,address,uint64,uint32,uint64)" \
  "$SEPOLIA_CHAIN_KEY" "$SEPOLIA_IDENTITY_MANAGER" "$FINALITY_DEPTH" "$MIN_ATTESTORS" "$SOURCE_BLOCK_TIME"
deploy HUSD HUSD ""

if [[ "$WORLD_ID_SOURCE" == "mainnet" ]]; then
  WORLD_ID_ADDRESS="$(addr_of AttestedWorldIDMainnet)"
else
  WORLD_ID_ADDRESS="$(addr_of AttestedWorldIDSepolia)"
fi

deploy HumanRegistry HumanRegistry "constructor(address,string,string)" \
  "$WORLD_ID_ADDRESS" "$WORLD_APP_ID" "$WORLD_ACTION"
deploy CreditLine CreditLine "constructor(address,address,uint256,uint256,uint256,uint64,uint64)" \
  "$(addr_of HUSD)" "$(addr_of HumanRegistry)" "$INITIAL_LIMIT" "$MAX_LIMIT" "$FEE_BPS" \
  "$TERM_SECONDS" "$GRACE_SECONDS"
deploy HumanGate HumanGate "constructor(address)" "$(addr_of HumanRegistry)"

CHAIN_ID="$("$CAST" chain-id --rpc-url "$RPC_URL")"

mkdir -p "$(dirname "$OUT")"

ADDRESSES="$ADDRESSES_JSON" TXHASHES="$TXHASHES_JSON" CHAIN_ID="$CHAIN_ID" DEPLOYER="$DEPLOYER" \
PROFILE="$PROFILE" WORLD_ID_SOURCE="$WORLD_ID_SOURCE" WORLD_APP_ID="$WORLD_APP_ID" \
WORLD_ACTION="$WORLD_ACTION" TERM_SECONDS="$TERM_SECONDS" GRACE_SECONDS="$GRACE_SECONDS" \
INITIAL_LIMIT="$INITIAL_LIMIT" MAX_LIMIT="$MAX_LIMIT" FEE_BPS="$FEE_BPS" OUT="$OUT" \
SOURCE_BLOCK_TIME="$SOURCE_BLOCK_TIME" \
bun -e '
const rows = (s) => Object.fromEntries((s ?? "").split("\n").filter(Boolean).map((l) => l.split("\t")));
const out = {
  chainId: Number(process.env.CHAIN_ID),
  profile: process.env.PROFILE,
  contracts: rows(process.env.ADDRESSES),
  txHashes: rows(process.env.TXHASHES),
  config: {
    worldIdSource: process.env.WORLD_ID_SOURCE,
    appId: process.env.WORLD_APP_ID,
    action: process.env.WORLD_ACTION,
    termSeconds: Number(process.env.TERM_SECONDS),
    graceSeconds: Number(process.env.GRACE_SECONDS),
    initialLimit: Number(process.env.INITIAL_LIMIT),
    maxLimit: Number(process.env.MAX_LIMIT),
    feeBps: Number(process.env.FEE_BPS),
    sourceBlockTime: Number(process.env.SOURCE_BLOCK_TIME),
  },
  deployedAt: Math.floor(Date.now() / 1000),
  deployer: process.env.DEPLOYER,
};
await Bun.write(process.env.OUT, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", process.env.OUT);
'
