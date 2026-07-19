# MatchCall — Demo Video Script (≤ 5 minutes)

**Goal:** show a *real, live, deployed* prediction market that settles
**trustlessly** — the winner comes from a TxLINE cryptographic proof verified
on-chain, never from an operator.

**Live URL:** https://matchcall-production.up.railway.app
**Repo:** https://github.com/pranay123-stack/matchcall

> `[[ ]]` = fill in live. Total ≈ 4:40, leaving buffer.
> Everything below is the *real* app — no mockups.

---

## 0:00–0:30 · The problem (hook)

**On screen:** the live dashboard at the URL above.

> "Every prediction market has one weak spot — *who decides who won?* Usually a
> trusted oracle or an admin, and if they resolve it wrong, you just have to trust
> them. MatchCall removes that trust: the winner is decided by a cryptographic
> proof of the real final score, verified on-chain. And this is live on Solana
> devnet right now — here's the public URL."

---

## 0:30–1:15 · The product at a glance

**On screen:** scroll the dashboard slowly.

> "Live World Cup and international fixtures streamed from TxLINE. Real markets with
> real mUSDC pooled in on-chain escrow. This strip is live analytics — total
> volume, a top-predictors leaderboard, biggest markets — and this feed updates in
> real time as people stake."

**Presenter action:** point at:
1. The **stat tiles** (total volume, markets, predictions, stakers).
2. **Top predictors** + **Biggest markets** leaderboards.
3. The **Activity** feed (leave it visible — a stake will appear here shortly).
4. The nav tabs: **Fixtures · Markets · Positions · Receipts · How it works**.

---

## 1:15–2:15 · Connect, fund, and stake (the core loop)

**On screen:** Fixtures tab → open **Spain vs Argentina** (or **Australia vs Brazil**).

> "I'll open a fixture. Here's the live score header and an implied-probability odds
> panel. Below are the markets on this match — Match Winner, Total Goals, Both Teams
> To Score — all of which settle from the final score."

**Presenter action:**
1. Click **Select Wallet → Phantom → Connect** (Phantom set to **Devnet**).
2. Open a market → click **"Get test mUSDC"**.
   > "One click gives me test mUSDC *and* a little devnet SOL for gas — so anyone
   > can try this with a fresh wallet, zero setup."
3. Pick an outcome, enter `[[ amount ]]`, click **Stake prediction** → approve in Phantom.
4. Cut back to the **dashboard** — point at the **Activity feed**:
   > "There's my stake, live, the instant it landed on-chain."

> "That mUSDC is now locked in the market's program-owned escrow. No admin can
> touch it, and no one can pick the winner later."

---

## 2:15–3:15 · How settlement works — trustless, and automatic

**On screen:** the **How it works** tab.

> "Here's the part that matters. When a match hits full-time, TxLINE publishes a
> Merkle proof of the final score, and anchors the day's root on Solana. Our keeper
> spots the final whistle, fetches that proof, and calls `settle_market` — which
> **CPIs into TxLINE's on-chain `validate_stat_v2`**. That instruction re-folds the
> proof to the anchored root; the transaction only confirms if it matches. The
> winning outcome is *derived from the proof* — the caller supplies nothing. The
> market can only ever resolve to the real score."

**Presenter action:**
1. Walk the 4-step flow on the How-it-works page (TxLINE → root on Solana → CPI → payout).
2. (Optional) show the **keeper status badge** on the dashboard reading **"live · watching N fixtures"** — *(run `cd keeper && KEEPER_API_BASE=https://matchcall-production.up.railway.app npm start` before recording to make it green)*.

> "And this isn't hand-waving — it's tested."

**On screen:** terminal, quickly:
```
cd app && npm run test:settlement     # 8 passing — detection, proof parsing, outcomes
cd tests && npm test                  # 6 passing on devnet — incl. the CPI settlement guards
```

---

## 3:15–4:00 · The verifiable receipt

**On screen:** the **Receipts** tab → open a market's receipt.

> "Every settled market gets a receipt: the final score TxLINE proved, the Merkle
> proof root and path, and the on-chain settlement transaction — with a
> 'verify it yourself' panel and a link straight to the settlement tx on Solana
> Explorer, where you can see the `daily_scores_roots` account it checked against."

**Presenter action:**
- Show the 3-step receipt layout (score → proof → on-chain tx) and the **Verify on-chain** footer links (program, mUSDC, TxLINE oracle).

> *(If a fixture has reached full-time during recording, show the keeper's log line
> `fixture … FT -> settling market … -> tx …`, the market flipped to SETTLED, and
> click **Claim** for the pari-mutuel payout. Otherwise, narrate that settlement
> fires automatically at full-time — the keeper is watching now.)*

---

## 4:00–4:30 · Recap & close

**On screen:** the dashboard / the architecture diagram from the README.

> "End to end: TxLINE streams live scores and anchors Merkle roots on Solana. Our
> keeper spots full-time and triggers settlement. Our program verifies the score by
> CPI-ing into TxLINE's verifier and derives the winner from the proof — so a market
> can *only* resolve to what was cryptographically proven. Deployed, live, and
> trustlessly settled. That's MatchCall."

**End card:**
- Live: `matchcall-production.up.railway.app`
- Repo: `github.com/pranay123-stack/matchcall`
- Program: `DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2` · mUSDC: `EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j`

---

## Pre-flight checklist

- [ ] Live URL loads and shows the 5 markets: https://matchcall-production.up.railway.app
- [ ] Phantom installed, set to **Devnet**, connected.
- [ ] *(Optional, for the green keeper badge)* keeper running locally pointed at the URL:
      `cd keeper && KEEPER_API_BASE=https://matchcall-production.up.railway.app npm start`
- [ ] Terminal ready with `npm run test:settlement` + `npm test` to show green.
- [ ] Solana Explorer tab pre-opened on **devnet**.
- [ ] Screen/font legible; the Activity feed and keeper badge visible on the dashboard.
- [ ] *(Bonus)* if any fixture is near full-time, keep the keeper terminal on screen to
      capture the real settlement + claim.

> Note on settlement: TxLINE only issues a `game_finalised` Merkle proof once a
> match actually ends. If none finish during recording, lean on the How-it-works
> page + the 14 passing tests + the receipt structure — the mechanism is proven;
> the live keeper completes it automatically at full-time.
