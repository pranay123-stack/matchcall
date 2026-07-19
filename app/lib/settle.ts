// MatchCall — high-level settlement: fetch a TxLINE final-score proof for a
// market's fixture, submit settle_market on-chain, and record the result +
// proof JSON in the local DB (so the receipt endpoint can explain it later).
//
// Settlement is permissionless; the keeper (or the demo settle route/script)
// calls this. It never trusts a caller-supplied score — the proof is fetched
// straight from TxLINE and the winning outcome is derived on-chain.
import { getMarket, recordSettlement, type MarketRow } from "./db.js";
import { settleMarketWithProof, outcomeLabels } from "./onchain/program.js";
import { parseTxlineScoreProof } from "./txline/proof.js";
import { isFinalisedScoreEvent, txlineClient } from "./txline/client.js";
import { recordActivity } from "./activity.js";

export type SettlementResult = {
  signature: string;
  finalHomeGoals: number;
  finalAwayGoals: number;
  winningOutcome: number;
};

/** Find the sequence of the final (game_finalised) score record for a fixture. */
async function findFinalSeq(fixtureId: string): Promise<string> {
  const events = await txlineClient.historical(fixtureId);
  const finalEvent =
    [...events].reverse().find(isFinalisedScoreEvent) ??
    (await txlineClient.liveScore(fixtureId));
  if (!finalEvent) throw new Error("No TxLINE score records available for this fixture");
  if (!isFinalisedScoreEvent(finalEvent)) {
    throw new Error("The fixture has not reached a TxLINE game_finalised record yet");
  }
  if (!finalEvent.seq) throw new Error("The final TxLINE score record is missing a sequence");
  return finalEvent.seq;
}

export async function settleMarketById(id: string): Promise<{ market: MarketRow; settlement: SettlementResult }> {
  const row = getMarket(id);
  if (!row) throw new Error(`Unknown market ${id}`);
  if (row.status !== "OPEN") throw new Error(`Market ${id} is already ${row.status}`);
  if (!/^\d+$/.test(row.fixtureId)) {
    throw new Error("Market fixture ID is not numeric and cannot be proof-settled");
  }

  const seq = await findFinalSeq(row.fixtureId);
  const rawProof = await txlineClient.statValidation(row.fixtureId, seq);
  const payload = parseTxlineScoreProof(rawProof);
  if (payload.fixtureSummary.fixtureId !== BigInt(row.fixtureId)) {
    throw new Error("TxLINE proof fixture does not match this market");
  }

  const settlement = await settleMarketWithProof({
    marketPda: row.marketPda,
    seedHex: row.seedHex,
    participant1IsHome: row.participant1IsHome === 1,
    marketType: row.marketType,
    lineParam: row.lineParam ?? 0,
    payload,
  });

  const updated = recordSettlement({
    id: row.id,
    winningOutcome: settlement.winningOutcome,
    finalHomeGoals: settlement.finalHomeGoals,
    finalAwayGoals: settlement.finalAwayGoals,
    settleSignature: settlement.signature,
    proofJson: JSON.stringify(rawProof),
  });

  const label = (t: number, l: number | null) =>
    t === 1 ? `Total Goals O/U ${((l ?? 0) / 2).toFixed(1)}` : t === 0 ? "Match Winner" : "Both Teams To Score";
  recordActivity({
    type: "market_settled",
    marketId: row.id,
    match: row.homeTeam && row.awayTeam ? `${row.homeTeam} vs ${row.awayTeam}` : `Fixture ${row.fixtureId}`,
    market: label(row.marketType, row.lineParam),
    finalScore: `${settlement.finalHomeGoals}–${settlement.finalAwayGoals}`,
    winner: outcomeLabels(row.marketType)[settlement.winningOutcome] ?? `#${settlement.winningOutcome}`,
    signature: settlement.signature,
  });

  return { market: updated ?? row, settlement };
}
