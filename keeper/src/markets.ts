import { config } from "./config.js";

// Mirror of the shared `Market` type from docs/SPEC.md (fields the keeper uses).
export type Market = {
  id: string;
  fixtureId: string;
  marketType: "MATCH_WINNER" | "TOTALS" | "BTTS";
  lineParam: number | null;
  lockAt: string;
  status: "OPEN" | "SETTLED" | "REFUNDING";
  marketPda: string;
  escrow: string;
  winningOutcome?: number | null;
  settleSignature?: string | null;
};

export async function fetchMarkets(): Promise<Market[]> {
  const res = await fetch(`${config.apiBase}/api/markets`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`GET /api/markets -> ${res.status}`);
  const body = (await res.json()) as { markets?: Market[] };
  return Array.isArray(body.markets) ? body.markets : [];
}

/** OPEN markets whose lock time has passed — candidates for settlement. */
export function settlementCandidates(markets: Market[], now = Date.now()): Market[] {
  return markets.filter((m) => m.status === "OPEN" && Date.parse(m.lockAt) <= now);
}

export type SettleResult = { ok: true; signature: string } | { ok: false; status: number; error: string };

/**
 * Ask the backend to settle. The backend fetches the TxLINE proof for
 * (marketId, seq), CPIs into validate_stat_v2, and records the receipt.
 * NOTE: requires the backend to expose `POST /api/keeper/settle`.
 */
export async function requestBackendSettle(marketId: string, seq: string): Promise<SettleResult> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBase}/api/keeper/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ marketId, seq }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string"
          ? body
          : `settle failed (${res.status})`;
    return { ok: false, status: res.status, error };
  }
  const signature =
    body && typeof body === "object" && "signature" in body ? String((body as { signature: unknown }).signature) : "";
  return { ok: true, signature };
}
