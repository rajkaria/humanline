#!/usr/bin/env bash
# Fill in the txHashes of deployments/cc3-testnet.json from Foundry's broadcast artifact.
#
#   contracts/script/record-deployment.sh [Deploy.s.sol|DeployDemo.s.sol] [chainId]
#
# Run it straight after `forge script ... --broadcast`. A forge script cannot observe its own
# transaction hashes, so this second pass reads them out of broadcast/<script>/<chainId>/run-latest.json.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$HERE")"
SCRIPT_NAME="${1:-Deploy.s.sol}"
CHAIN_ID="${2:-102031}"
BROADCAST="$CONTRACTS_DIR/broadcast/$SCRIPT_NAME/$CHAIN_ID/run-latest.json"
DEPLOYMENT="${DEPLOYMENT_OUT:-$CONTRACTS_DIR/../deployments/cc3-testnet.json}"

[[ -f "$BROADCAST" ]] || { echo "no broadcast artifact at $BROADCAST" >&2; exit 1; }
[[ -f "$DEPLOYMENT" ]] || { echo "no deployment record at $DEPLOYMENT" >&2; exit 1; }

bun -e '
const [broadcastPath, deploymentPath] = process.argv.slice(2);
const broadcast = JSON.parse(await Bun.file(broadcastPath).text());
const deployment = JSON.parse(await Bun.file(deploymentPath).text());

// One AttestedWorldID is deployed twice; disambiguate by the address already recorded.
const byAddress = new Map(
  Object.entries(deployment.contracts).map(([name, addr]) => [String(addr).toLowerCase(), name]),
);

for (const tx of broadcast.transactions ?? []) {
  if (tx.transactionType !== "CREATE") continue;
  const name = byAddress.get(String(tx.contractAddress).toLowerCase());
  if (name) deployment.txHashes[name] = tx.hash;
}

await Bun.write(deploymentPath, JSON.stringify(deployment, null, 2) + "\n");
console.log("recorded", Object.values(deployment.txHashes).filter(Boolean).length, "tx hashes");
' "$BROADCAST" "$DEPLOYMENT"
