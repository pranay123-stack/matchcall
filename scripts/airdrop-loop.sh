#!/bin/bash
KP="/home/pranay-hft/Desktop/6.Hackathon/matchcall/.keys/deployer.json"
ADDR=$(solana address -k "$KP")
RPCS=(
  "https://api.devnet.solana.com"
)
target=2.0
for attempt in $(seq 1 200); do
  bal=$(solana balance -k "$KP" -u https://api.devnet.solana.com 2>/dev/null | awk '{print $1}')
  if awk "BEGIN{exit !($bal >= $target)}" 2>/dev/null; then
    echo "FUNDED: $bal SOL after $attempt attempts"; exit 0
  fi
  for rpc in "${RPCS[@]}"; do
    solana airdrop 1 "$ADDR" -u "$rpc" >/dev/null 2>&1 && echo "airdrop ok via $rpc (attempt $attempt)" && break
  done
  sleep 30
done
echo "GAVE UP. final balance: $(solana balance -k "$KP" 2>/dev/null)"
