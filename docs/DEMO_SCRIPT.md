# MatchCall — Demo Video Script (≤ 5 minutes)

**Goal:** show that MatchCall settles a real prediction market **trustlessly** —
the outcome comes from a TxLINE cryptographic proof verified on-chain, not from
any operator. Keep it fast; let the automatic settlement be the "wow" moment.

> Placeholders in `[[ ]]` are for the presenter to fill in live.
> Total budget ≈ 4:30, leaving buffer.

---

## 0:00–0:35 · The problem (hook)

**On screen:** title card "MatchCall — trustless World Cup prediction markets on Solana".

> "Every prediction market has one weak spot: *who decides who won?* Usually a
> trusted oracle or an admin — and if they resolve it wrong, you just have to
> trust them. MatchCall removes that trust entirely. The winner is decided by a
> cryptographic proof of the real final score, verified on-chain. Let me show you."

**Presenter action:** none — talking-head or title card.

---

## 0:35–1:20 · Create a market

**On screen:** the MatchCall app (`http://localhost:3000`), fixtures list.

> "These are live World Cup fixtures, streamed from TxLINE. I'll open a market on
> `[[ HOME TEAM ]]` vs `[[ AWAY TEAM ]]` — let's do a Match-Winner market."

**Presenter action:**
1. Pick fixture `[[ fixture name ]]`.
2. Choose market type **Match Winner**, set lock time `[[ lock time ]]`.
3. Click **Create market** → approve the backend tx / show the toast.
4. Point at the new market card: `marketPda = [[ market PDA ]]`.

> "That created an on-chain market — a market-owned mUSDC escrow, permissionlessly.
> Note: no one here can pick the winner later."

---

## 1:20–2:10 · Live odds & scores, and place a stake

**On screen:** the market detail page with implied-probability bars and the live
score ticker.

> "The bars are implied probability from TxLINE's live odds; the score ticker is
> the live `/scores/stream`. I'll stake `[[ amount ]]` mUSDC on `[[ outcome ]]`."

**Presenter action:**
1. Connect wallet `[[ wallet ]]`.
2. Enter stake, click **Predict** → sign in wallet → show confirmation.
3. (Optional) switch to a second wallet and stake the *other* outcome so there's a
   real pool. Show the pool totals updating.

> "Funds are now in the program escrow. After lock time, no more bets — and
> settlement is gated on a proof. Watch what happens at full-time."

---

## 2:10–3:30 · Automatic keeper-triggered settlement (the payoff)

**On screen:** split view — the app on one side, the **keeper terminal** on the other.

> "Over here is the keeper. It's watching the *same* TxLINE score stream, waiting
> for the final whistle. It's untrusted — it can only pay the transaction fee."

**Presenter action:**
1. `[[ Trigger / reach full-time — e.g. use the finished/replayable fixture so the
   stream emits `game_finalised` statusId 100 period 100 ]]`.
2. Point at the keeper log lines as they appear:
   - `fixture [[id]] reached FULL-TIME [[H]]-[[A]] (seq [[seq]] …)`
   - `fixture [[id]] FT -> settling market [[id]] (seq [[seq]])`
   - `... -> tx [[signature]] via backend`

> "The keeper detected full-time, grabbed the score sequence, and asked the
> backend to settle. The program then CPI-ed into TxLINE's `validate_stat_v2`,
> verified the final score against TxLINE's on-chain Merkle root, and **derived**
> the winning outcome from the proof. The market just flipped to SETTLED."

**Presenter action:** switch to the app; show the market now **SETTLED** with the
final score and winning outcome `[[ outcome ]]`.

---

## 3:30–4:10 · Verifiable receipt + claim

**On screen:** the market receipt view (`/api/markets/[[id]]/receipt`) and/or the
Solana explorer for `[[ settle signature ]]`.

> "This isn't 'trust us' — here's the receipt: the settlement signature, the final
> `[[H]]-[[A]]` score, the winning outcome, and the Merkle proof root that TxLINE
> verified. Anyone can re-check it on-chain."

**Presenter action:**
1. Show `[[ settle signature ]]` on `explorer.solana.com/?cluster=devnet` — point
   at the `validate_stat_v2` inner instruction (the CPI) in the tx.
2. Back in the app, click **Claim** as the winning wallet → sign → show the
   pari-mutuel payout arrive.

> "Winners pull their pari-mutuel share directly from escrow. If nobody had called
> the proven outcome, everyone would get an automatic refund instead."

---

## 4:10–4:30 · Data-flow recap & close

**On screen:** the architecture diagram (from the README).

> "So, end to end: TxLINE streams live scores and anchors daily Merkle roots on
> Solana. Our keeper spots full-time and triggers settlement. Our program verifies
> the score by CPI-ing into TxLINE's verifier and derives the winner from the proof
> — the market can *only* resolve to the real score. Trustless settlement, live,
> on Solana. That's MatchCall."

**On screen (end card):**
- Program: `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2`
- mUSDC: `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j`
- `[[ repo / links ]]`

---

## Pre-flight checklist (presenter)

- [ ] Backend + frontend running (`cd app && npm run dev`).
- [ ] Keeper running in a visible terminal (`cd keeper && npm start`).
- [ ] TxLINE token activated (`TXLINE_AUTH_JWT` / `TXLINE_API_TOKEN` set).
- [ ] mUSDC minted to `[[ demo wallets ]]`; both wallets have devnet SOL for fees.
- [ ] A fixture that will reach full-time during the demo (a finished/replayable
      fixture that emits `game_finalised` is safest).
- [ ] Explorer tab pre-opened on devnet.
- [ ] Zoom/legibility: terminal font large enough to read the keeper decision logs.
