import { json, fail } from "@/lib/http";
import { getMarket } from "@/lib/db";
import { settleMarketById } from "@/lib/settle";
import { toMarketDTO } from "@/lib/marketView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Permissionless settlement trigger: fetches a TxLINE final-score proof for the
// market's fixture and submits settle_market on-chain (backend authority pays).
// Not part of the minimal SPEC contract, but useful for the keeper/demo.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = decodeURIComponent(params.id);
    if (!getMarket(id)) return json({ error: "Market not found" }, 404);
    const { market, settlement } = await settleMarketById(id);
    return json({ ok: true, settlement, market: await toMarketDTO(market) });
  } catch (error) {
    return fail(error, 400);
  }
}
