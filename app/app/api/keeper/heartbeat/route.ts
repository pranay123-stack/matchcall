import { json, fail } from "@/lib/http";
import { recordHeartbeat } from "@/lib/keeperStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The keeper posts its liveness here each loop.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    recordHeartbeat({
      streamConnected: Boolean(body.streamConnected),
      fixturesWatched: Number(body.fixturesWatched ?? 0),
      lastEventAt: typeof body.lastEventAt === "string" ? body.lastEventAt : null,
      settledCount: Number(body.settledCount ?? 0),
      lastSettle:
        body.lastSettle && typeof body.lastSettle === "object"
          ? (body.lastSettle as { marketId: string; signature: string; at: string })
          : null,
    });
    return json({ ok: true });
  } catch (error) {
    return fail(error, 400);
  }
}
