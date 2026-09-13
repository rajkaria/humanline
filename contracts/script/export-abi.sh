#!/usr/bin/env bash
# Export the deployed ABIs the worker and the web app consume.
#
#   contracts/script/export-abi.sh
#
# Writes contracts/abi/<Contract>.json. Foundry lives in .tools/, not on PATH; override with FORGE=.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
FORGE="${FORGE:-$CONTRACTS_DIR/../.tools/forge}"
OUT_DIR="$CONTRACTS_DIR/abi"

# Five deployed contracts, plus the relay's declared interface for integrators who only need the
# World ID surface (its ABI is a strict subset of AttestedWorldID's).
CONTRACTS=(
  AttestedWorldID
  HumanRegistry
  CreditLine
  HUSD
  HumanGate
  RelayReward
  HumanLinks
  CreditHistory
  EthRepay
  IAttestedWorldID
)

if [[ ! -x "$FORGE" ]]; then
  echo "forge not found at $FORGE (set FORGE=/path/to/forge)" >&2
  exit 1
fi

cd "$CONTRACTS_DIR"
mkdir -p "$OUT_DIR"

"$FORGE" build >/dev/null

for name in "${CONTRACTS[@]}"; do
  "$FORGE" inspect "$name" abi --json > "$OUT_DIR/$name.json"
  echo "abi/$name.json ($(grep -c '"type"' "$OUT_DIR/$name.json") entries)"
done
