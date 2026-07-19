# MatchCall — Shared Build Contract

MatchCall is a live, trustlessly-settled World Cup prediction market on Solana devnet,
backed by TxLINE (TxODDS's cryptographically-signed, Solana-anchored sports data feed).

Monorepo root: `/home/pranay-hft/Desktop/6.Hackathon/matchcall`

## Fixed on-chain / network values (devnet)
- prediction_escrow program ID: `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2`
- mUSDC stake mint (our own devnet SPL test token): `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j` (6 decimals)
- TxLINE devnet program ID: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- TxL token mint (devnet, DATA-AUTH ONLY — never staked): `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`
- RPC: `https://api.devnet.solana.com`
- TxLINE API base: `https://txline-dev.txodds.com/api/`
- TxLINE guest auth: `https://txline-dev.txodds.com/auth/guest/start`
- TxLINE activation: `https://txline-dev.txodds.com/api/token/activate`
- Free World Cup tier: SERVICE_LEVEL_ID=1, DURATION_WEEKS=4, SELECTED_LEAGUES=[]

Reference implementation files (READ THESE for exact shapes) live in:
`/tmp/claude-1000/-home-pranay-hft-Desktop/2d491cf4-d3b0-40c2-aed9-7f28744c3594/scratchpad/ref/`
(CalledIt: `backend_src_txline_client.ts`, `backend_src_market_txlineProof.ts`,
`backend_src_market_onchain.ts`, `scripts_txline-activate-devnet.mjs`, `devnet_programs.md`)

## prediction_escrow program interface (Anchor 0.32.1, IDL at `target/idl/prediction_escrow.json` after build)

Anchor discriminators = `sha256("global:<snake_ix_name>")[0..8]`. Account disc = `sha256("account:<Name>")[0..8]`.

PDAs (program = prediction_escrow):
- config:  seeds `["config"]`
- market:  seeds `["market", market_seed(32 bytes)]`
- escrow:  the market PDA's associated token account for the mUSDC mint (classic SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)
- position: seeds `["position", market_pubkey, user_pubkey, [outcome_u8]]`

Instructions:
1. `initialize_config()` — accounts: admin(signer,mut), config(pda,mut,init), stake_mint, system_program. Sets admin + stake_mint = mUSDC.
2. `create_market(market_seed: [u8;32], txline_fixture_id: i64, participant1_is_home: bool, market_type: u8, line_param: i32, lock_at: i64)`
   - accounts: creator(signer,mut), config, market(init), stake_mint(=config.stake_mint), escrow(init, ATA of market), token_program, associated_token_program, system_program
   - market_type: 0=MATCH_WINNER (outcomes 0=Home,1=Draw,2=Away), 1=TOTALS (0=Over,1=Under; line_param = line*2 and MUST be odd e.g. 5 for 2.5), 2=BTTS (0=Yes,1=No). line_param ignored unless TOTALS.
3. `place_prediction(outcome: u8, amount: u64)` — accounts: user(signer,mut), config, market(mut), escrow(mut, =market.escrow), user_token(mut, user's mUSDC ATA), position(init_if_needed), token_program, system_program. Transfers `amount` mUSDC user_token -> escrow.
4. `settle_market(payload: TxlineStatValidationInput)` — accounts: cranker(signer,mut), market(mut), txline_program(=TxLINE devnet id), daily_scores_merkle_roots(PDA of TxLINE prog: `["daily_scores_roots", u16_le(floor(ts_ms/86400000))]`). CPIs TxLINE validate_stat_v2 to verify final score, derives winning outcome. Permissionless.
5. `claim_payout()` — accounts: user(signer,mut), market(mut), escrow(mut), user_token(mut), position(mut), token_program. Pari-mutuel: payout = amount*total_pool/winning_pool (floor); refund = amount if Refunding.
6. `void_market()` admin-only emergency -> Refunding.

TxlineStatValidationInput (Borsh, same as reference `TxlineProofPayload`, must contain exactly the 2 total-goal stats key=1 & key=2, period=0):
```
{ ts: i64, fixtureSummary: { fixtureId: i64, updateStats: {updateCount: i32, minTimestamp: i64, maxTimestamp: i64}, eventsSubTreeRoot: [u8;32] },
  fixtureProof: ProofNode[], mainTreeProof: ProofNode[], eventStatRoot: [u8;32], stats: [{stat:{key:u32,value:i32,period:i32}, statProof: ProofNode[]}, ...2] }
ProofNode = { hash: [u8;32], isRightSibling: bool }
```
The on-chain program builds the "exact score" strategy itself; the TS caller only sends the payload.

## TxLINE data endpoints (base = API base above; headers: `Authorization: Bearer <jwt>`, `X-Api-Token: <apiToken>`)
- `GET /fixtures/snapshot?competitionId=<optional>` -> array of fixtures
- `GET /scores/snapshot/{fixtureId}` -> latest score record(s)
- `GET /scores/historical/{fixtureId}` -> array of score events
- `GET /scores/stat-validation?fixtureId=<n>&seq=<n>&statKeys=1,2` -> Merkle proof (V2). Response fields: `summary{fixtureId,updateStats{updateCount,minTimestamp,maxTimestamp},eventStatsSubTreeRoot}`, `statsToProve[2]`, `statProofs[2]`, `subTreeProof`, `mainTreeProof`, `eventStatRoot`.
- `GET /scores/stream` (SSE, Accept: text/event-stream) -> live score events
- `GET /odds/stream` (SSE) -> live odds events  (confirm path live; fall back to /odds/snapshot/{fixtureId})

## HTTP/JSON contract between backend (Next.js API routes) and frontend
Backend owns `app/lib/**`, `app/app/api/**`, `scripts/**`. Frontend owns `app/app/(pages)`, `app/components`, providers, `globals.css`. Keeper owns `keeper/**`.

Frontend NEVER calls TxLINE directly and NEVER sees credentials. It calls these routes:
- `GET  /api/fixtures` -> `{ fixtures: Fixture[] }` (live + upcoming World Cup fixtures, normalized)
- `GET  /api/markets` -> `{ markets: Market[] }`  (all markets from local DB + on-chain status)
- `GET  /api/markets/:id` -> `{ market: Market, positions: Position[] }`
- `POST /api/markets` body `{ fixtureId, marketType, lineParam?, lockAt }` -> creates market on-chain (backend authority pays), returns `{ market }`
- `GET  /api/fixtures/:id/scores` (SSE proxy) -> forwards TxLINE live scores for a fixture
- `GET  /api/fixtures/:id/odds` (SSE proxy) -> forwards TxLINE live odds/implied-probability
- `POST /api/predictions/intent` body `{ marketId, wallet, outcome, amount }` -> `{ transactionBase64, positionAddress, lastValidBlockHeight }` (unsigned tx for the wallet to sign & send)
- `POST /api/predictions/confirm` body `{ marketId, wallet, outcome, signature }` -> verifies on-chain, records in DB -> `{ ok: true, position }`
- `POST /api/claims/intent` body `{ marketId, wallet }` -> `{ transactionBase64 }`
- `GET  /api/markets/:id/receipt` -> `{ settlement: { signature, finalHomeGoals, finalAwayGoals, winningOutcome }, proof: { root, statProofs, mainTreeProof, ... }, explanation: string } | null`
- `GET  /api/health` -> `{ txline: bool, chain: bool, config: {...} }`

Types (shared, keep names stable):
```ts
type Fixture = { id: string; competition: string; homeTeam: string; awayTeam: string; participant1IsHome: boolean; kickoffAt: string|null; status: string; live: boolean; homeGoals?: number; awayGoals?: number; matchClock?: string|null };
type Market = { id: string; fixtureId: string; marketType: "MATCH_WINNER"|"TOTALS"|"BTTS"; lineParam: number|null; outcomes: {index:number;label:string;pool:number}[]; totalPool: number; lockAt: string; status: "OPEN"|"SETTLED"|"REFUNDING"; marketPda: string; escrow: string; winningOutcome?: number|null; finalHomeGoals?: number|null; finalAwayGoals?: number|null; settleSignature?: string|null };
type Position = { wallet: string; outcome: number; amount: number; claimed: boolean };
```

## Env (server-side only, `app/.env.local`)
`SOLANA_RPC_URL, PREDICTION_ESCROW_PROGRAM_ID, MUSDC_MINT, MARKET_AUTHORITY_SECRET (json array),
TXLINE_BASE_URL, TXLINE_AUTH_JWT, TXLINE_API_TOKEN, DATABASE_PATH`.
Public (frontend): `NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_PROGRAM_ID, NEXT_PUBLIC_MUSDC_MINT`.

## Design language (frontend)
Dark "stadium at night" theme. Tailwind config already defines `pitch.*` greens, `neon` accent, `gold`.
Polished, live-feeling: pulsing LIVE dots, implied-probability bars from odds, score tickers, glassy cards.
