"use client";

import { useState } from "react";
import type { Fixture, ScoreEvent } from "@/app/_lib/api";
import { relativeTime } from "@/app/_lib/api";
import { useSSE } from "@/app/_lib/useSSE";
import { LiveBadge, cx } from "./ui";

/** Pull score/clock/status out of whatever shape the score SSE forwards. */
function extractScore(ev: unknown): ScoreEvent | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;
  const src = (e.score && typeof e.score === "object" ? (e.score as Record<string, unknown>) : e) as Record<
    string,
    unknown
  >;
  const homeGoals = num(src.homeGoals ?? src.home ?? src.homeScore);
  const awayGoals = num(src.awayGoals ?? src.away ?? src.awayScore);
  const matchClock =
    (src.matchClock ?? src.clock ?? src.minute ?? e.matchClock ?? null) as string | null;
  const status = (src.status ?? e.status) as string | undefined;
  if (homeGoals == null && awayGoals == null && matchClock == null && status == null) return null;
  return { homeGoals, awayGoals, matchClock: matchClock as string | null, status };
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function ScoreHeader({ fixture }: { fixture: Fixture }) {
  const [live, setLive] = useState<ScoreEvent | null>(null);
  const { status: sseStatus } = useSSE(`/api/fixtures/${fixture.id}/scores`, (data) => {
    const s = extractScore(data);
    if (s) setLive((prev) => ({ ...prev, ...s }));
  });

  const isLive = fixture.live || live?.status?.toUpperCase() === "LIVE";
  const home = live?.homeGoals ?? fixture.homeGoals;
  const away = live?.awayGoals ?? fixture.awayGoals;
  const hasScore = home != null && away != null;
  const clock = live?.matchClock ?? fixture.matchClock;
  const status = live?.status ?? fixture.status;

  return (
    <div className="glass overflow-hidden p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {fixture.competition || "World Cup"}
        </span>
        <div className="flex items-center gap-2">
          {isLive ? <LiveBadge /> : null}
          <span
            className={cx(
              "inline-flex items-center gap-1 text-[11px]",
              sseStatus === "open" ? "text-neon" : "text-white/40",
            )}
            title={`score stream: ${sseStatus}`}
          >
            <span
              className={cx(
                "h-1.5 w-1.5 rounded-full",
                sseStatus === "open" ? "bg-neon" : "bg-white/30",
              )}
            />
            feed
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="text-right">
          <div className="text-lg font-bold text-white sm:text-2xl">{fixture.homeTeam}</div>
          <div className="text-[11px] uppercase tracking-wide text-white/35">Home</div>
        </div>

        <div className="px-2 text-center">
          {hasScore ? (
            <div className="flex items-center gap-2 text-4xl font-extrabold tabular-nums sm:text-5xl">
              <span className="text-white">{home}</span>
              <span className="text-white/30">:</span>
              <span className="text-white">{away}</span>
            </div>
          ) : (
            <div className="text-2xl font-bold text-white/40">vs</div>
          )}
          <div className="mt-1 text-xs font-medium">
            {isLive && clock ? (
              <span className="font-mono text-neon">{clock}</span>
            ) : (
              <span className="capitalize text-white/45">
                {hasScore ? (status || "").toLowerCase() : relativeTime(fixture.kickoffAt)}
              </span>
            )}
          </div>
        </div>

        <div className="text-left">
          <div className="text-lg font-bold text-white sm:text-2xl">{fixture.awayTeam}</div>
          <div className="text-[11px] uppercase tracking-wide text-white/35">Away</div>
        </div>
      </div>
    </div>
  );
}
