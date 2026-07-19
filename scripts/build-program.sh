#!/usr/bin/env bash
# Build the prediction_escrow SBF program + regenerate the IDL.
#
# Anchor 0.32.1's bundled `anchor build` pins an older platform-tools (v1.48 /
# cargo 1.84) that cannot parse dependencies requiring Rust edition2024. We build
# the .so directly with a newer platform-tools (v1.52 / rustc 1.89) and generate
# the IDL with the host toolchain (which also handles edition2024).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Prefer an Agave >= 3.1 cargo-build-sbf (ships platform-tools v1.52).
BSBF=""
for c in \
  "$HOME/.local/share/solana/install/releases/3.1.10/solana-release/bin/cargo-build-sbf" \
  "$(command -v cargo-build-sbf || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && BSBF="$c" && break
done
[ -n "$BSBF" ] || { echo "cargo-build-sbf not found (install Agave/Solana CLI)"; exit 1; }

echo "▸ Building with: $($BSBF --version 2>&1 | tr '\n' ' ')"
"$BSBF" --tools-version v1.52 --sbf-out-dir target/deploy

echo "▸ Generating IDL (host toolchain)…"
if command -v anchor >/dev/null 2>&1; then
  anchor idl build -o target/idl/prediction_escrow.json || echo "  (IDL build skipped)"
fi

echo "▸ Done: target/deploy/prediction_escrow.so"
ls -la target/deploy/prediction_escrow.so
