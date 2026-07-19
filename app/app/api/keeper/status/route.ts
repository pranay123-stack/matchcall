import { json } from "@/lib/http";
import { getKeeperStatus } from "@/lib/keeperStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(getKeeperStatus());
}
