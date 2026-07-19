import { json, fail } from "@/lib/http";
import { getMarket, listPositionsByWallet } from "@/lib/db";
import { toMarketDTO, toPositionDTO } from "@/lib/marketView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All of a wallet's positions across every market, each paired with the live
// market DTO so the client can show match, pick, status, and claimability.
export async function GET(request: Request) {
  try {
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (!wallet) return json({ error: "wallet query param is required" }, 400);

    const rows = listPositionsByWallet(wallet);
    const entries = (
      await Promise.all(
        rows.map(async (p) => {
          const marketRow = getMarket(p.marketId);
          if (!marketRow) return null;
          const market = await toMarketDTO(marketRow);
          return { market, position: toPositionDTO(p) };
        }),
      )
    ).filter((e): e is NonNullable<typeof e> => e !== null);

    // Newest markets first.
    entries.sort((a, b) => (a.market.lockAt < b.market.lockAt ? 1 : -1));
    return json({ positions: entries });
  } catch (error) {
    return fail(error, 500);
  }
}
