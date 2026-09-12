#!/usr/bin/env bash
# Deploy RelayReward to Creditcoin CC3 testnet for both relayed AttestedWorldID instances, fund it,
# and record it in both deployment files (the two profiles share the same relays, so one vault).
#
#   contracts/script/deploy-relay-reward.sh
#
# Environment:
#   PRIVATE_KEY / CREDITCOIN_WALLET_PRIVATE_KEY   deployer and funder (or ../.secrets.env)
#   REWARD_WEI     tCTC wei per rewarded root   (default 2000000000000000 = 0.002 tCTC)
#   MAX_ROOT_AGE   seconds                      (default 21600 = 6 h)
#   FUND_ETHER     initial funding, in tCTC     (default 25)
#   RPC_URL        https://rpc.cc3-testnet.creditcoin.network
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
FORGE="${FORGE:-$(command -v forge || echo "$HOME/.foundry/bin/forge")}"
CAST="${CAST:-$(command -v cast || echo "$HOME/.foundry/bin/cast")}"
RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
DEMO="$ROOT_DIR/deployments/cc3-testnet.json"
PROD="$ROOT_DIR/deployments/cc3-testnet.production.json"

# SECRETS_FILE lets a git worktree point at the main checkout's git-ignored secrets.
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.secrets.env}"
if [[ -f "$SECRETS_FILE" ]]; then
  CREDITCOIN_WALLET_PRIVATE_KEY="${CREDITCOIN_WALLET_PRIVATE_KEY:-$(grep '^CREDITCOIN_WALLET_PRIVATE_KEY=' "$SECRETS_FILE" | cut -d= -f2-)}"
fi
PRIVATE_KEY="${PRIVATE_KEY:-${CREDITCOIN_WALLET_PRIVATE_KEY:-}}"
: "${PRIVATE_KEY:?set PRIVATE_KEY or CREDITCOIN_WALLET_PRIVATE_KEY}"

REWARD_WEI="${REWARD_WEI:-2000000000000000}"
MAX_ROOT_AGE="${MAX_ROOT_AGE:-21600}"
FUND_ETHER="${FUND_ETHER:-25}"

field() { F="$1" P="$2" bun -e '
  const doc = JSON.parse(await Bun.file(process.env.F).text());
  const v = process.env.P.split(".").reduce((o, k) => o?.[k], doc);
  if (v === undefined) process.exit(1);
  console.log(String(v));
'; }

MAINNET="$(field "$DEMO" contracts.AttestedWorldIDMainnet)"
SEPOLIA="$(field "$DEMO" contracts.AttestedWorldIDSepolia)"

cd "$CONTRACTS_DIR"
"$FORGE" build >/dev/null

code="$("$FORGE" inspect RelayReward bytecode --json | tr -d '"')"
args="$("$CAST" abi-encode "constructor(address[],uint256,uint256)" "[$MAINNET,$SEPOLIA]" "$REWARD_WEI" "$MAX_ROOT_AGE")"
receipt="$("$CAST" send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json --create "${code}${args#0x}")"
ADDR="$(printf '%s' "$receipt" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).contractAddress)')"
TX="$(printf '%s' "$receipt" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).transactionHash)')"
echo "RelayReward -> $ADDR ($TX)"

FUND_TX="$("$CAST" send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json "$ADDR" "fund()" --value "${FUND_ETHER}ether" \
  | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).transactionHash)')"
echo "funded ${FUND_ETHER} tCTC ($FUND_TX)"

for OUT in "$DEMO" "$PROD"; do
  OUT="$OUT" ADDR="$ADDR" TX="$TX" FUND_TX="$FUND_TX" REWARD_WEI="$REWARD_WEI" MAX_ROOT_AGE="$MAX_ROOT_AGE" \
  FUND_ETHER="$FUND_ETHER" bun -e '
    const doc = JSON.parse(await Bun.file(process.env.OUT).text());
    doc.contracts.RelayReward = process.env.ADDR.toLowerCase();
    doc.txHashes.RelayReward = process.env.TX;
    doc.config.relayReward = {
      rewardPerRootWei: process.env.REWARD_WEI,
      maxRootAgeSeconds: Number(process.env.MAX_ROOT_AGE),
      initialFundingTctc: Number(process.env.FUND_ETHER),
      fundingTx: process.env.FUND_TX,
    };
    await Bun.write(process.env.OUT, JSON.stringify(doc, null, 2) + "\n");
    console.log("recorded in", process.env.OUT);
  '
done
