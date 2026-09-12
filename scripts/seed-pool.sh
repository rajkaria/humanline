#!/usr/bin/env bash
# Seed a CreditLine pool with hUSD so real borrowers have something to draw on.
#
#   scripts/seed-pool.sh                                   # 5 faucet claims → production pool
#   WALLETS=3 DEPLOYMENT=deployments/cc3-testnet.json scripts/seed-pool.sh
#
# hUSD's faucet mints 100 hUSD per address per 24h, so seeding a pool means claiming
# from several addresses. Each helper wallet is generated here, funded with just enough
# tCTC for two transactions, claims once, and forwards the hUSD to the depositor — the
# keys are ephemeral and never written anywhere, because nothing of value stays in them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$HERE")"
CAST="${CAST:-$ROOT_DIR/.tools/cast}"
RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
DEPLOYMENT="${DEPLOYMENT:-$ROOT_DIR/deployments/cc3-testnet.production.json}"
WALLETS="${WALLETS:-5}"
GAS_PER_WALLET="${GAS_PER_WALLET:-1}"   # tCTC

# shellcheck disable=SC1091
[[ -f "$ROOT_DIR/.secrets.env" ]] && source "$ROOT_DIR/.secrets.env"
PRIVATE_KEY="${PRIVATE_KEY:-${CREDITCOIN_WALLET_PRIVATE_KEY:-}}"
: "${PRIVATE_KEY:?set PRIVATE_KEY or CREDITCOIN_WALLET_PRIVATE_KEY}"

field() { DEPLOYMENT="$DEPLOYMENT" P="$1" bun -e '
  const doc = JSON.parse(await Bun.file(process.env.DEPLOYMENT).text());
  const v = process.env.P.split(".").reduce((o, k) => o?.[k], doc);
  if (v === undefined) process.exit(1);
  console.log(String(v));
'; }

HUSD="$(field contracts.HUSD)"
CREDIT_LINE="$(field contracts.CreditLine)"
DEPOSITOR="$("$CAST" wallet address --private-key "$PRIVATE_KEY")"

send() { "$CAST" send --rpc-url "$RPC_URL" --private-key "$1" --json "${@:2}" >/dev/null; }

echo "seeding $CREDIT_LINE with hUSD $HUSD from $DEPOSITOR ($WALLETS helper claims)"

for i in $(seq 1 "$WALLETS"); do
  helper_json="$("$CAST" wallet new --json)"
  helper_key="$(printf '%s' "$helper_json" | bun -e 'console.log(JSON.parse(await Bun.stdin.text())[0].private_key)')"
  helper_addr="$(printf '%s' "$helper_json" | bun -e 'console.log(JSON.parse(await Bun.stdin.text())[0].address)')"

  send "$PRIVATE_KEY" --value "${GAS_PER_WALLET}ether" "$helper_addr"
  send "$helper_key" "$HUSD" "faucet()"
  claimed="$("$CAST" call --rpc-url "$RPC_URL" "$HUSD" "balanceOf(address)(uint256)" "$helper_addr" | awk '{print $1}')"
  send "$helper_key" "$HUSD" "transfer(address,uint256)" "$DEPOSITOR" "$claimed"
  echo "  claim $i: $((claimed / 1000000)) hUSD"
done

BALANCE="$("$CAST" call --rpc-url "$RPC_URL" "$HUSD" "balanceOf(address)(uint256)" "$DEPOSITOR" | awk '{print $1}')"
echo "depositing $((BALANCE / 1000000)) hUSD"
send "$PRIVATE_KEY" "$HUSD" "approve(address,uint256)" "$CREDIT_LINE" "$BALANCE"
send "$PRIVATE_KEY" "$CREDIT_LINE" "deposit(uint256)" "$BALANCE"

TOTAL="$("$CAST" call --rpc-url "$RPC_URL" "$CREDIT_LINE" "totalAssets()(uint256)" | awk '{print $1}')"
echo "pool now holds $((TOTAL / 1000000)) hUSD"
