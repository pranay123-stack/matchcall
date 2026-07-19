#!/usr/bin/env bash
# MatchCall — one-shot devnet bootstrap.
#
# Deploys the prediction_escrow program, provisions the mUSDC test token,
# initializes the on-chain config, and activates a live TxLINE data session.
# Run this once devnet SOL is available in the deployer wallet.
#
#   ./bootstrap.sh
#
# Prereqs: solana CLI, node/npm (app deps installed), the compiled program at
# target/deploy/prediction_escrow.so (run `./scripts/build-program.sh` if missing).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RPC="https://api.devnet.solana.com"
DEPLOYER="$ROOT/.keys/deployer.json"
PROGRAM_KP="$ROOT/target/deploy/prediction_escrow-keypair.json"
PROGRAM_SO="$ROOT/target/deploy/prediction_escrow.so"
MINT_KP="$ROOT/.keys/musdc-mint.json"
PROGRAM_ID="$(solana address -k "$PROGRAM_KP")"
MUSDC_MINT="$(solana address -k "$MINT_KP")"
DEPLOYER_ADDR="$(solana address -k "$DEPLOYER")"

say() { printf "\n\033[1;32m▸ %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

[ -f "$PROGRAM_SO" ] || die "Missing $PROGRAM_SO — build first: ./scripts/build-program.sh"

say "Deployer:  $DEPLOYER_ADDR"
say "Program:   $PROGRAM_ID"
say "mUSDC:     $MUSDC_MINT"

# 1. Funding check ----------------------------------------------------------
BAL="$(solana balance -k "$DEPLOYER" -u "$RPC" | awk '{print $1}')"
say "Deployer balance: $BAL SOL"
if awk "BEGIN{exit !($BAL < 3)}"; then
  die "Need ~3 SOL to deploy (have $BAL). Fund $DEPLOYER_ADDR on devnet:
       - GitHub-authed: https://faucet.solana.com  (paste the address)
       - or: solana airdrop 2 $DEPLOYER_ADDR -u $RPC   (if not rate-limited)
     Then re-run ./bootstrap.sh"
fi

# 2. Deploy the program (uses the prebuilt .so; no rebuild) ------------------
say "Deploying prediction_escrow to devnet…"
solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KP" \
  -k "$DEPLOYER" -u "$RPC" \
  --commitment confirmed
say "Deployed: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# 3. Write app/.env.local (injects the throwaway devnet authority secret) ----
say "Writing app/.env.local…"
SECRET="$(cat "$DEPLOYER")"
cat > "$ROOT/app/.env.local" <<EOF
SOLANA_RPC_URL=$RPC
PREDICTION_ESCROW_PROGRAM_ID=$PROGRAM_ID
MUSDC_MINT=$MUSDC_MINT
MARKET_AUTHORITY_SECRET=$SECRET
MARKET_AUTHORITY_KEYPAIR_PATH=$DEPLOYER
DEPLOYER_KEYPAIR_PATH=$DEPLOYER
MUSDC_MINT_KEYPAIR_PATH=$MINT_KP
TXLINE_BASE_URL=https://txline-dev.txodds.com/api/
TXLINE_ORIGIN=https://txline-dev.txodds.com
TXLINE_GUEST_URL=https://txline-dev.txodds.com/auth/guest/start
TXLINE_AUTH_JWT=
TXLINE_API_TOKEN=
DATABASE_PATH=./matchcall.db
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID
NEXT_PUBLIC_MUSDC_MINT=$MUSDC_MINT
EOF

# 4. Provision mUSDC + on-chain config --------------------------------------
cd "$ROOT/app"
say "Creating the mUSDC test mint + minting supply to the deployer…"
npm run --silent mint:musdc
say "Initializing the on-chain platform config…"
npm run --silent market:init
say "Initializing the local SQLite store…"
npm run --silent db:init || true

# 5. Activate a live TxLINE session (subscribe + activate) -------------------
say "Activating a live TxLINE World Cup data session (subscribe + activate)…"
npm run --silent txline:activate

say "Bootstrap complete."
cat <<EOF

Next:
  cd app && npm run dev            # http://localhost:3000
  (separate shell) cd keeper && npm start   # automated settlement keeper

Program:  https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet
mUSDC:    https://explorer.solana.com/address/$MUSDC_MINT?cluster=devnet
EOF
