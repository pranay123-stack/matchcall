// MatchCall — demo seed.
//
// Prepares a repeatable demo: picks a World Cup fixture (a FINISHED one, so it
// has a TxLINE game_finalised record the keeper can settle against), creates a
// Match Winner market with a short lock window, records it in the DB so the UI
// shows it, and seeds a small pool by staking from the platform authority on a
// couple of outcomes. You then stake live from Phantom on camera; when the lock
// passes the keeper auto-settles (or: curl -X POST /api/markets/<id>/settle).
//
// Run from app/:  npm run demo:seed            (auto-picks a finished fixture)
//                 npm run demo:seed -- <fixtureId> <lockSeconds>
//
// Imports only from app/lib so node_module resolution happens inside app/.
import { txlineClient } from "../app/lib/txline/client.js";
import {
  authorityKeypair,
  createMarket,
  placePredictionSigned,
  MARKET_MATCH_WINNER,
  outcomeLabels,
} from "../app/lib/onchain/program.js";
import { airdropMusdc } from "../app/lib/onchain/musdc.js";
import { initDb, insertMarket, upsertPosition, getMarket } from "../app/lib/db.js";

const WANTED_FIXTURE = process.argv[2];
const LOCK_SECONDS = Number(process.argv[3] ?? 120);

async function pickFixture() {
  const fixtures = await txlineClient.fixtures();
  if (WANTED_FIXTURE) {
    const f = fixtures.find((x) => x.id === WANTED_FIXTURE);
    if (!f) throw new Error(`Fixture ${WANTED_FIXTURE} not found in the TxLINE snapshot`);
    return f;
  }
  const numeric = fixtures.filter((f) => /^\d+$/.test(f.id));
  const finished = numeric.find((f) => /finish|full|end|ft/i.test(f.status));
  const chosen = finished ?? numeric[0];
  if (!chosen) {
    throw new Error(
      "No numeric-id World Cup fixtures available from TxLINE yet. " +
        "Run ./bootstrap.sh first (activates live data), or pass a fixtureId explicitly."
    );
  }
  return chosen;
}

async function main() {
  initDb();
  const authority = authorityKeypair();
  const wallet = authority.publicKey.toBase58();

  const fixture = await pickFixture();
  console.log(`Fixture ${fixture.id}: ${fixture.homeTeam} vs ${fixture.awayTeam} (${fixture.status})`);

  const marketType = MARKET_MATCH_WINNER;
  const lineParam = 0;
  const id = `${fixture.id}:${marketType}:${lineParam}`;
  const lockAt = Math.floor(Date.now() / 1000) + LOCK_SECONDS;

  let market = getMarket(id);
  if (!market) {
    const created = await createMarket({
      id,
      txlineFixtureId: Number(fixture.id),
      participant1IsHome: fixture.participant1IsHome,
      marketType,
      lineParam,
      lockAt,
    });
    market = insertMarket({
      id,
      fixtureId: fixture.id,
      marketType,
      lineParam,
      lockAt,
      participant1IsHome: fixture.participant1IsHome,
      marketPda: created.marketPda,
      escrow: created.escrow,
      seedHex: created.seedHex,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
    });
    console.log(`Created market ${id} -> ${created.marketPda} (sig ${created.signature})`);
  } else {
    console.log(`Market ${id} already exists at ${market.marketPda}`);
  }

  // Fund the authority with mUSDC and seed a small pool across two outcomes.
  await airdropMusdc(wallet, 500);
  const labels = outcomeLabels(marketType);
  for (const [outcome, amount] of [[0, 50], [2, 30]] as const) {
    try {
      const sig = await placePredictionSigned({ marketPda: market.marketPda, outcome, amount });
      upsertPosition({ marketId: id, wallet, outcome, amount: amount * 1_000_000, signature: sig });
      console.log(`Seeded ${amount} mUSDC on "${labels[outcome]}" (${sig})`);
    } catch (e) {
      console.warn(`Could not seed outcome ${outcome}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\n✅ Demo ready.");
  console.log(`   Market UI:  http://localhost:3000/markets/${encodeURIComponent(id)}`);
  console.log(`   Fixture UI: http://localhost:3000/fixtures/${fixture.id}`);
  console.log(`   Locks in ~${LOCK_SECONDS}s. After lock the keeper auto-settles, or force it:`);
  console.log(`   curl -X POST http://localhost:3000/api/markets/${encodeURIComponent(id)}/settle`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
