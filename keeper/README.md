# MatchCall Keeper

The keeper is a small, standalone Node/TypeScript service that makes MatchCall
markets **settle themselves**. It watches TxLINE's live score stream, notices
when a fixture reaches full-time, and triggers the trustless on-chain settlement
of every open market for that fixture — no human in the loop.

Settlement is **permissionless**: the keeper is just a payer/cranker. The
`prediction_escrow` program derives the winning outcome from a TxLINE Merkle
proof it verifies by CPI, so the keeper can never influence the result.

---

## What it does

1. **Loads the same env as the backend** from `app/.env.local`
   (`SOLANA_RPC_URL`, `PREDICTION_ESCROW_PROGRAM_ID`, `MUSDC_MINT`,
   `MARKET_AUTHORITY_SECRET`, `TXLINE_BASE_URL`, `TXLINE_AUTH_JWT`,
   `TXLINE_API_TOKEN`).
2. **Polls the backend** `GET {KEEPER_API_BASE}/api/markets` on an interval and
   selects `OPEN` markets whose `lockAt` has passed.
3. **Watches the TxLINE SSE stream** `GET {TXLINE_BASE_URL}scores/stream` and
   tracks, per fixture, the latest score **`seq`** and whether the fixture has
   reached a terminal / finalised state (full-time whistle: `statusId 100`
   & `period 100`, or a terminal status code such as `FT`, `END`, `FET`…).
4. **Settles** each finalised fixture's open markets:
   - **Primary path** — `POST {KEEPER_API_BASE}/api/keeper/settle {marketId, seq}`.
     The backend fetches the proof, CPIs into TxLINE `validate_stat_v2`, and
     records the settlement receipt. *(See "Backend route required" below.)*
   - **Fallback path** — if the backend route is missing or errors, and a local
     Anchor IDL + `MARKET_AUTHORITY_SECRET` are present, the keeper fetches the
     proof itself and submits `settle_market` directly with `@coral-xyz/anchor`.
5. **Robust & idempotent** — auto-reconnects the SSE stream with backoff, renews
   the guest JWT on `401`, skips markets already `SETTLED`/`REFUNDING`, guards
   against concurrent double-submits, and logs every decision.

---

## Settlement flow

```
  TxLINE /scores/stream (SSE)          Backend /api/markets
        │  game_finalised                     │  OPEN, lockAt passed
        │  statusId=100 period=100            │
        ▼                                     ▼
   FixtureTracker ── final? + latest seq ──► poll loop picks candidates
        │                                     │
        └──────────────► settleMarket(market, seq)
                                 │
                 ┌───────────────┴────────────────┐
                 ▼ primary                         ▼ fallback (best-effort)
     POST /api/keeper/settle          GET /scores/stat-validation?statKeys=1,2
        { marketId, seq }                          │  parse Merkle proof
                 │                                 ▼
                 │                        program.settleMarket(payload)
                 ▼                                 │
        backend CPIs validate_stat_v2 ◄───────────┘
                 │
                 ▼
   Market -> SETTLED (or REFUNDING if nobody backed the proven outcome)
   winning outcome DERIVED on-chain from the proven final score
```

Why is `seq` needed? The TxLINE proof endpoint (`/scores/stat-validation`)
requires a **real observed score sequence**. The keeper captures the latest
numeric `seq` for the fixture from the live stream and passes it through so the
proof is generated against the actual full-time record.

---

## Run it

Prerequisites: Node 18+ (native `fetch`/web streams), a running backend on
`http://localhost:3000`, and an activated TxLINE token in `app/.env.local`
(`npm run txline:activate` in `app/`).

```bash
cd keeper
npm install
npm start          # tsx src/index.ts
# or: npm run dev  # tsx watch (restarts on edit)
```

Type-check only: `npm run typecheck`.

The keeper reads env from (first match wins, `override:false`):
`keeper/.env.local` → `keeper/.env` → `app/.env.local` → `app/.env` → repo `.env.local`.
Point it elsewhere with `KEEPER_ENV_PATH=/abs/path/.env.local`.

---

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `KEEPER_API_BASE` | `http://localhost:3000` | Backend base URL for `/api/markets` and `/api/keeper/settle`. |
| `KEEPER_POLL_INTERVAL_MS` | `15000` | How often to poll for settleable markets. |
| `KEEPER_DIRECT_SETTLE` | `true` | Enable the direct on-chain fallback (needs IDL + authority key). |
| `KEEPER_ENV_PATH` | — | Explicit path to an env file. |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | RPC for the direct-settle fallback. |
| `PREDICTION_ESCROW_PROGRAM_ID` | `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2` | On-chain program. |
| `MUSDC_MINT` | `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j` | Stake mint. |
| `MARKET_AUTHORITY_SECRET` | — | JSON byte array; signer/payer for the direct-settle fallback. |
| `TXLINE_BASE_URL` | `https://txline-dev.txodds.com/api/` | TxLINE API base. |
| `TXLINE_AUTH_JWT` / `TXLINE_API_TOKEN` | — | TxLINE auth (from `txline:activate`). |

The direct-settle fallback loads the Anchor IDL from
`../target/idl/prediction_escrow.json` (produced by `anchor build`). If it is
missing, the fallback disables itself with a warning — it never crashes the keeper.

---

## Backend route required

The keeper is designed around one backend route that does not exist by default:

```
POST /api/keeper/settle
body: { "marketId": string, "seq": string }
->    { "signature": string }        # 200 on success
->    { "error": string }            # 4xx/5xx on failure
```

The backend should: look up the market, call
`txlineClient.scoreStatValidation(fixtureId, seq)`, parse the proof
(`parseTxlineScoreProof`), submit `settle_market` with the market authority, and
record the settlement receipt (so `/api/markets/:id/receipt` works). Until that
route ships, the keeper automatically uses its direct-settle fallback (given the
IDL and `MARKET_AUTHORITY_SECRET`), and retries the backend path every poll.
