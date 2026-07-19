import { json, fail } from "@/lib/http";
import { getMarket } from "@/lib/db";
import { settleMarketById } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Settlement endpoint the automated keeper calls once it observes a fixture go
// final. Body: { marketId, seq }. `seq` is advisory — the backend independently
// locates the game_finalised record and fetches its Merkle proof from TxLINE,
// then CPIs into validate_stat_v2. Permissionless & proof-gated.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { marketId?: string; seq?: string };
    const marketId = typeof body.marketId === "string" ? body.marketId : "";
    if (!marketId) return json({ error: "marketId is required" }, 400);
    if (!getMarket(marketId)) return json({ error: "Market not found" }, 404);
    const { settlement } = await settleMarketById(marketId);
    return json({ ok: true, signature: settlement.signature, settlement });
  } catch (error) {
    return fail(error, 400);
  }
}
