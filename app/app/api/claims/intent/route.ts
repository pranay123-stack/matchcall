import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket, listPositions, markPositionClaimed } from "@/lib/db";
import { buildClaimTx, fetchMarketOnchain, fetchPositionOnchain } from "@/lib/onchain/program";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  marketId: z.string().min(1),
  wallet: z.string().min(32).max(64),
  // Optional: disambiguate which position to claim when refunding multiple.
  outcome: z.number().int().min(0).max(7).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const market = getMarket(body.marketId);
    if (!market) return json({ error: "Market not found" }, 404);

    // Read chain truth for status + winning outcome.
    const chain = await fetchMarketOnchain(market.marketPda);
    const status = chain?.status ?? market.status;
    if (status === "OPEN") throw new Error("Market is not settled or refunding yet");

    const userPositions = listPositions(market.id).filter((p) => p.wallet === body.wallet);
    if (userPositions.length === 0) throw new Error("No position found for this wallet");

    let outcome: number;
    if (body.outcome !== undefined) {
      outcome = body.outcome;
    } else if (status === "SETTLED") {
      const winning = chain?.winningOutcome ?? market.winningOutcome;
      if (winning === null || winning === undefined) throw new Error("Winning outcome is unknown");
      const winningPos = userPositions.find((p) => p.outcome === winning);
      if (!winningPos) throw new Error("This wallet did not back the winning outcome");
      outcome = winning;
    } else {
      // Refunding: claim the first (or only) position.
      outcome = userPositions[0].outcome;
    }

    // Chain is the source of truth for whether this stake was already claimed.
    // We never recorded claims in the DB before, so a re-click would build a tx
    // that reverts with AlreadyClaimed ("Failed to simulate" in the wallet).
    // Detect it up front, self-heal the DB, and return a clean message.
    const onchainPos = await fetchPositionOnchain(market.marketPda, body.wallet, outcome);
    if (onchainPos?.claimed) {
      markPositionClaimed(market.id, body.wallet, outcome);
      return json({ error: "Already claimed — this stake is already back in your wallet." }, 409);
    }

    const built = await buildClaimTx({
      marketPda: market.marketPda,
      seedHex: market.seedHex,
      wallet: body.wallet,
      outcome,
    });
    return json({ transactionBase64: built.transactionBase64, outcome, lastValidBlockHeight: built.lastValidBlockHeight });
  } catch (error) {
    return fail(error, 400);
  }
}
