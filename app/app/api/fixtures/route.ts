import { txlineClient } from "@/lib/txline/client";
import { json, fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const fixtures = await txlineClient.fixtures();
    return json({ fixtures });
  } catch (error) {
    return fail(error, 502);
  }
}
