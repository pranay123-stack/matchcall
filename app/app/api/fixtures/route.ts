import { txlineClient } from "@/lib/txline/client";
import type { Fixture } from "@/lib/txline/client";
import { json, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep the last successful snapshot so a transient TxLINE hiccup (timeout / JWT
// renewal through the proxy) serves stale-but-good fixtures instead of a hard
// 502. Only error out if we've never had a good response.
let lastGood: { fixtures: Fixture[]; at: number } | null = null;

export async function GET() {
  try {
    const fixtures = await txlineClient.fixtures();
    lastGood = { fixtures, at: Date.now() };
    return json({ fixtures });
  } catch (error) {
    if (lastGood) return json({ fixtures: lastGood.fixtures, stale: true });
    return fail(error, 502);
  }
}
