import { json, fail } from "@/lib/http";
import { listMarkets, listAllPositions } from "@/lib/db";
import { toMarketDTO } from "@/lib/marketView";
import { fromBaseUnits } from "@/lib/onchain/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform analytics + leaderboards, computed from the DB index (+ on-chain pools
// via toMarketDTO for the biggest-markets list).
export async function GET() {
  try {
    const marketRows = listMarkets();
    const positions = listAllPositions();

    const totalVolume = positions.reduce((s, p) => s + fromBaseUnits(BigInt(p.amount)), 0);
    const stakers = new Set(positions.map((p) => p.wallet));

    // Top predictors by total staked (with bet count).
    const byWallet = new Map<string, { staked: number; bets: number }>();
    for (const p of positions) {
      const e = byWallet.get(p.wallet) ?? { staked: 0, bets: 0 };
      e.staked += fromBaseUnits(BigInt(p.amount));
      e.bets += 1;
      byWallet.set(p.wallet, e);
    }
    const topPredictors = [...byWallet.entries()]
      .map(([wallet, v]) => ({ wallet, ...v }))
      .sort((a, b) => b.staked - a.staked)
      .slice(0, 5);

    // Biggest markets by pool (reads on-chain pools).
    const markets = await Promise.all(marketRows.map(toMarketDTO));
    const biggestMarkets = [...markets]
      .sort((a, b) => b.totalPool - a.totalPool)
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        marketType: m.marketType,
        lineParam: m.lineParam,
        totalPool: m.totalPool,
        status: m.status,
      }));

    return json({
      totals: {
        volume: totalVolume,
        markets: markets.length,
        openMarkets: markets.filter((m) => m.status === "OPEN").length,
        settledMarkets: markets.filter((m) => m.status !== "OPEN").length,
        stakers: stakers.size,
        predictions: positions.length,
      },
      topPredictors,
      biggestMarkets,
    });
  } catch (error) {
    return fail(error, 500);
  }
}
