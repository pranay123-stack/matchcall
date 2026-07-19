import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket, setPosition } from "@/lib/db";
import { verifyPosition, outcomeLabels, fromBaseUnits } from "@/lib/onchain/program";
import { toPositionDTO } from "@/lib/marketView";
import { recordActivity } from "@/lib/activity";

function typeLabel(t: number, lineParam: number | null): string {
  if (t === 1) return `Total Goals O/U ${((lineParam ?? 0) / 2).toFixed(1)}`;
  return t === 0 ? "Match Winner" : "Both Teams To Score";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  marketId: z.string().min(1),
  wallet: z.string().min(32).max(64),
  outcome: z.number().int().min(0).max(7),
  signature: z.string().min(32).max(128),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const market = getMarket(body.marketId);
    if (!market) return json({ error: "Market not found" }, 404);

    // Confirm the signature landed and the on-chain Position matches.
    const verified = await verifyPosition({
      marketPda: market.marketPda,
      seedHex: market.seedHex,
      wallet: body.wallet,
      outcome: body.outcome,
      signature: body.signature,
    });

    // Store the exact on-chain cumulative amount (base units) as the truth.
    const row = setPosition({
      marketId: market.id,
      wallet: body.wallet,
      outcome: body.outcome,
      amount: Number(verified.amount),
      signature: body.signature,
    });

    recordActivity({
      type: "prediction_placed",
      marketId: market.id,
      match:
        market.homeTeam && market.awayTeam
          ? `${market.homeTeam} vs ${market.awayTeam}`
          : `Fixture ${market.fixtureId}`,
      market: typeLabel(market.marketType, market.lineParam),
      wallet: body.wallet,
      outcome: outcomeLabels(market.marketType)[body.outcome] ?? `#${body.outcome}`,
      amount: fromBaseUnits(verified.amount),
    });

    return json({ ok: true, position: toPositionDTO(row) });
  } catch (error) {
    return fail(error, 400);
  }
}
