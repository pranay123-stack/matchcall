import { z } from "zod";
import { json, fail } from "@/lib/http";
import { getMarket, insertMarket, listMarkets } from "@/lib/db";
import { toMarketDTO } from "@/lib/marketView";
import { createMarket, marketTypeTag, type MarketTypeTag } from "@/lib/onchain/program";
import { txlineClient } from "@/lib/txline/client";
import { recordActivity } from "@/lib/activity";

function typeLabel(tag: MarketTypeTag, lineParam: number | null): string {
  if (tag === 1) return `Total Goals O/U ${((lineParam ?? 0) / 2).toFixed(1)}`;
  return tag === 0 ? "Match Winner" : "Both Teams To Score";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fixtureId: z.string().min(1),
  marketType: z.union([
    z.enum(["MATCH_WINNER", "TOTALS", "BTTS"]),
    z.number().int().min(0).max(2),
  ]),
  lineParam: z.number().int().optional(),
  lockAt: z.union([z.string(), z.number()]),
});

function toTag(v: string | number): MarketTypeTag {
  return (typeof v === "number" ? v : marketTypeTag(v)) as MarketTypeTag;
}

function toUnixSeconds(v: string | number): number {
  if (typeof v === "number") return Math.floor(v > 1e12 ? v / 1000 : v);
  const parsed = Date.parse(v);
  if (Number.isNaN(parsed)) throw new Error("lockAt is not a valid date");
  return Math.floor(parsed / 1000);
}

export async function GET() {
  try {
    const rows = listMarkets();
    const markets = await Promise.all(rows.map(toMarketDTO));
    return json({ markets });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const marketType = toTag(body.marketType);
    const lockAt = toUnixSeconds(body.lockAt);

    if (!/^\d+$/.test(body.fixtureId)) {
      throw new Error("fixtureId must be a numeric TxLINE fixture id to be proof-settled");
    }
    const txlineFixtureId = Number(body.fixtureId);
    if (!Number.isSafeInteger(txlineFixtureId) || txlineFixtureId <= 0) {
      throw new Error("fixtureId is invalid");
    }

    // Determine participant1IsHome from the live TxLINE fixture snapshot.
    const fixtures = await txlineClient.fixtures();
    const fixture = fixtures.find((f) => f.id === body.fixtureId);
    const participant1IsHome = fixture?.participant1IsHome ?? true;

    const lineParam = marketType === 1 ? body.lineParam ?? null : null;
    if (marketType === 1 && (lineParam === null || lineParam <= 0 || lineParam % 2 !== 1)) {
      throw new Error("TOTALS markets require an odd positive lineParam (line * 2, e.g. 5 for 2.5)");
    }

    // Deterministic id keeps one market per (fixture, type, line).
    const id = `${body.fixtureId}:${marketType}:${lineParam ?? 0}`;
    const existing = getMarket(id);
    if (existing) {
      return json({ market: await toMarketDTO(existing) });
    }

    const onchain = await createMarket({
      id,
      txlineFixtureId,
      participant1IsHome,
      marketType,
      lineParam: lineParam ?? 0,
      lockAt,
    });

    const row = insertMarket({
      id,
      fixtureId: body.fixtureId,
      marketType,
      lineParam,
      lockAt,
      participant1IsHome,
      marketPda: onchain.marketPda,
      escrow: onchain.escrow,
      seedHex: onchain.seedHex,
      homeTeam: fixture?.homeTeam ?? null,
      awayTeam: fixture?.awayTeam ?? null,
    });

    recordActivity({
      type: "market_created",
      marketId: id,
      match: fixture ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : `Fixture ${body.fixtureId}`,
      market: typeLabel(marketType, lineParam),
    });

    return json({ market: await toMarketDTO(row) }, 201);
  } catch (error) {
    return fail(error, 400);
  }
}
