import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket, markPositionClaimed } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  marketId: z.string().min(1),
  wallet: z.string().min(32).max(64),
  outcome: z.number().int().min(0).max(7),
});

// Records a successful claim so the position stops showing a claim button and
// a re-click can't build an AlreadyClaimed tx.
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    if (!getMarket(body.marketId)) return json({ error: "Market not found" }, 404);
    markPositionClaimed(body.marketId, body.wallet, body.outcome);
    return json({ ok: true });
  } catch (error) {
    return fail(error, 400);
  }
}
