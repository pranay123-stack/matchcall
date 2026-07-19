import { z } from "zod";
import { json, fail } from "@/lib/http";
import { airdropMusdc } from "@/lib/onchain/musdc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wallet: z.string().min(32).max(64),
});

// Faucet: mint 1000 mUSDC to the requested wallet so it can place predictions.
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await airdropMusdc(body.wallet, 1000);
    return json({ ok: true, ...result });
  } catch (error) {
    return fail(error, 400);
  }
}
