#!/usr/bin/env bash
# Deploy the cross-chain credit identity layer to Creditcoin CC3 testnet for one profile:
#   HumanLinks → CreditHistory → CreditLine v3 (history-boosted, repayFor) → EthRepay,
# migrate the deployer's liquidity from the previous CreditLine, seed EthRepay's float, and record
# everything in the profile's deployment file (the old line moves under `previous`).
#
#   contracts/script/deploy-cross-chain.sh                                   # demo profile
#   DEPLOYMENT=deployments/cc3-testnet.production.json contracts/script/deploy-cross-chain.sh
#
# Environment:
#   PRIVATE_KEY / CREDITCOIN_WALLET_PRIVATE_KEY   deployer (or ../.secrets.env, or SECRETS_FILE)
#   REPAY_ADDRESS   Ethereum/Sepolia address repayments are sent to (default: the deployer)
#   FLOAT_HUSD      hUSD base units seeded into EthRepay (default 20000000 = 20 hUSD)
#   MIN_GAP_BLOCKS  borrow→repay minimum, in source blocks (default 7200 ≈ 1 day)
#   BOOST_BPS       share of proved repaid dollars added to the limit (default 2500 = 25%)
#   MAX_BOOST       cap on the boost, hUSD base units (default 500000000 = 500 hUSD)
#   RPC_URL         https://rpc.cc3-testnet.creditcoin.network
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"
FORGE="${FORGE:-$(command -v forge || echo "$HOME/.foundry/bin/forge")}"
CAST="${CAST:-$(command -v cast || echo "$HOME/.foundry/bin/cast")}"
RPC_URL="${RPC_URL:-https://rpc.cc3-testnet.creditcoin.network}"
DEPLOYMENT="${DEPLOYMENT:-$ROOT_DIR/deployments/cc3-testnet.json}"
[[ "$DEPLOYMENT" = /* ]] || DEPLOYMENT="$ROOT_DIR/$DEPLOYMENT"

SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.secrets.env}"
if [[ -f "$SECRETS_FILE" ]]; then
  CREDITCOIN_WALLET_PRIVATE_KEY="${CREDITCOIN_WALLET_PRIVATE_KEY:-$(grep '^CREDITCOIN_WALLET_PRIVATE_KEY=' "$SECRETS_FILE" | cut -d= -f2-)}"
fi
PRIVATE_KEY="${PRIVATE_KEY:-${CREDITCOIN_WALLET_PRIVATE_KEY:-}}"
: "${PRIVATE_KEY:?set PRIVATE_KEY or CREDITCOIN_WALLET_PRIVATE_KEY}"
DEPLOYER="$("$CAST" wallet address --private-key "$PRIVATE_KEY")"

REPAY_ADDRESS="${REPAY_ADDRESS:-$DEPLOYER}"
FLOAT_HUSD="${FLOAT_HUSD:-20000000}"
MIN_GAP_BLOCKS="${MIN_GAP_BLOCKS:-7200}"
BOOST_BPS="${BOOST_BPS:-2500}"
MAX_BOOST="${MAX_BOOST:-500000000}"
FINALITY_DEPTH=32
MIN_ATTESTORS=3

# Source chains on CC3 testnet: chainKey 1 = Sepolia (11155111), chainKey 3 = Ethereum (1).
SEPOLIA_AAVE_POOL=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
MAINNET_AAVE_POOL=0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
POOLS="[(1,11155111,$SEPOLIA_AAVE_POOL),(3,1,$MAINNET_AAVE_POOL)]"
RESERVES="[(1,0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8,6),(1,0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357,18),(1,0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0,6),(3,0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,6),(3,0xdAC17F958D2ee523a2206206994597C13D831ec7,6),(3,0x6B175474E89094C44Da98b954EedeAC495271d0F,18)]"
STABLECOINS="[(1,11155111,0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238,6),(3,1,0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,6)]"

field() { F="$DEPLOYMENT" P="$1" bun -e '
  const doc = JSON.parse(await Bun.file(process.env.F).text());
  const v = process.env.P.split(".").reduce((o, k) => o?.[k], doc);
  if (v === undefined || v === null) process.exit(1);
  console.log(String(v));
'; }

REGISTRY="$(field contracts.HumanRegistry)"
HUSD="$(field contracts.HUSD)"
OLD_LINE="$(field contracts.CreditLine)"
OLD_LINE_TX="$(field txHashes.CreditLine)"
INITIAL_LIMIT="$(field config.initialLimit)"
MAX_LIMIT="$(field config.maxLimit)"
FEE_BPS="$(field config.feeBps)"
TERM_SECONDS="$(field config.termSeconds)"
GRACE_SECONDS="$(field config.graceSeconds)"
SECURITY_CHAIN_KEY="$(field config.securityChainKey)"
SOURCE_CHAIN_ID="$(field config.sourceChainId)"
EXPOSURE="$(field config.exposurePerBondedCtc)"

cd "$CONTRACTS_DIR"
"$FORGE" build >/dev/null

send() { "$CAST" send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json "$@"; }
json() { bun -e "const r = JSON.parse(await Bun.stdin.text()); if (r.status !== '0x1' && r.status !== 1 && r.status !== '1') { console.error('reverted', r.transactionHash); process.exit(1) } console.log(r.$1)"; }

create() { # create <Contract> <ctor sig> <args...>  → "address txHash"
  local name="$1" sig="$2"; shift 2
  local code args receipt
  code="$("$FORGE" inspect "$name" bytecode --json | tr -d '"')"
  args="$("$CAST" abi-encode "$sig" "$@")"
  receipt="$(send --create "${code}${args#0x}")"
  printf '%s %s\n' "$(printf '%s' "$receipt" | json contractAddress)" "$(printf '%s' "$receipt" | json transactionHash)"
}

echo "profile: $(field profile)  registry $REGISTRY  old line $OLD_LINE"

read -r LINKS LINKS_TX < <(create HumanLinks "constructor(address,uint64[],uint64[],uint64,uint32)" \
  "$REGISTRY" "[1,3]" "[11155111,1]" "$FINALITY_DEPTH" "$MIN_ATTESTORS")
echo "HumanLinks    -> $LINKS ($LINKS_TX)"

read -r HISTORY HISTORY_TX < <(create CreditHistory \
  "constructor(address,(uint64,uint64,address)[],(uint64,address,uint8)[],uint64,uint32,uint64,uint256,uint256)" \
  "$LINKS" "$POOLS" "$RESERVES" "$FINALITY_DEPTH" "$MIN_ATTESTORS" "$MIN_GAP_BLOCKS" "$BOOST_BPS" "$MAX_BOOST")
echo "CreditHistory -> $HISTORY ($HISTORY_TX)"

read -r LINE LINE_TX < <(create CreditLine \
  "constructor(address,address,uint256,uint256,uint256,uint64,uint64,uint64,uint64,uint256,address)" \
  "$HUSD" "$REGISTRY" "$INITIAL_LIMIT" "$MAX_LIMIT" "$FEE_BPS" "$TERM_SECONDS" "$GRACE_SECONDS" \
  "$SECURITY_CHAIN_KEY" "$SOURCE_CHAIN_ID" "$EXPOSURE" "$HISTORY")
echo "CreditLine v3 -> $LINE ($LINE_TX)"

read -r REPAY REPAY_TX < <(create EthRepay \
  "constructor(address,address,address,(uint64,uint64,address,uint8)[],uint64,uint32,uint8)" \
  "$LINKS" "$LINE" "$REPAY_ADDRESS" "$STABLECOINS" "$FINALITY_DEPTH" "$MIN_ATTESTORS" 6)
echo "EthRepay      -> $REPAY ($REPAY_TX)"

# Liquidity: everything the deployer holds in the old line moves to v3, less EthRepay's float.
SHARES="$("$CAST" call "$OLD_LINE" "sharesOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL" | awk '{print $1}')"
MIGRATE_TX=""
if [[ "$SHARES" != "0" ]]; then
  MIGRATE_TX="$(send "$OLD_LINE" "withdraw(uint256)" "$SHARES" | json transactionHash)"
  echo "withdrew $SHARES shares from the old line ($MIGRATE_TX)"
fi
BAL="$("$CAST" call "$HUSD" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL" | awk '{print $1}')"
FLOAT=$(( BAL < FLOAT_HUSD ? BAL : FLOAT_HUSD ))
FLOAT_TX=""
if (( FLOAT > 0 )); then
  FLOAT_TX="$(send "$HUSD" "transfer(address,uint256)" "$REPAY" "$FLOAT" | json transactionHash)"
  echo "seeded EthRepay float with $FLOAT ($FLOAT_TX)"
fi
DEPOSIT=$(( BAL - FLOAT ))
DEPOSIT_TX=""
if (( DEPOSIT > 0 )); then
  send "$HUSD" "approve(address,uint256)" "$LINE" "$DEPOSIT" >/dev/null
  DEPOSIT_TX="$(send "$LINE" "deposit(uint256)" "$DEPOSIT" | json transactionHash)"
  echo "deposited $DEPOSIT into CreditLine v3 ($DEPOSIT_TX)"
fi
BLOCK="$("$CAST" block-number --rpc-url "$RPC_URL")"

OUT="$DEPLOYMENT" LINKS="$LINKS" LINKS_TX="$LINKS_TX" HISTORY="$HISTORY" HISTORY_TX="$HISTORY_TX" LINE="$LINE" \
LINE_TX="$LINE_TX" REPAY="$REPAY" REPAY_TX="$REPAY_TX" OLD_LINE="$OLD_LINE" OLD_LINE_TX="$OLD_LINE_TX" \
REPAY_ADDRESS="$REPAY_ADDRESS" FLOAT="$FLOAT" FLOAT_TX="$FLOAT_TX" MIGRATE_TX="$MIGRATE_TX" DEPOSIT="$DEPOSIT" \
DEPOSIT_TX="$DEPOSIT_TX" MIN_GAP_BLOCKS="$MIN_GAP_BLOCKS" BOOST_BPS="$BOOST_BPS" MAX_BOOST="$MAX_BOOST" BLOCK="$BLOCK" \
POOLS="$POOLS" RESERVES="$RESERVES" STABLECOINS="$STABLECOINS" bun -e '
  const e = process.env;
  const doc = JSON.parse(await Bun.file(e.OUT).text());
  doc.previous = doc.previous ?? {};
  doc.previous.CreditLineV2 = {
    address: e.OLD_LINE.toLowerCase(),
    txHash: e.OLD_LINE_TX,
    note: "attestor-bond cap, no cross-chain history; superseded by CreditLine v3 (CreditHistory boost + repayFor)",
    migrationTx: e.MIGRATE_TX || null,
  };
  doc.contracts.CreditLine = e.LINE.toLowerCase();
  doc.contracts.HumanLinks = e.LINKS.toLowerCase();
  doc.contracts.CreditHistory = e.HISTORY.toLowerCase();
  doc.contracts.EthRepay = e.REPAY.toLowerCase();
  doc.txHashes.CreditLine = e.LINE_TX;
  doc.txHashes.HumanLinks = e.LINKS_TX;
  doc.txHashes.CreditHistory = e.HISTORY_TX;
  doc.txHashes.EthRepay = e.REPAY_TX;
  doc.config.crossChain = {
    sourceChains: [{ chainKey: 1, chainId: 11155111 }, { chainKey: 3, chainId: 1 }],
    finalityDepth: 32,
    minAttestors: 3,
    maxLinks: 8,
    aavePools: e.POOLS,
    reserves: e.RESERVES,
    stablecoins: e.STABLECOINS,
    minGapBlocks: Number(e.MIN_GAP_BLOCKS),
    boostBps: Number(e.BOOST_BPS),
    maxBoost: Number(e.MAX_BOOST),
    repayAddress: e.REPAY_ADDRESS,
    floatSeeded: Number(e.FLOAT),
    floatTx: e.FLOAT_TX || null,
    liquidityMigrated: Number(e.DEPOSIT),
    depositTx: e.DEPOSIT_TX || null,
    deployedAtBlock: Number(e.BLOCK),
  };
  doc.creditLineDeployedAt = Math.floor(Date.now() / 1000);
  await Bun.write(e.OUT, JSON.stringify(doc, null, 2) + "\n");
  console.log("recorded in", e.OUT);
'
