import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket } from "@/lib/db";
import { buildPlacePredictionTx } from "@/lib/onchain/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  marketId: z.string().min(1),
  wallet: z.string().min(32).max(64),
  outcome: z.number().int().min(0).max(7),
  amount: z.number().positive(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const market = getMarket(body.marketId);
    if (!market) return json({ error: "Market not found" }, 404);

    const built = await buildPlacePredictionTx({
      marketPda: market.marketPda,
      seedHex: market.seedHex,
      wallet: body.wallet,
      outcome: body.outcome,
      amount: body.amount,
    });
    return json(built);
  } catch (error) {
    return fail(error, 400);
  }
}
