// Shared frontend types + API client for MatchCall.
// Types mirror docs/SPEC.md exactly. Frontend only ever calls relative /api/* routes.

export type Fixture = {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  participant1IsHome: boolean;
  kickoffAt: string | null;
  status: string;
  live: boolean;
  homeGoals?: number;
  awayGoals?: number;
  matchClock?: string | null;
};

export type MarketType = "MATCH_WINNER" | "TOTALS" | "BTTS";
export type MarketStatus = "OPEN" | "SETTLED" | "REFUNDING";

export type Outcome = { index: number; label: string; pool: number };

export type Market = {
  id: string;
  fixtureId: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  marketType: MarketType;
  lineParam: number | null;
  outcomes: Outcome[];
  totalPool: number;
  lockAt: string;
  status: MarketStatus;
  marketPda: string;
  escrow: string;
  winningOutcome?: number | null;
  finalHomeGoals?: number | null;
  finalAwayGoals?: number | null;
  settleSignature?: string | null;
};

export type Position = {
  wallet: string;
  outcome: number;
  amount: number;
  claimed: boolean;
};

export type ProofNode = { hash: string; isRightSibling: boolean };

export type Receipt = {
  settlement: {
    signature: string;
    finalHomeGoals: number;
    finalAwayGoals: number;
    winningOutcome: number;
  };
  proof: {
    root: string;
    statProofs?: ProofNode[][];
    mainTreeProof?: ProofNode[];
    subTreeProof?: ProofNode[];
    eventStatRoot?: string;
    [k: string]: unknown;
  };
  explanation: string;
};

export type OddsSelection = { label: string; decimal: number; outcomeIndex?: number };
export type OddsEvent = { selections: OddsSelection[] };
export type ScoreEvent = {
  homeGoals?: number;
  awayGoals?: number;
  matchClock?: string | null;
  status?: string;
};

// ------------------------------------------------------------------ fetch

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string" && body
          ? body
          : `Request failed (${res.status})`) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export type WalletEntry = { market: Market; position: Position };

export type Stats = {
  totals: {
    volume: number;
    markets: number;
    openMarkets: number;
    settledMarkets: number;
    stakers: number;
    predictions: number;
  };
  topPredictors: { wallet: string; staked: number; bets: number }[];
  biggestMarkets: {
    id: string;
    homeTeam: string | null;
    awayTeam: string | null;
    marketType: MarketType;
    lineParam: number | null;
    totalPool: number;
    status: MarketStatus;
  }[];
};

export type ActivityEvent =
  | { id: number; at: string; type: "market_created"; marketId: string; match: string; market: string }
  | {
      id: number;
      at: string;
      type: "prediction_placed";
      marketId: string;
      match: string;
      market: string;
      wallet: string;
      outcome: string;
      amount: number;
    }
  | {
      id: number;
      at: string;
      type: "market_settled";
      marketId: string;
      match: string;
      market: string;
      finalScore: string;
      winner: string;
      signature: string;
    };

export type KeeperStatus = {
  online: boolean;
  streamConnected: boolean;
  fixturesWatched: number;
  lastEventAt: string | null;
  settledCount: number;
  lastSettle: { marketId: string; signature: string; at: string } | null;
  lastHeartbeat: string | null;
};

export const api = {
  getFixtures: () => jsonFetch<{ fixtures: Fixture[] }>("/api/fixtures"),
  getMarkets: () => jsonFetch<{ markets: Market[] }>("/api/markets"),
  getMarket: (id: string) =>
    jsonFetch<{ market: Market; positions: Position[] }>(`/api/markets/${id}`),
  createMarket: (body: {
    fixtureId: string;
    marketType: MarketType;
    lineParam?: number | null;
    lockAt: string;
  }) => jsonFetch<{ market: Market }>("/api/markets", { method: "POST", body: JSON.stringify(body) }),
  predictionIntent: (body: {
    marketId: string;
    wallet: string;
    outcome: number;
    amount: number;
  }) =>
    jsonFetch<{ transactionBase64: string; positionAddress: string; lastValidBlockHeight: number }>(
      "/api/predictions/intent",
      { method: "POST", body: JSON.stringify(body) },
    ),
  predictionConfirm: (body: {
    marketId: string;
    wallet: string;
    outcome: number;
    signature: string;
  }) =>
    jsonFetch<{ ok: boolean; position: Position }>("/api/predictions/confirm", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  claimIntent: (body: { marketId: string; wallet: string; outcome?: number }) =>
    jsonFetch<{ transactionBase64: string }>("/api/claims/intent", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPositions: (wallet: string) =>
    jsonFetch<{ positions: WalletEntry[] }>(`/api/positions?wallet=${encodeURIComponent(wallet)}`),
  keeperStatus: () => jsonFetch<KeeperStatus>("/api/keeper/status"),
  getStats: () => jsonFetch<Stats>("/api/stats"),
  faucet: (wallet: string) =>
    jsonFetch<{ ok?: boolean; signature?: string }>("/api/faucet", {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),
  getReceipt: (marketId: string) => jsonFetch<Receipt | null>(`/api/markets/${marketId}/receipt`),
};

// ------------------------------------------------------------------ format

export const MUSDC_DECIMALS = 6;
export const MUSDC_UNIT = 1_000_000;

/** human mUSDC amount -> formatted string. The API already returns pool/amount
 *  fields in whole mUSDC (the backend divides base units before serializing),
 *  so this only formats — it does NOT divide again. */
export function fmtMusdc(amount: number | null | undefined, opts?: { decimals?: number }): string {
  const v = amount ?? 0;
  const d = opts?.decimals ?? 2;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** whole mUSDC (as entered by a human) -> integer base units */
export function toBaseUnits(whole: number): number {
  return Math.round(whole * MUSDC_UNIT);
}

export function shortAddr(addr: string, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

// Public on-chain identifiers (safe to expose; used for "verify on-chain" links).
export const PROGRAM_ID =
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2";
export const MUSDC_MINT =
  process.env.NEXT_PUBLIC_MUSDC_MINT ?? "EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j";
export const TXLINE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

export function marketTypeLabel(t: MarketType): string {
  switch (t) {
    case "MATCH_WINNER":
      return "Match Winner";
    case "TOTALS":
      return "Total Goals O/U";
    case "BTTS":
      return "Both Teams To Score";
  }
}

/** Human title for a market, e.g. "Total Goals Over/Under 2.5". */
export function marketTitle(m: Market): string {
  if (m.marketType === "TOTALS" && m.lineParam != null) {
    return `Total Goals O/U ${(m.lineParam / 2).toFixed(1)}`;
  }
  return marketTypeLabel(m.marketType);
}

/** "Spain vs Argentina" when known, else a short fixture reference. */
export function matchLabel(m: Market): string {
  if (m.homeTeam && m.awayTeam) return `${m.homeTeam} vs ${m.awayTeam}`;
  return `Fixture ${m.fixtureId}`;
}

/** decimal odds -> normalized implied probabilities (sum to 1). */
export function impliedProbabilities(
  selections: OddsSelection[],
): { label: string; prob: number; decimal: number; outcomeIndex?: number }[] {
  const raw = selections
    .filter((s) => s.decimal && s.decimal > 0)
    .map((s) => ({ ...s, inv: 1 / s.decimal }));
  const sum = raw.reduce((a, s) => a + s.inv, 0);
  if (sum <= 0) return [];
  return raw.map((s) => ({
    label: s.label,
    decimal: s.decimal,
    outcomeIndex: s.outcomeIndex,
    prob: s.inv / sum,
  }));
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "TBD";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "TBD";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const label = mins < 60 ? `${mins}m` : hours < 48 ? `${hours}h` : `${days}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}
