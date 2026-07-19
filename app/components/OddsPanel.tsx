"use client";

import { useMemo, useState } from "react";
import { impliedProbabilities, type OddsEvent, type OddsSelection } from "@/app/_lib/api";
import { useSSE } from "@/app/_lib/useSSE";
import { MeterBar, Spinner, cx } from "./ui";

const COLORS = ["neon", "gold", "sky", "violet"] as const;

/** Normalize whatever the odds SSE sends into a flat selection list. */
function extractSelections(ev: unknown): OddsSelection[] {
  if (!ev || typeof ev !== "object") return [];
  const e = ev as Record<string, unknown>;
  const rawList = (Array.isArray(e.selections) && e.selections) ||
    (Array.isArray(e.outcomes) && e.outcomes) ||
    (Array.isArray(e.prices) && e.prices) ||
    null;
  if (!rawList) return [];
  return rawList
    .map((s): OddsSelection | null => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const decimal = Number(o.decimal ?? o.price ?? o.odds ?? o.decimalOdds);
      const label = String(o.label ?? o.name ?? o.selection ?? o.outcome ?? "");
      if (!decimal || decimal <= 0 || !label) return null;
      const outcomeIndex = o.outcomeIndex != null ? Number(o.outcomeIndex) : undefined;
      return { label, decimal, outcomeIndex };
    })
    .filter((x): x is OddsSelection => x != null);
}

export function OddsPanel({ fixtureId }: { fixtureId: string }) {
  const [selections, setSelections] = useState<OddsSelection[]>([]);
  const { status } = useSSE<OddsEvent>(`/api/fixtures/${fixtureId}/odds`, (data) => {
    const next = extractSelections(data);
    if (next.length) setSelections(next);
  });

  const probs = useMemo(() => impliedProbabilities(selections), [selections]);
  const hasData = probs.length > 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-white">Implied probability</h3>
        <span
          className={cx(
            "inline-flex items-center gap-1.5 text-[11px]",
            status === "open" ? "text-neon" : "text-white/40",
          )}
        >
          <span
            className={cx(
              "h-1.5 w-1.5 rounded-full",
              status === "open" ? "bg-neon" : status === "error" ? "bg-red-400" : "bg-white/30",
            )}
          />
          {status === "open" ? "live odds" : status === "error" ? "odds offline" : "connecting"}
        </span>
      </div>

      {hasData ? (
        <div className="space-y-1">
          {probs.map((p, i) => (
            <MeterBar
              key={`${p.label}-${i}`}
              color={COLORS[i % COLORS.length]}
              fraction={p.prob}
              label={p.label}
              rightLabel={
                <>
                  <span className="font-semibold text-white/80">{(p.prob * 100).toFixed(1)}%</span>
                  <span className="ml-1.5 text-white/35">@ {p.decimal.toFixed(2)}</span>
                </>
              }
            />
          ))}
          <p className="pt-1 text-[11px] text-white/35">
            Derived from live decimal odds (1/odds, normalized to 100%).
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          <Spinner className="text-white/40" />
          Waiting for odds… the market maker hasn&apos;t priced this fixture yet.
        </div>
      )}
    </div>
  );
}
