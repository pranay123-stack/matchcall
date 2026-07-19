# MatchCall — Technical Documentation

## Core idea

MatchCall is a **trustlessly-settled** prediction market for World Cup fixtures on
Solana devnet. Users stake a devnet test stablecoin (mUSDC) on the outcome of a
real match. The novel part is settlement: instead of a trusted oracle deciding
who won, MatchCall's on-chain program verifies the final score against TxLINE's
Solana-anchored Merkle root **by CPI**, and derives the winning outcome from the
proven leaves. Nobody — not the market creator, not the backend, not the
keeper — can make a market resolve to anything other than the real final score.

Three market types are supported, all decided from the two full-game goal totals:

| Type | `market_type` | Outcomes | Decided by |
| --- | --- | --- | --- |
| Match winner | `0` | `0=Home 1=Draw 2=Away` | `home vs away goals` |
| Totals (O/U) | `1` | `0=Over 1=Under` | `(home+away)*2` vs `line_param` (odd, = line×2) |
| Both teams to score | `2` | `0=Yes 1=No` | `home>0 && away>0` |

Payouts are **pari-mutuel**: `payout = stake × total_pool / winning_pool` (floor),
so aggregate claims can never exceed the escrow. If nobody backed the proven
outcome the market becomes `Refunding` and every staker reclaims their stake.

---

## Architecture

### Components

- **Frontend (Next.js, `app/app` + `app/components`)** — wallet-driven UI. Reads
  markets, fixtures, live scores, and odds from the backend; builds no TxLINE
  calls and never holds credentials. Signs staking/claim transactions locally.
- **Backend (Next.js API routes, `app/app/api` + `app/lib`)** — the only holder
  of TxLINE credentials and the market authority key. Responsibilities:
  - Proxy/normalize TxLINE fixtures, scores (SSE), and odds.
  - Create markets on-chain (`create_market`) with the authority as payer.
  - Build **unsigned** transactions for `place_prediction` / `claim_payout` for
    the user's wallet to sign and send.
  - Record settlement receipts for `/api/markets/:id/receipt`.
  - (To add) `POST /api/keeper/settle` — the keeper's settlement entry point.
- **On-chain program (`programs/prediction_escrow`, Anchor 0.32.1)** — markets,
  a market-owned SPL escrow, per-(market,user,outcome) positions, and the
  proof-gated `settle_market`.
- **Keeper (`keeper/`)** — standalone Node/TS service. Watches TxLINE
  `/scores/stream`, detects full-time, and triggers settlement. See
  [`../keeper/README.md`](../keeper/README.md).

### On-chain accounts & PDAs (program `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2`)

| Account | Seeds | Notes |
| --- | --- | --- |
| `Config` | `["config"]` | admin, stake_mint (= mUSDC), paused, market_count |
| `Market` | `["market", market_seed]` | fixture id, type, line, outcome pools, status, result |
| escrow | ATA of `Market` for mUSDC | classic SPL Token program; holds all stakes |
| `Position` | `["position", market, user, [outcome]]` | per-user, per-outcome stake |

Instructions: `initialize_config`, `create_market`, `place_prediction`,
`settle_market`, `claim_payout`, `void_market` (admin emergency → Refunding),
`set_paused`.

### Data flow (happy path)

1. Backend lists World Cup fixtures from TxLINE `/fixtures/snapshot`.
2. Creator opens a market → backend sends `create_market` (fixture id,
   `participant1_is_home`, type, `line_param`, `lock_at`).
3. Users stake → backend returns an unsigned `place_prediction` tx; wallet signs;
   mUSDC moves user→escrow; a `Position` PDA records the stake.
4. Frontend streams live scores/odds via the backend's SSE proxy of
   `/scores/stream` and `/odds/stream`.
5. At full-time the keeper (watching the same stream) captures the fixture's
   latest score `seq`, and calls the backend to settle (or settles directly).
6. `settle_market` verifies the TxLINE proof by CPI, derives the outcome, sets
   `Settled`/`Refunding`.
7. Winners/refundees call `claim_payout`.

---

## TxLINE endpoints & auth flow

**Base:** `https://txline-dev.txodds.com/api/` · **Auth headers:**
`Authorization: Bearer <TXLINE_AUTH_JWT>`, `X-Api-Token: <TXLINE_API_TOKEN>`.

### Auth / setup flow

1. **Subscribe (on-chain).** Call the TxLINE devnet program's `subscribe(serviceLevelId=1, durationWeeks=4)`.
   The free World Cup bundle uses `selectedLeagues = []`. Requires a TxL token ATA
   (Token-2022) funded from the devnet faucet.
2. **Guest JWT.** `POST https://txline-dev.txodds.com/auth/guest/start` → `{ token }`.
3. **Activate.** Sign the exact message `${txSig}:${selectedLeagues.join(",")}:${jwt}`
   — for the free bundle this is `${txSig}::${jwt}` (two colons) — with the same
   wallet that sent the subscribe tx, then
   `POST https://txline-dev.txodds.com/api/token/activate` with
   `{ txSig, walletSignature(base64), leagues: [] }` and `Authorization: Bearer <jwt>`
   → the durable **API token**.
4. **Runtime.** All data calls send the Bearer JWT + `X-Api-Token`. On `401`, the
   client re-runs `guest/start` to renew the JWT and retries once.

### Data endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/fixtures/snapshot?competitionId=<id>` | Fixtures (teams, kickoff, ids, `participant1IsHome`) |
| `GET` | `/scores/snapshot/{fixtureId}` | Latest score record (recovery) |
| `GET` | `/scores/historical/{fixtureId}` | Score-event replay (recovery) |
| `GET` | `/scores/stream` (SSE) | Live score events; carries `seq`, status, goals |
| `GET` | `/odds/stream` (SSE) / `/odds/snapshot/{fixtureId}` | Live odds / implied probability |
| `GET` | `/scores/stat-validation?fixtureId=&seq=&statKeys=1,2` | **V2 Merkle proof** for stats 1 & 2 (full-game goals) |

The proof response carries: `summary { fixtureId, updateStats { updateCount,
minTimestamp, maxTimestamp }, eventStatsSubTreeRoot }`, `statsToProve[2]`,
`statProofs[2]`, `subTreeProof`, `mainTreeProof`, `eventStatRoot`. The backend/keeper
map this to the on-chain `TxlineStatValidationInput` payload (see below).

**Finality gate.** A stat proof only proves score *values*; MatchCall separately
waits for the documented terminal record — `game_finalised` with `statusId: 100`
and `period: 100` (or a terminal status code: `FT`, `END`, `FET`, `FPE`, `WET`,
`WPE`) — before settling, so a market never settles on an in-play scoreline.

---

## The settlement CPI in detail

`settle_market(payload: TxlineStatValidationInput)` — accounts: `cranker(signer)`,
`market(mut)`, `txline_program`, `daily_scores_merkle_roots`. It is
**permissionless**: the cranker is only a fee-payer.

### 1. Payload

`TxlineStatValidationInput` mirrors the TxLINE devnet IDL byte-for-byte so Borsh
re-encoding reproduces what `validate_stat_v2` expects:

```
TxlineStatValidationInput {
  ts: i64,                                  // == fixtureSummary.updateStats.minTimestamp
  fixtureSummary: {
    fixtureId: i64,
    updateStats: { updateCount: i32, minTimestamp: i64, maxTimestamp: i64 },
    eventsSubTreeRoot: [u8; 32],
  },
  fixtureProof:  ProofNode[],
  mainTreeProof: ProofNode[],
  eventStatRoot: [u8; 32],
  stats: [ { stat: { key: u32, value: i32, period: i32 }, statProof: ProofNode[] } ; 2 ],
}
ProofNode { hash: [u8; 32], isRightSibling: bool }
```

The caller must send **exactly two** stats: key `1` and key `2` (participant-1 and
participant-2 total goals), both `period = 0`. The program enforces this and the
`0 ≤ value ≤ 255` score bounds *before* spending compute on the CPI.

### 2. Pinning the roots account to the proof

```
epoch_day = floor(ts_ms / 86_400_000)                 // ts from the proof, NOT Date.now()
expected  = PDA(["daily_scores_roots", u16_le(epoch_day)], TXLINE_PROGRAM)
require   daily_scores_merkle_roots.key   == expected
require   daily_scores_merkle_roots.owner == TXLINE_PROGRAM
require   txline_program.key               == 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
```

Deriving the PDA from the **proof's own timestamp** is what makes the account
un-substitutable: a forged proof would have to hash to the root stored at *its
own* day's PDA, which only TxLINE writes.

### 3. The CPI

The program builds an **exact-equality strategy** — one `EqualTo` predicate per
proven stat, with the threshold set to that leaf's own value — so every score
leaf is constrained to a concrete number (the caller cannot leave a value open).
It then hand-encodes the TxLINE instruction:

```
data = discriminator(validate_stat_v2)   // [208,215,194,214,241,71,246,178]
     ++ borsh(payload)
     ++ borsh(strategy)
invoke(Instruction {
  program_id: TXLINE_PROGRAM,
  accounts:  [ daily_scores_merkle_roots (readonly) ],
  data,
})
```

### 4. The return-data bool check

TxLINE's `validate_stat_v2` re-hashes the leaves up to the anchored Merkle root
and reports the result via Solana's return-data mechanism. The program reads it
back and requires success:

```
let (program_id, data) = get_return_data().ok_or(TxlineDidNotReturn)?;
require program_id == TXLINE_PROGRAM;
require bool::try_from_slice(&data)? == true;      // else TxlineProofRejected -> revert
```

If TxLINE returns `false` (or nothing), settlement reverts and no funds move.

### 5. Deriving the winner on-chain

Only after a `true` result does the program read the proven goal values, map
participant-1/2 → home/away using `participant1_is_home`, and compute the winning
outcome for the market type. `winning_pool` is set to the proven outcome's stake;
if it is zero, the market becomes `Refunding`. **The caller never supplies the
outcome** — it is a pure function of the proven score.

---

## Design choice: CPI into `validate_stat_v2` vs. re-verifying the Merkle proof

We deliberately **CPI into TxLINE's `validate_stat_v2`** rather than
re-implementing Merkle verification inside `prediction_escrow`. Reasons:

- **One source of truth.** TxLINE owns the tree construction, leaf hashing,
  domain separation, and the `daily_scores_roots` account it writes. Re-deriving
  that hashing scheme in our program risks a subtle mismatch (byte order, leaf
  framing, sub-tree composition) that would either reject valid proofs or, worse,
  accept malformed ones. CPI reuses TxLINE's own verified logic verbatim.
- **The proof is confirmed CPI-callable.** `validate_stat_v2` returns its result
  via `get_return_data` (a `bool`), which is exactly the pattern a CPI caller can
  consume in the same transaction — no logs-scraping or account side-effects.
- **Upgrade safety.** If TxLINE evolves its tree layout, our program keeps working
  as long as the instruction interface is stable; we don't ship a second copy of
  their crypto that could drift out of sync.
- **Smaller trusted surface + lower CU risk in our code.** Our program only pins
  the program id, pins the roots PDA to the proof timestamp, enforces the exact
  two-stat shape, and checks a bool. The heavy hashing runs in TxLINE's audited
  program. (Settlement still requests a raised compute-unit limit for the CPI.)

The trade-off is a hard dependency on the TxLINE devnet program id and its IDL
discriminator, both pinned as constants and swappable for a reviewed mainnet
address. Given the goal — *the market can only resolve to what TxLINE
cryptographically proved* — reusing TxLINE's verifier is the correct trust
boundary.

---

## Idempotency, safety & failure modes

- **Idempotent settlement.** `settle_market` requires `status == Open`; a second
  attempt reverts. The keeper additionally skips markets already
  `SETTLED`/`REFUNDING` and guards against concurrent submits.
- **No operator withdrawal.** The program has only winner-claim and refund paths;
  there is no instruction that moves escrow to an operator. `void_market` (admin)
  can only flip an open market to `Refunding`.
- **Lock enforcement.** `place_prediction` rejects after `lock_at`; `settle_market`
  rejects before it.
- **Refund on empty outcome.** If the proven outcome has zero stake, everyone is
  refunded rather than funds being stranded.
- **Devnet only.** mUSDC and SOL have no value. Mainnet would require an audit,
  legal review, and multisig authority.
