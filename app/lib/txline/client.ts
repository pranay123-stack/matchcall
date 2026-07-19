// MatchCall — TxLINE data client.
//
// Wraps TxLINE's authenticated REST + SSE surface. Credentials (JWT + API token)
// NEVER leave this module: normalizers return plain data, streams return the raw
// fetch Response purely so a route handler can pipe bytes to the browser. A 401
// transparently re-fetches a guest JWT and retries.
import { config } from "../config.js";

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

export type NormalizedScoreEvent = {
  eventId: string | null;
  seq: string | null;
  fixtureId: string | null;
  eventType: string;
  matchStatus: string | null;
  homeGoals: number;
  awayGoals: number;
  matchClock: string | null;
  txlineTimestamp: string | null;
  raw: unknown;
};

export class TxlineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxlineUnavailableError";
  }
}

// Runtime JWT starts from env and is refreshed on 401.
let runtimeAuthJwt: string | undefined = config.TXLINE_AUTH_JWT;

function headers(accept: string, lastEventId?: string | null): Record<string, string> {
  const h: Record<string, string> = { accept };
  if (accept === "text/event-stream") h["cache-control"] = "no-cache";
  if (runtimeAuthJwt) h.authorization = `Bearer ${runtimeAuthJwt}`;
  if (config.TXLINE_API_TOKEN) h["x-api-token"] = config.TXLINE_API_TOKEN;
  if (lastEventId) h["last-event-id"] = lastEventId;
  return h;
}

async function renewJwt(parentSignal?: AbortSignal): Promise<boolean> {
  try {
    const timeout = AbortSignal.timeout(10_000);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    const response = await fetch(config.TXLINE_GUEST_URL, {
      method: "POST",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string" || body.token.length === 0) return false;
    runtimeAuthJwt = body.token;
    return true;
  } catch {
    return false;
  }
}

async function txlineFetch<T>(pathAndQuery: string): Promise<T | null> {
  const url = new URL(pathAndQuery.replace(/^\//, ""), config.TXLINE_BASE_URL);
  try {
    let response = await fetch(url, {
      headers: headers("application/json"),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 && (await renewJwt())) {
      response = await fetch(url, {
        headers: headers("application/json"),
        signal: AbortSignal.timeout(10_000),
      });
    }
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class TxlineClient {
  /** All World Cup fixtures (live + upcoming), normalized to the shared shape. */
  async fixtures(): Promise<Fixture[]> {
    const params = new URLSearchParams();
    if (config.TXLINE_COMPETITION_ID) params.set("competitionId", String(config.TXLINE_COMPETITION_ID));
    const query = params.toString();
    const data = await txlineFetch<unknown>(`/fixtures/snapshot${query ? `?${query}` : ""}`);
    if (!Array.isArray(data)) return [];
    const now = Date.now();
    return data
      .map(normalizeFixture)
      .filter((f): f is Fixture => f !== null)
      .filter((f) => f.competition.toLowerCase().includes("world cup"))
      .filter((f) => {
        // Keep live and upcoming; drop cancelled/long-finished.
        if (f.status === "cancelled") return false;
        if (f.live) return true;
        if (f.status === "finished") return false;
        const kickoff = f.kickoffAt ? Date.parse(f.kickoffAt) : Number.NaN;
        if (!Number.isFinite(kickoff)) return true; // unknown time — still show
        return kickoff > now - 6 * 60 * 60 * 1000; // upcoming or recently kicked-off
      })
      .sort((a, b) => {
        const ka = a.kickoffAt ? Date.parse(a.kickoffAt) : Number.MAX_SAFE_INTEGER;
        const kb = b.kickoffAt ? Date.parse(b.kickoffAt) : Number.MAX_SAFE_INTEGER;
        return ka - kb;
      });
  }

  /** Latest normalized score event for a fixture from /scores/snapshot/{id}. */
  async liveScore(fixtureId: string): Promise<NormalizedScoreEvent | null> {
    const data = await txlineFetch<unknown>(
      `/scores/snapshot/${encodeURIComponent(fixtureId)}`
    );
    const events = Array.isArray(data)
      ? data.map(normalizeScoreEvent).filter((e): e is NormalizedScoreEvent => e !== null)
      : [];
    return events.at(-1) ?? normalizeScoreEvent(data);
  }

  /** Raw V2 Merkle-proof JSON for a specific score sequence. */
  async statValidation(fixtureId: string, seq: string): Promise<unknown> {
    if (!/^\d+$/.test(fixtureId) || !/^\d+$/.test(seq) || Number(seq) < 1) {
      throw new TxlineUnavailableError(
        "TxLINE validation requires a numeric fixture ID and a real score sequence"
      );
    }
    const query = new URLSearchParams({ fixtureId, seq, statKeys: "1,2" });
    const data = await txlineFetch<unknown>(`/scores/stat-validation?${query}`);
    if (!data) throw new TxlineUnavailableError("TxLINE score validation is unavailable");
    return data;
  }

  /** Full historical event list (used to find the final settlement sequence). */
  async historical(fixtureId: string): Promise<NormalizedScoreEvent[]> {
    const data = await txlineFetch<unknown>(
      `/scores/historical/${encodeURIComponent(fixtureId)}`
    );
    return Array.isArray(data)
      ? data.map(normalizeScoreEvent).filter((e): e is NormalizedScoreEvent => e !== null)
      : [];
  }

  /** Open the live score SSE stream; returns the raw Response for proxying. */
  async openScoreStream(
    fixtureId: string | undefined,
    signal: AbortSignal,
    lastEventId?: string | null
  ): Promise<Response> {
    const url = new URL("scores/stream", config.TXLINE_BASE_URL);
    if (fixtureId) url.searchParams.set("fixtureId", fixtureId);
    let response = await fetch(url, { headers: headers("text/event-stream", lastEventId), signal });
    if (response.status === 401 && (await renewJwt(signal))) {
      response = await fetch(url, { headers: headers("text/event-stream", lastEventId), signal });
    }
    if (!response.ok || !response.body) {
      throw new TxlineUnavailableError(`TxLINE score stream failed (${response.status})`);
    }
    return response;
  }

  /** Open the live odds SSE stream; returns the raw Response for proxying. */
  async openOddsStream(fixtureId: string | undefined, signal: AbortSignal): Promise<Response> {
    const url = new URL("odds/stream", config.TXLINE_BASE_URL);
    if (fixtureId) url.searchParams.set("fixtureId", fixtureId);
    let response = await fetch(url, { headers: headers("text/event-stream"), signal });
    if (response.status === 401 && (await renewJwt(signal))) {
      response = await fetch(url, { headers: headers("text/event-stream"), signal });
    }
    if (!response.ok || !response.body) {
      throw new TxlineUnavailableError(`TxLINE odds stream failed (${response.status})`);
    }
    return response;
  }
}

export const txlineClient = new TxlineClient();

// ------------------------------- normalizers --------------------------------
function normalizeFixture(raw: unknown): Fixture | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = pickString(record, ["FixtureId", "id", "fixtureId", "fixture_id", "txlineFixtureId"]);
  const participant1 = pickString(record, [
    "Participant1", "participant1", "homeTeam", "home_team", "home", "teamHome",
  ]);
  const participant2 = pickString(record, [
    "Participant2", "participant2", "awayTeam", "away_team", "away", "teamAway",
  ]);
  const competition = pickString(record, ["Competition", "competition", "league", "tournament"]);
  if (!id || !participant1 || !participant2 || !competition) return null;
  const participant1IsHome = pickBoolean(record, ["Participant1IsHome", "participant1IsHome"]);
  const homeIsP1 = participant1IsHome !== false;
  const home = homeIsP1 ? participant1 : participant2;
  const away = homeIsP1 ? participant2 : participant1;
  const status = normalizeFixtureStatus(record);
  const p1Goals = pickScoreTotal(record, "scoreSoccer", "Participant1") ??
    pickScoreTotal(record, "score", "Participant1") ??
    pickNumber(record, ["participant1Goals", "Participant1Goals"]);
  const p2Goals = pickScoreTotal(record, "scoreSoccer", "Participant2") ??
    pickScoreTotal(record, "score", "Participant2") ??
    pickNumber(record, ["participant2Goals", "Participant2Goals"]);
  const homeGoals = homeIsP1 ? p1Goals : p2Goals;
  const awayGoals = homeIsP1 ? p2Goals : p1Goals;
  return {
    id,
    competition,
    homeTeam: home,
    awayTeam: away,
    participant1IsHome: homeIsP1,
    kickoffAt: normalizeTimestamp(
      pickString(record, ["StartTime", "kickoffAt", "kickoff_at", "startTime", "start_time"])
    ),
    status,
    live: status === "live" || status === "in_play",
    ...(homeGoals !== null ? { homeGoals } : {}),
    ...(awayGoals !== null ? { awayGoals } : {}),
    matchClock: normalizeClock(record),
  };
}

export function normalizeScoreEvent(raw: unknown): NormalizedScoreEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const participant1Goals =
    pickScoreTotal(record, "scoreSoccer", "Participant1") ??
    pickScoreTotal(record, "score", "Participant1") ??
    pickNumber(record, ["participant1Goals", "Participant1Goals"]);
  const participant2Goals =
    pickScoreTotal(record, "scoreSoccer", "Participant2") ??
    pickScoreTotal(record, "score", "Participant2") ??
    pickNumber(record, ["participant2Goals", "Participant2Goals"]);
  const participant1IsHome = pickBoolean(record, ["participant1IsHome", "Participant1IsHome"]);
  const homeGoals =
    pickNumber(record, ["homeGoals", "home_goals", "homeScore", "home_score"]) ??
    (participant1IsHome === false ? participant2Goals : participant1Goals);
  const awayGoals =
    pickNumber(record, ["awayGoals", "away_goals", "awayScore", "away_score"]) ??
    (participant1IsHome === false ? participant1Goals : participant2Goals);
  if (homeGoals === null || awayGoals === null) return null;
  return {
    eventId: pickString(record, ["id", "Id", "eventId", "event_id"]),
    seq: pickString(record, ["seq", "Seq", "sequence"]),
    fixtureId: pickString(record, ["fixtureId", "FixtureId", "fixture_id"]),
    eventType: pickString(record, ["action", "Action", "eventType", "event_type", "type"]) ?? "snapshot",
    matchStatus:
      pickStatus(record, "statusSoccerId") ??
      pickStatus(record, "statusId") ??
      pickString(record, ["gameState", "matchStatus", "match_status", "status", "statusId", "StatusId"]),
    homeGoals,
    awayGoals,
    matchClock: normalizeClock(record),
    txlineTimestamp: normalizeTimestamp(
      pickString(record, ["ts", "Ts", "timestamp", "txlineTimestamp", "txline_timestamp"])
    ),
    raw,
  };
}

/** True once TxLINE emits its documented final settlement record. */
export function isFinalisedScoreEvent(event: NormalizedScoreEvent): boolean {
  if (event.eventType.toLowerCase() === "game_finalised") {
    const raw = event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
    const statusId = pickNumber(raw, ["statusId", "StatusId"]);
    const period = pickNumber(raw, ["period", "Period"]);
    if (statusId === 100 && period === 100) return true;
  }
  const status = event.matchStatus?.toUpperCase() ?? "";
  return ["END", "F2", "FET", "FPE", "WET", "WPE", "FT", "FULL_TIME", "FINISHED", "100"].includes(status);
}

function normalizeFixtureStatus(record: Record<string, unknown>): string {
  const raw = record.GameState ?? record.gameState ?? record.status ?? record.matchStatus ?? record.state;
  if (raw === 1 || raw === "1") return "scheduled";
  if (raw === 6 || raw === "6") return "cancelled";
  const status = typeof raw === "string" ? raw.toLowerCase() : "scheduled";
  if (["scheduled", "not_started", "ns"].includes(status)) return "scheduled";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["finished", "full_time", "end", "ft"].includes(status)) return "finished";
  if (["live", "in_play", "inplay", "playing"].includes(status)) return "live";
  return status;
}

function pickScoreTotal(record: Record<string, unknown>, scoreKey: string, participantKey: string) {
  const score = record[scoreKey];
  if (!score || typeof score !== "object") return null;
  const participant = (score as Record<string, unknown>)[participantKey];
  if (!participant || typeof participant !== "object") return null;
  const total = (participant as Record<string, unknown>).Total;
  if (!total || typeof total !== "object") return null;
  return pickNumber(total as Record<string, unknown>, ["Score", "score"]);
}

function pickStatus(record: Record<string, unknown>, key: string) {
  const status = record[key];
  if (!status || typeof status !== "object") return null;
  const entries = Object.entries(status as Record<string, unknown>);
  const active = entries.find(([, value]) => value === true || value === 1);
  return active?.[0] ?? null;
}

function normalizeClock(record: Record<string, unknown>): string | null {
  const direct = pickString(record, ["matchClock", "match_clock", "minute"]);
  if (direct) return direct;
  const clock = record.clock;
  if (!clock || typeof clock !== "object") return null;
  const seconds = pickNumber(clock as Record<string, unknown>, ["seconds", "Seconds"]);
  return seconds === null ? null : `${Math.floor(seconds / 60)}'`;
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  return value;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
  }
  return null;
}
