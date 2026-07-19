import { z } from "zod";
import { json, fail } from "@/lib/http";
import { airdropMusdc, dripSol } from "@/lib/onchain/musdc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wallet: z.string().min(32).max(64),
});

// Faucet: mint 1000 mUSDC AND drip a little devnet SOL for gas, so a fresh
// tester can stake in one click (mUSDC = the bet, SOL = the transaction fee +
// position-account rent). The SOL drip is skipped if the wallet already has gas.
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const musdc = await airdropMusdc(body.wallet, 1000);
    let solSent = 0;
    try {
      const drip = await dripSol(body.wallet);
      solSent = drip.sent;
    } catch {
      // Gas drip is best-effort; the mUSDC mint already succeeded.
    }
    return json({ ok: true, ...musdc, solSent });
  } catch (error) {
    return fail(error, 400);
  }
}
