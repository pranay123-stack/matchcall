import { json } from "@/lib/http";
import { recentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polling fallback for the activity feed — reliable behind proxies (Railway's
// HTTP/2 layer drops long-lived SSE connections, so the client polls this).
export async function GET() {
  return json({ events: recentActivity(25) });
}
