import { config } from "./config.js";
import { makeLogger, errText } from "./logger.js";

const log = makeLogger("txline-sse");

// ---- Live fixture state the poll loop reads from ----
export type FixtureState = {
  fixtureId: string;
  seq: string | null; // latest score sequence seen on the stream
  homeGoals: number | null;
  awayGoals: number | null;
  matchStatus: string | null;
  final: boolean; // reached a terminal / game_finalised state
  updatedAt: number;
};

export class FixtureTracker {
  private state = new Map<string, FixtureState>();

  get(fixtureId: string): FixtureState | undefined {
    return this.state.get(fixtureId);
  }

  /** Is this fixture proven final AND do we have a real score sequence to prove it? */
  finalWithSeq(fixtureId: string): FixtureState | null {
    const s = this.state.get(fixtureId);
    return s && s.final && s.seq && /^\d+$/.test(s.seq) ? s : null;
  }

  ingest(ev: NormalizedScoreEvent): void {
    if (!ev.fixtureId) return;
    const prev = this.state.get(ev.fixtureId);
    const final = prev?.final || isTerminalScoreEvent(ev);
    // Keep the newest numeric seq we have seen (proofs need a real sequence).
    const seq = ev.seq && /^\d+$/.test(ev.seq) ? ev.seq : prev?.seq ?? null;
    const next: FixtureState = {
      fixtureId: ev.fixtureId,
      seq,
      homeGoals: ev.homeGoals ?? prev?.homeGoals ?? null,
      awayGoals: ev.awayGoals ?? prev?.awayGoals ?? null,
      matchStatus: ev.matchStatus ?? prev?.matchStatus ?? null,
      final,
      updatedAt: Date.now()
    };
    this.state.set(ev.fixtureId, next);
    if (final && !prev?.final) {
      log.info(
        `fixture ${ev.fixtureId} reached FULL-TIME ${next.homeGoals ?? "?"}-${next.awayGoals ?? "?"} (seq ${seq ?? "none"}, status ${next.matchStatus ?? "?"})`
      );
    }
  }
}

export type NormalizedScoreEvent = {
  eventId: string | null;
  seq: string | null;
  fixtureId: string | null;
  eventType: string;
  matchStatus: string | null;
  period: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  raw: Record<string, unknown>;
};

// ---- Terminal / finalised detection (mirrors backend txline client) ----
export function isTerminalScoreEvent(ev: NormalizedScoreEvent): boolean {
  const status = ev.matchStatus?.toUpperCase() ?? "";
  const terminal = ["END", "F2", "FET", "FPE", "WET", "WPE", "FT", "FULL_TIME", "FINISHED", "100"];
  return terminal.includes(status) || isFinalisedScoreEvent(ev);
}

/** TxLINE documents this exact final record: game_finalised, statusId 100, period 100. */
export function isFinalisedScoreEvent(ev: NormalizedScoreEvent): boolean {
  if (ev.eventType.toLowerCase() === "game_finalised") {
    const statusId = pickNumber(ev.raw, ["statusId", "StatusId"]);
    const period = pickNumber(ev.raw, ["period", "Period"]);
    if (statusId === 100 && period === 100) return true;
  }
  // Some feeds carry the terminal marker on a plain score record.
  const statusId = pickNumber(ev.raw, ["statusId", "StatusId", "statusSoccerId"]);
  return statusId === 100 && ev.period === 100;
}

// ---- SSE loop with auto-reconnect + JWT renewal ----
let runtimeJwt = config.txlineAuthJwt;

export async function runScoreStream(tracker: FixtureTracker, signal: AbortSignal): Promise<void> {
  let lastEventId: string | null = null;
  let backoffMs = 1000;

  while (!signal.aborted) {
    try {
      const res = await openStream(lastEventId, signal);
      log.info(`connected to ${config.txlineBaseUrl}scores/stream`);
      backoffMs = 1000; // reset on a good connection
      for await (const frame of readSse(res, signal)) {
        if (frame.id) lastEventId = frame.id;
        if (!frame.data) continue;
        const ev = normalizeScoreEvent(safeJson(frame.data), frame.id);
        if (ev) tracker.ingest(ev);
      }
      log.warn("stream closed by server; reconnecting");
    } catch (err) {
      if (signal.aborted) return;
      log.error(`stream error; reconnecting in ${backoffMs}ms`, err);
    }
    await sleep(backoffMs, signal);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

async function openStream(lastEventId: string | null, signal: AbortSignal): Promise<Response> {
  const url = new URL("scores/stream", config.txlineBaseUrl);
  const doFetch = () =>
    fetch(url, { headers: sseHeaders(lastEventId), signal });
  let res = await doFetch();
  if (res.status === 401 && (await renewJwt(signal))) res = await doFetch();
  if (!res.ok || !res.body) throw new Error(`scores/stream failed (${res.status})`);
  return res;
}

function sseHeaders(lastEventId: string | null): Record<string, string> {
  const h: Record<string, string> = { accept: "text/event-stream", "cache-control": "no-cache" };
  if (runtimeJwt) h.authorization = `Bearer ${runtimeJwt}`;
  if (config.txlineApiToken) h["x-api-token"] = config.txlineApiToken;
  if (lastEventId) h["last-event-id"] = lastEventId;
  return h;
}

async function renewJwt(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(config.txlineGuestStart, {
      method: "POST",
      headers: { accept: "application/json" },
      signal
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: unknown };
    if (typeof body.token === "string" && body.token.length > 0) {
      runtimeJwt = body.token;
      log.info("renewed TxLINE guest JWT after 401");
      return true;
    }
  } catch (err) {
    log.warn(`JWT renewal failed: ${errText(err)}`);
  }
  return false;
}

type SseFrame = { id: string | null; event: string | null; data: string | null };

async function* readSse(res: Response, signal: AbortSignal): AsyncGenerator<SseFrame> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE events are separated by a blank line.
      while ((sep = indexOfBlankLine(buffer)) !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, "");
        const frame = parseFrame(rawFrame);
        if (frame) yield frame;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function indexOfBlankLine(buffer: string): number {
  const a = buffer.indexOf("\n\n");
  const b = buffer.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseFrame(raw: string): SseFrame | null {
  let id: string | null = null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const l = rawLine.trimEnd();
    if (!l || l.startsWith(":")) continue;
    const idx = l.indexOf(":");
    const field = idx === -1 ? l : l.slice(0, idx);
    const val = idx === -1 ? "" : l.slice(idx + 1).replace(/^ /, "");
    if (field === "id") id = val;
    else if (field === "event") event = val;
    else if (field === "data") dataLines.push(val);
  }
  if (!id && !event && dataLines.length === 0) return null;
  return { id, event, data: dataLines.length ? dataLines.join("\n") : null };
}

// ---- Normalization (subset of backend client, enough for finality + seq) ----
export function normalizeScoreEvent(raw: unknown, streamId: string | null): NormalizedScoreEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p1 = pickScoreTotal(r, "scoreSoccer", "Participant1") ?? pickScoreTotal(r, "score", "Participant1") ?? pickNumber(r, ["participant1Goals", "Participant1Goals"]);
  const p2 = pickScoreTotal(r, "scoreSoccer", "Participant2") ?? pickScoreTotal(r, "score", "Participant2") ?? pickNumber(r, ["participant2Goals", "Participant2Goals"]);
  const p1IsHome = pickBoolean(r, ["participant1IsHome", "Participant1IsHome"]);
  const homeGoals = pickNumber(r, ["homeGoals", "home_goals", "homeScore"]) ?? (p1IsHome === false ? p2 : p1);
  const awayGoals = pickNumber(r, ["awayGoals", "away_goals", "awayScore"]) ?? (p1IsHome === false ? p1 : p2);
  return {
    eventId: pickString(r, ["id", "Id", "eventId", "event_id"]) ?? streamId,
    seq: pickString(r, ["seq", "Seq", "sequence"]),
    fixtureId: pickString(r, ["fixtureId", "FixtureId", "fixture_id"]),
    eventType: pickString(r, ["action", "Action", "eventType", "event_type", "type"]) ?? "snapshot",
    matchStatus:
      pickStatus(r, "statusSoccerId") ??
      pickStatus(r, "statusId") ??
      pickString(r, ["matchStatus", "match_status", "status", "statusId", "StatusId"]),
    period: pickNumber(r, ["period", "Period"]),
    homeGoals,
    awayGoals,
    raw: r
  };
}

// ---- helpers ----
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    }, { once: true });
  });
}

function pickScoreTotal(record: Record<string, unknown>, scoreKey: string, participantKey: string): number | null {
  const score = record[scoreKey];
  if (!score || typeof score !== "object") return null;
  const participant = (score as Record<string, unknown>)[participantKey];
  if (!participant || typeof participant !== "object") return null;
  const total = (participant as Record<string, unknown>).Total;
  if (!total || typeof total !== "object") return null;
  return pickNumber(total as Record<string, unknown>, ["Score", "score"]);
}

function pickStatus(record: Record<string, unknown>, key: string): string | null {
  const status = record[key];
  if (!status || typeof status !== "object") return null;
  const active = Object.entries(status as Record<string, unknown>).find(([, v]) => v === true || v === 1);
  return active?.[0] ?? null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
  }
  return null;
}
