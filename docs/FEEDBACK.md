# TxLINE API — Integration Feedback

Notes captured while building MatchCall against the TxLINE devnet feed and
Solana programs. Framed constructively — TxLINE's Solana-anchored proofs are a
genuinely strong primitive, and most of the friction below is documentation and
developer-experience polish rather than protocol issues.

## Highlights (what worked well)

- **On-chain `validate_stat_v2` is the right primitive.** A verifier instruction
  that returns a `bool` via `get_return_data` is exactly what a settling program
  needs — we could CPI into it and gate settlement on the result without
  re-implementing any Merkle logic. This is the feature that made trustless
  settlement possible.
- **The daily-roots PDA design is clean.** Deriving the roots account from the
  proof timestamp (`["daily_scores_roots", u16_le(epochDay)]`) means the proof is
  self-describing — we never have to trust the caller to pass the right account.
- **Guest auth + JWT renewal is smooth.** `auth/guest/start` returning a token and
  a simple `401 → renew → retry` loop made the SSE client resilient with very
  little code.
- **Stable statKeys ordering for V2 strategies.** Because `statKeys=1,2` maps
  positionally to strategy indexes, building an exact-equality strategy over the
  two goal leaves was deterministic and easy to reason about.

## Friction points (with suggested fixes)

1. **Two documentation hosts are easy to confuse.** The docs index and IDL live on
   `txline-docs.txodds.com` / `txline.txodds.com/documentation`, while the API and
   auth live on `txline-dev.txodds.com`. We briefly pointed API calls at the docs
   host. *Suggestion:* a one-line "hosts at a glance" table at the top of every
   page (docs host vs. devnet API host vs. mainnet API host).

2. **Devnet TxL airdrop rate-limits block `subscribe`.** Activation needs a funded
   TxL (Token-2022) ATA, but the devnet faucet is rate-limited, so the first
   `subscribe` frequently fails until a retry succeeds. *Suggestion:* document the
   expected faucet limits and recommend a retry/backoff, or provide a pre-funded
   devnet faucet for the free World Cup tier.

3. **The empty-leagues activation message has a "two-colon" gotcha.** For the free
   bundle `selectedLeagues = []`, so `${txSig}:${selectedLeagues.join(",")}:${jwt}`
   collapses to `${txSig}::${jwt}`. It's easy to accidentally strip the empty
   segment and sign the wrong message, which fails activation opaquely.
   *Suggestion:* call this out explicitly with the literal `${txSig}::${jwt}`
   example (the devnet page does; the quickstart could mirror it), and return a
   more specific error than a generic activation failure on message mismatch.

4. **`statKey` vs `statKeys` selects different on-chain shapes.**
   `/scores/stat-validation?...&statKey=...` maps to `validateStat` while
   `...&statKeys=1,2` maps to `validateStatV2`, and the two produce different
   payload structures. Mixing them up yields a payload the V2 instruction rejects.
   *Suggestion:* make the response echo which validation shape it is for (e.g. a
   `"validator": "validateStatV2"` field), so clients can assert they built the
   matching payload.

5. **The epoch-day derivation must come from the proof timestamp, not `Date.now()`.**
   The correct source is `summary.updateStats.minTimestamp` (ms) →
   `floor(ts/86_400_000)` as a `u16` LE seed. Using wall-clock time silently
   derives the wrong `daily_scores_roots` PDA and the CPI fails. The devnet page
   warns about this, but it's the single easiest mistake to make. *Suggestion:*
   keep that warning prominent and, ideally, include the derived roots pubkey in
   the proof response so clients can cross-check.

6. **The IDL is delivered as a markdown code block.** The devnet program IDL is
   embedded inside `documentation/programs/devnet.md` and has to be scraped with a
   ` ```json ` regex. That's brittle — a fenced-language change or surrounding
   prose edit breaks the parser. *Suggestion:* serve the raw IDL at a stable JSON
   URL (e.g. `/programs/devnet/idl.json`) alongside the markdown.

7. **The `validate_stat_v2` return value is an undocumented bare bool.** We rely on
   `get_return_data()` yielding a Borsh `bool`. This works, but it's discovered by
   reading the program rather than documented. *Suggestion:* document the
   return-data contract (type, encoding, and that `false`/absent means rejected)
   so CPI integrators can depend on it confidently.

8. **Response field casing/aliases vary.** Across snapshot, stream, and validation
   responses, the same concept appears under different keys (`fixtureId` vs
   `FixtureId`, `minTimestamp` vs `min_timestamp`, `eventStatsSubTreeRoot` vs
   `eventsSubTreeRoot`, byte fields as base64/hex/array/Buffer-JSON). We had to
   write tolerant pickers that try several aliases. *Suggestion:* commit to one
   casing per transport and document byte encodings (hex vs base64) per field.

## Net

The cryptographic core — anchored daily roots + a CPI-callable verifier returning
a bool — is excellent and is what let us build genuinely trustless settlement. The
remaining friction is almost entirely documentation clarity (host separation,
activation-message and epoch-day gotchas, IDL delivery, return-data contract, and
field-casing consistency). Tightening those would meaningfully shorten the first
integration.
