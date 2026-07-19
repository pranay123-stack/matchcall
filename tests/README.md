# MatchCall — on-chain test suite

Integration tests for the `prediction_escrow` Anchor program, run against the
**already-deployed devnet program** rather than a local validator.

- Program: `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2`
- mUSDC mint: `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j`
- RPC: `https://api.devnet.solana.com`
- Player/authority: the funded deployer keypair at `../.keys/deployer.json`

## Why client tests (not `anchor test`)

`anchor build` / `anchor test` are currently broken by an `edition2024`
toolchain mismatch, and the program is *already live on devnet*. These are pure
`@solana/web3.js` client tests — the exact code path the app and keeper use in
production — so they need **no build and no redeploy**. `tests/onchain.ts`
mirrors the manual Borsh encoders, Anchor discriminators, and PDA derivations
from `app/lib/onchain/program.ts` (the source of truth).

## Run

```bash
cd tests
npm install      # one-time; installs web3.js, spl-token, mocha, chai, ts-mocha
npm test
```

Requirements: Node 20+, network access to devnet, and a funded
`.keys/deployer.json` (it pays fees and mints itself throwaway mUSDC — it is the
mint authority). Tests are **idempotent**: every market uses a unique seed
derived from a per-run timestamp, so re-runs never collide.

## What is covered

| Test | Instruction | Asserts |
|------|-------------|---------|
| config decodes | (read) | config PDA exists; `stake_mint == mUSDC`; not paused |
| create_market | `create_market` | Market decodes: `OPEN`, `MATCH_WINNER`, `num_outcomes == 3`, fixtureId/lock match, `escrow` == market ATA |
| place_prediction | `place_prediction` | Position decodes (amount, outcome); escrow token balance increases; pool + outcome stake update |
| guard: settle before lock | `settle_market` | reverts `MarketStillOpen` |
| guard: stake after lock | `place_prediction` | reverts `MarketLocked` |
| guard: wrong TxLINE program | `settle_market` | reverts `InvalidTxlineProgram` |

The negative settlement tests supply a structurally-valid but **fake** proof
payload and/or a bogus TxLINE program account. Each guard we test reverts
*before* the proof is ever verified, so these exercise the settlement guards
without needing a real Merkle proof.

## NOT covered here: the settle_market happy path

Successful settlement (`settle_market` -> `Settled`/`Refunding`, then
`claim_payout`) requires a **real TxLINE `game_finalised` Merkle proof**. That
proof only exists after a fixture actually finishes and TxLINE anchors its daily
score roots on-chain, where the program CPIs into TxLINE's `validate_stat_v2`
and derives the winning outcome from the proven leaves. It cannot be
synthesized in a unit test, so the full happy path is exercised by the
**keeper** (`keeper/`) and the **live demo** (`docs/DEMO_SCRIPT.md`) against a
finished fixture — not here.
