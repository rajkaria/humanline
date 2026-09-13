#!/usr/bin/env bash
# Deploy HumanPoll (one person, one vote, built on HumanGated) for both deployment profiles and record
# it in deployments/cc3-testnet.json and deployments/cc3-testnet.production.json.
#
#   contracts/script/deploy-poll.sh
#
# Environment:
#   PRIVATE_KEY / CREDITCOIN_WALLET_PRIVATE_KEY   deployer (or ../.secrets.env, or SECRETS_FILE)
#   RPC_URL        https://rpc.cc3-testnet.creditcoin.network
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
FORGE="${FORGE:-$(command -v forge || echo "$HOME/.foundry/bin/forge")}"
RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
DEMO="$ROOT_DIR/deployments/cc3-testnet.json"
PROD="$ROOT_DIR/deployments/cc3-testnet.production.json"

SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.secrets.env}"
if [[ -f "$SECRETS_FILE" ]]; then
  CREDITCOIN_WALLET_PRIVATE_KEY="${CREDITCOIN_WALLET_PRIVATE_KEY:-$(grep '^CREDITCOIN_WALLET_PRIVATE_KEY=' "$SECRETS_FILE" | cut -d= -f2-)}"
fi
PRIVATE_KEY="${PRIVATE_KEY:-${CREDITCOIN_WALLET_PRIVATE_KEY:-}}"
: "${PRIVATE_KEY:?set PRIVATE_KEY or CREDITCOIN_WALLET_PRIVATE_KEY}"

registry_of() {
  bun -e "console.log((await Bun.file(process.argv[1]).json()).contracts.HumanRegistry)" "$1"
}

deploy_for() {
  local file="$1" registry out addr txh
  registry="$(registry_of "$file")"
  echo "deploying HumanPoll for registry $registry" >&2
  out="$(cd "$CONTRACTS_DIR" && "$FORGE" create src/examples/HumanPoll.sol:HumanPoll \
    --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast \
    --constructor-args "$registry")"
  addr="$(printf '%s\n' "$out" | awk '/Deployed to:/ {print $3}')"
  txh="$(printf '%s\n' "$out" | awk '/Transaction hash:/ {print $3}')"
  [[ -n "$addr" && -n "$txh" ]] || { printf '%s\n' "$out" >&2; exit 1; }
  bun -e '
    const [file, addr, txh] = process.argv.slice(1);
    const doc = await Bun.file(file).json();
    doc.contracts.HumanPoll = addr.toLowerCase();
    doc.txHashes = { ...(doc.txHashes ?? {}), HumanPoll: txh };
    await Bun.write(file, JSON.stringify(doc, null, 2) + "\n");
  ' "$file" "$addr" "$txh"
  echo "HumanPoll $addr ($txh) -> $file" >&2
}

deploy_for "$DEMO"
deploy_for "$PROD"
