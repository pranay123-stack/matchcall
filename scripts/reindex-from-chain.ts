// Rebuild the local SQLite index from on-chain truth. Run this once after a
// fresh deploy (empty DB) so the app shows every market + position that already
// exists on devnet — pools/status are then read live per request.
//
// Run from app/:  npm run reindex
import { scanChain, marketTypeName } from "../app/lib/onchain/program.js";
import { txlineClient } from "../app/lib/txline/client.js";
import { initDb, insertMarket, getMarket, setPosition } from "../app/lib/db.js";

function marketId(fixtureId: number, marketType: number, lineParam: number): string {
  const line = marketType === 1 ? lineParam : 0;
  return `${fixtureId}:${marketType}:${line}`;
}

async function main() {
  initDb();
  const { markets, positions } = await scanChain();
  console.log(`On-chain: ${markets.length} markets, ${positions.length} positions.`);

  // Best-effort team names from the live TxLINE fixtures snapshot.
  const teams = new Map<string, { home: string; away: string }>();
  try {
    for (const f of await txlineClient.fixtures()) {
      teams.set(String(f.id), { home: f.homeTeam, away: f.awayTeam });
    }
  } catch {
    /* creds may be absent; team names stay null */
  }

  const pdaToId = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  for (const m of markets) {
    const t = teams.get(String(m.txlineFixtureId));
    // When we have the live fixtures list, skip markets for unknown fixtures —
    // those are test-suite artifacts (create_market runs on fake fixture ids).
    if (teams.size > 0 && !t) {
      skipped += 1;
      continue;
    }
    const id = marketId(m.txlineFixtureId, m.marketType, m.lineParam);
    pdaToId.set(m.marketPda, id);
    if (getMarket(id)) continue;
    insertMarket({
      id,
      fixtureId: String(m.txlineFixtureId),
      marketType: m.marketType,
      lineParam: m.marketType === 1 ? m.lineParam : null,
      lockAt: m.lockAt,
      participant1IsHome: m.participant1IsHome,
      marketPda: m.marketPda,
      escrow: m.escrow,
      seedHex: m.seedHex,
      homeTeam: t?.home ?? null,
      awayTeam: t?.away ?? null,
    });
    created += 1;
    console.log(`  indexed ${marketTypeName(m.marketType)} on fixture ${m.txlineFixtureId} -> ${id}`);
  }

  let pos = 0;
  for (const p of positions) {
    const id = pdaToId.get(p.marketPda);
    if (!id) continue;
    setPosition({ marketId: id, wallet: p.wallet, outcome: p.outcome, amount: p.amount, signature: "", claimed: p.claimed });
    pos += 1;
  }

  console.log(
    `\n✅ Reindexed: ${created} new market rows, ${pos} positions` +
      (skipped ? ` (skipped ${skipped} test-fixture markets)` : "") +
      `. Existing rows left as-is.`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
