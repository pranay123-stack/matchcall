// MatchCall — assembles the SPEC-shaped Market/Position DTOs from the local DB
// index plus on-chain truth (pools, status, final score).
import { listPositions, type MarketRow, type PositionRow } from "./db.js";
import {
  fetchMarketOnchain,
  fromBaseUnits,
  marketTypeName,
  outcomeLabels,
  type OnchainMarket,
} from "./onchain/program.js";

export type MarketDTO = {
  id: string;
  fixtureId: string;
  marketType: "MATCH_WINNER" | "TOTALS" | "BTTS";
  lineParam: number | null;
  outcomes: { index: number; label: string; pool: number }[];
  totalPool: number;
  lockAt: string;
  status: "OPEN" | "SETTLED" | "REFUNDING";
  marketPda: string;
  escrow: string;
  winningOutcome?: number | null;
  finalHomeGoals?: number | null;
  finalAwayGoals?: number | null;
  settleSignature?: string | null;
};

export type PositionDTO = {
  wallet: string;
  outcome: number;
  amount: number;
  claimed: boolean;
};

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Merge a DB market row with live on-chain state (chain wins where it exists). */
export async function toMarketDTO(row: MarketRow): Promise<MarketDTO> {
  let chain: OnchainMarket | null = null;
  try {
    chain = await fetchMarketOnchain(row.marketPda);
  } catch {
    chain = null;
  }

  const marketType = marketTypeName(row.marketType);
  const labels = outcomeLabels(row.marketType);
  const status = (chain?.status ?? (row.status as MarketDTO["status"])) as MarketDTO["status"];

  const outcomes = labels.map((label, index) => ({
    index,
    label,
    pool: chain ? fromBaseUnits(chain.outcomeStakes[index] ?? 0n) : 0,
  }));
  const totalPool = chain
    ? fromBaseUnits(chain.totalPool)
    : outcomes.reduce((sum, o) => sum + o.pool, 0);

  return {
    id: row.id,
    fixtureId: row.fixtureId,
    marketType,
    lineParam: row.lineParam,
    outcomes,
    totalPool,
    lockAt: isoFromUnix(row.lockAt),
    status,
    marketPda: row.marketPda,
    escrow: row.escrow,
    winningOutcome: chain?.winningOutcome ?? row.winningOutcome ?? null,
    finalHomeGoals: chain?.finalHomeGoals ?? row.finalHomeGoals ?? null,
    finalAwayGoals: chain?.finalAwayGoals ?? row.finalAwayGoals ?? null,
    settleSignature: row.settleSignature ?? null,
  };
}

export function toPositionDTO(row: PositionRow): PositionDTO {
  return {
    wallet: row.wallet,
    outcome: row.outcome,
    amount: fromBaseUnits(BigInt(row.amount)),
    claimed: row.claimed === 1,
  };
}

export function positionsForMarket(marketId: string): PositionDTO[] {
  return listPositions(marketId).map(toPositionDTO);
}
