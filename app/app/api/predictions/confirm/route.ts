import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket, setPosition } from "@/lib/db";
import { verifyPosition } from "@/lib/onchain/program";
import { toPositionDTO } from "@/lib/marketView";

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

    return json({ ok: true, position: toPositionDTO(row) });
  } catch (error) {
    return fail(error, 400);
  }
}
