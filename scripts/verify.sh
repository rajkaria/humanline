#!/usr/bin/env bash
# One command that says whether the repository is green: contracts, worker and web.
# Used by CI and by anyone reviewing a change locally.
#
#   bash scripts/verify.sh            # everything
#   SKIP_CONTRACTS=1 bash scripts/verify.sh
#
# Foundry is resolved from $FORGE, then PATH, then ~/.foundry/bin, then the repo's .tools/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

resolve_forge() {
  if [ -n "${FORGE:-}" ]; then echo "$FORGE"; return; fi
  if command -v forge >/dev/null 2>&1; then command -v forge; return; fi
  if [ -x "$HOME/.foundry/bin/forge" ]; then echo "$HOME/.foundry/bin/forge"; return; fi
  if [ -x "$ROOT/.tools/forge" ]; then echo "$ROOT/.tools/forge"; return; fi
  echo ""
}

if [ -z "${SKIP_CONTRACTS:-}" ]; then
  FORGE_BIN="$(resolve_forge)"
  if [ -z "$FORGE_BIN" ]; then
    echo "forge not found: install Foundry (https://getfoundry.sh) or set FORGE=" >&2
    exit 1
  fi
  step "contracts: forge test"
  (cd contracts && "$FORGE_BIN" test)
fi

if [ -z "${SKIP_WORKER:-}" ]; then
  step "worker: bun test + typecheck"
  (cd worker && bun test && bunx tsc --noEmit -p .)
fi

if [ -z "${SKIP_WEB:-}" ]; then
  step "web: typecheck, lint, test"
  (cd web && bun run typecheck && bun run lint && bun run test)
fi

step "all green"
