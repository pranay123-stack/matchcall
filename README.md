# MatchCall ⚽️🔗

**A live, trustlessly-settled World Cup prediction market on Solana devnet, backed by TxLINE.**

MatchCall lets anyone open a prediction market on a real World Cup fixture —
match winner, over/under goals, or both-teams-to-score — stake a devnet test
stablecoin (mUSDC), and watch odds and scores move live. When the final whistle
blows, the market **settles itself**: a keeper submits a cryptographic proof of
the final score, the on-chain program verifies it, and winners pull their
pari-mutuel payout. No trusted admin ever picks the winner.

> Program ID (devnet): `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2`
> mUSDC mint (devnet): `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j`

---

## The problem

Every prediction market has the same weak point: **who decides the outcome?**
Most rely on a trusted oracle, a multisig, or an operator who could resolve a
market wrong — by mistake or malice — and there's no way for stakers to prove it.

MatchCall removes that trust. TxLINE (TxODDS's sports-data feed) anchors a
Merkle root of every day's scores on Solana and exposes an on-chain
`validate_stat_v2` instruction that verifies a score against that root. MatchCall's
program **CPIs into `validate_stat_v2`** and derives the winning outcome *only*
from what TxLINE cryptographically proved. The market can resolve to exactly one
thing: the real final score. The keeper, the market creator, and the backend are
all untrusted — none of them can move the result.

---

## Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │                 TxLINE                       │
                         │  REST + SSE feed  ·  on-chain validate_stat  │
                         │  daily_scores_roots PDA (Merkle roots)       │
                         └───────▲───────────────────▲─────────────────┘
                                 │ proofs / scores    │ CPI verify
             fixtures, scores,   │                    │
             stat-validation     │                    │
                                 │                    │
   ┌──────────┐   REST/SSE  ┌────┴───────┐   tx   ┌───┴──────────────────┐
   │ Frontend │◄───────────►│  Backend   │◄──────►│  prediction_escrow   │
   │ Next.js  │  /api/*     │ Next.js API│        │  (Anchor program)    │
   │ wallet   │             │ + SQLite   │        │  markets · escrow ·  │
   └──────────┘             └────▲───────┘        │  positions · settle  │
                                 │                └──────────▲───────────┘
                       GET /api/markets                      │ settle_market
                       POST /api/keeper/settle               │ (permissionless)
                                 │                            │
                            ┌────┴───────┐   watch SSE   ─────┘
                            │  Keeper    │◄───────────── TxLINE /scores/stream
                            │ (this repo)│   detect full-time, capture seq
                            └────────────┘
```

- **Frontend** (`app/app`, `app/components`) — never sees TxLINE credentials;
  talks only to the backend. Shows live odds/implied-probability bars, score
  tickers, and lets a wallet stake and claim.
- **Backend** (`app/app/api`, `app/lib`, `scripts`) — proxies TxLINE, creates
  markets on-chain with the market authority, builds unsigned staking/claim
  transactions for the wallet to sign, and records settlement receipts.
- **On-chain** (`programs/prediction_escrow`) — holds stakes in a market-owned
  SPL escrow and settles trustlessly by CPI into TxLINE.
- **Keeper** (`keeper/`) — watches live scores and triggers settlement at
  full-time. See [`keeper/README.md`](keeper/README.md).

---

## Monorepo layout

```
matchcall/
├── app/                       # Next.js frontend + backend API routes + SQLite
│   ├── app/(pages)            #   frontend pages (frontend-owned)
│   ├── app/api/               #   backend HTTP/JSON + SSE proxy routes
│   ├── lib/                   #   backend: txline client, on-chain client, db
│   └── .env.local             #   server-side secrets (not committed)
├── programs/
│   └── prediction_escrow/     # Anchor 0.32.1 program (Rust)
├── keeper/                    # standalone settlement keeper (Node/TS) — this task
├── scripts/                   # devnet ops: activate, mint mUSDC, init config
├── docs/
│   ├── SPEC.md                # authoritative build contract
│   ├── TECHNICAL.md           # architecture + settlement CPI deep-dive
│   ├── FEEDBACK.md            # TxLINE API friction + highlights
│   └── DEMO_SCRIPT.md         # <=5 min demo video script
├── target/idl/                # Anchor IDL (after `anchor build`)
├── Anchor.toml
└── README.md                  # you are here
```

---

## Setup

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 18+ (native `fetch`, web streams) |
| Rust | stable (with the Solana BPF toolchain) |
| Solana CLI | 1.18+ |
| Anchor | **0.32.1** (`avm install 0.32.1 && avm use 0.32.1`) |

### 1. Install

```bash
git clone <repo> && cd matchcall
(cd app && npm install)
(cd keeper && npm install)
```

### 2. Build & deploy the program (devnet)

```bash
solana config set --url https://api.devnet.solana.com

# Fund the deployer (keypair in .keys/deployer.json). Airdrops are rate-limited;
# scripts/airdrop-loop.sh retries until funded.
solana airdrop 2 --keypair .keys/deployer.json
./scripts/airdrop-loop.sh          # optional: keep retrying to reach ~5 SOL

anchor build                        # writes target/idl/prediction_escrow.json
anchor deploy                       # deploys to DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2
```

The program ID is pinned in `Anchor.toml` and `declare_id!` — a fresh deploy
must reuse the same keypair or update both.

### 3. Configure env

Create `app/.env.local`:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
PREDICTION_ESCROW_PROGRAM_ID=DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2
MUSDC_MINT=EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j
MARKET_AUTHORITY_SECRET=[/* json byte array of the authority keypair */]
TXLINE_BASE_URL=https://txline-dev.txodds.com/api/
TXLINE_AUTH_JWT=          # filled by txline:activate
TXLINE_API_TOKEN=         # filled by txline:activate
DATABASE_PATH=./matchcall.db

NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2
NEXT_PUBLIC_MUSDC_MINT=EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j
```

### 4. Mint mUSDC (devnet test stablecoin)

```bash
cd app && npm run mint:musdc      # scripts/mint-musdc.ts — creates/mints EgkrEE…hv9j (6 dp)
```

### 5. Initialize the on-chain config

```bash
cd app && npm run market:init     # scripts/init-config.ts — initialize_config(stake_mint = mUSDC)
```

### 6. Activate the TxLINE World Cup free tier

Subscribes on the TxLINE devnet program (`subscribe(serviceLevelId=1, durationWeeks=4)`,
`selectedLeagues=[]`), then signs the activation message and writes
`TXLINE_AUTH_JWT` + `TXLINE_API_TOKEN` into `app/.env.local`:

```bash
cd app && npm run txline:activate
```

> The activation message for the empty-leagues free bundle is `${txSig}::${jwt}`
> (two colons — `selectedLeagues.join(",")` is empty). Devnet TxL airdrops are
> rate-limited; the subscribe step may need a retry. See [docs/FEEDBACK.md](docs/FEEDBACK.md).

### 7. Run

```bash
# terminal 1 — backend + frontend
cd app && npm run dev             # http://localhost:3000

# terminal 2 — settlement keeper
cd keeper && npm start
```

Open the app, create a market on a live/finished World Cup fixture, stake mUSDC,
and watch the keeper settle it at full-time.

---

## TxLINE endpoints used

Base `https://txline-dev.txodds.com/api/`; headers `Authorization: Bearer <jwt>`
and `X-Api-Token: <apiToken>`.

| Method | Endpoint | Used for |
| --- | --- | --- |
| `GET` | `/fixtures/snapshot?competitionId=<id>` | Upcoming/live World Cup fixtures for market creation |
| `GET` | `/scores/snapshot/{fixtureId}` | Current score (recovery) |
| `GET` | `/scores/historical/{fixtureId}` | Replay missed score events (recovery) |
| `GET` | `/scores/stream` (SSE) | Live scores; keeper detects full-time & tracks `seq` |
| `GET` | `/odds/stream` (SSE) · `/odds/snapshot/{fixtureId}` | Live odds / implied probability |
| `GET` | `/scores/stat-validation?fixtureId=&seq=&statKeys=1,2` | **Merkle proof** of the two full-game goal totals (V2) |
| `POST` | `https://txline-dev.txodds.com/auth/guest/start` | Guest JWT; renewed on `401` |
| `POST` | `https://txline-dev.txodds.com/api/token/activate` | Exchange wallet-signed subscription tx for the API token |
| `GET` | `https://txline.txodds.com/documentation/programs/devnet.md` | Fetch the TxLINE devnet IDL (setup/smoke-test only) |

TxLINE Solana program (`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`):
`subscribe` provisions the service; `validate_stat_v2` is CPI-called by our
program to verify the final score.

---

## How trustless settlement works

At full-time the keeper fetches the TxLINE Merkle proof for the two full-game
goal totals (`statKeys=1,2`) and submits `settle_market(payload)`. Inside the
program:

1. **The roots account is pinned to the proof, not the caller.** From the proof's
   own timestamp (`updateStats.minTimestamp`), the program derives the TxLINE
   `daily_scores_roots` PDA — seeds `["daily_scores_roots", u16_le(floor(ts_ms/86_400_000))]`
   — and requires the supplied account to equal it *and* be owned by the TxLINE
   program. A caller cannot substitute a forged roots account.
2. **The score is proven, not asserted.** The program builds an *exact-equality*
   strategy over the two proven leaves and CPIs into TxLINE `validate_stat_v2`.
   TxLINE re-hashes the leaves up to its anchored Merkle root and returns a
   `bool` via `get_return_data`. The program requires that bool to be `true`;
   otherwise settlement reverts.
3. **The winner is derived on-chain.** From the two proven goal values the program
   computes home/away goals and the winning outcome for the market type
   (match-winner / totals / BTTS). The caller supplies **no** outcome — the market
   can only resolve to the proven score. If nobody backed the proven outcome, the
   market flips to `Refunding` and every staker reclaims their stake.

Because the outcome is *derived from a cryptographic proof verified in the same
transaction*, settlement is permissionless: the keeper is only a fee-payer. See
[docs/TECHNICAL.md](docs/TECHNICAL.md) for the discriminator, payload layout, and
the reasoning behind CPI-ing into `validate_stat_v2` instead of re-verifying the
Merkle proof ourselves.

---

## License

Devnet hackathon project. Devnet SOL/mUSDC have no real-world value. A mainnet
release would require an audit, legal review, and multisig authority setup.
