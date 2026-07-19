import { json, fail } from "@/lib/http";
import { getMarket } from "@/lib/db";
import { positionsForMarket, toMarketDTO } from "@/lib/marketView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const row = getMarket(decodeURIComponent(params.id));
    if (!row) return json({ error: "Market not found" }, 404);
    return json({
      market: await toMarketDTO(row),
      positions: positionsForMarket(row.id),
    });
  } catch (error) {
    return fail(error, 500);
  }
}
