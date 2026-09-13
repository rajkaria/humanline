#!/usr/bin/env bash
# Solidity line/branch coverage for contracts/src.
#
#   bash scripts/coverage.sh            # writes evidence/coverage.txt and contracts/lcov.info
#
# Why this is not a bare `forge coverage`: coverage compiles with the optimizer off, and
# @gluwa/asc-contracts' EvmV1Decoder._decodeCommonTxChunk is stack-too-deep without it, under
# legacy codegen and under `--ir-minimum` alike. Via-IR can move variables to memory instead, but
# only when every inline assembly block in the contract is marked memory-safe, and ours (query-id
# hashing, calldata word reads, the decoder's type-byte read) are memory-safe but unannotated.
#
# So coverage runs on a scratch copy of contracts/ in which every `assembly {` becomes
# `assembly ("memory-safe") {`. The annotation only permits the compiler to relocate stack slots;
# no statement changes, so line and branch hits map 1:1 onto the real sources. The working tree
# and the deployed bytecode are untouched. Deploy scripts are skipped (not measured) and fork
# suites excluded (they need the live CC3 node).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
C="$ROOT/contracts"
FORGE="${FORGE:-$(command -v forge || echo "$HOME/.foundry/bin/forge")}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/humanline-coverage.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cp -R "$C/src" "$C/test" "$C/script" "$C/vendor" "$C/foundry.toml" "$C/package.json" "$WORK/"
ln -s "$C/lib" "$WORK/lib"
mkdir -p "$WORK/node_modules"
for dep in "$C"/node_modules/*; do
  name="$(basename "$dep")"
  [ "$name" = "@gluwa" ] || ln -s "$dep" "$WORK/node_modules/$name"
done
cp -RL "$C/node_modules/@gluwa" "$WORK/node_modules/@gluwa"

# Annotate (perl: portable across GNU and BSD).
grep -rl 'assembly {' "$WORK/src" "$WORK/test" "$WORK/node_modules/@gluwa" \
  | xargs perl -pi -e 's/assembly \{/assembly ("memory-safe") {/g'

cd "$WORK"
"$FORGE" coverage --ir-minimum --skip script \
  --no-match-contract Fork \
  --no-match-coverage "(test/|script/|vendor/|node_modules/|lib/)" \
  --report summary --report lcov 2>&1 \
  | grep -v -e '^Warning' -e 'ir-minimum' -e '^Only use' -e '^Note that' -e '^See more' \
  | tee "$WORK/coverage.out"

mkdir -p "$ROOT/evidence"
{
  echo "# forge coverage --ir-minimum via scripts/coverage.sh, $(date -u +%Y-%m-%dT%H:%MZ)"
  grep -E '^\| (File|src/|Total)' "$WORK/coverage.out"
} > "$ROOT/evidence/coverage.txt"
cp "$WORK/lcov.info" "$C/lcov.info"
echo "coverage summary -> evidence/coverage.txt, lcov -> contracts/lcov.info"
