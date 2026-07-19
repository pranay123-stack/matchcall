"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtMusdc, shortAddr, type Stats } from "@/app/_lib/api";
import { Card, SectionTitle } from "./ui";

export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.getStats();
        if (alive) setStats(s);
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const t = stats?.totals;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total volume" value={t ? `${fmtMusdc(t.volume)}` : "—"} unit="mUSDC" accent />
        <Tile label="Markets" value={t ? String(t.markets) : "—"} sub={t ? `${t.openMarkets} open` : ""} />
        <Tile label="Predictions" value={t ? String(t.predictions) : "—"} />
        <Tile label="Stakers" value={t ? String(t.stakers) : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>🏆 Top predictors</SectionTitle>
          {!stats || stats.topPredictors.length === 0 ? (
            <p className="text-sm text-white/40">No stakes yet.</p>
          ) : (
            <ol className="space-y-2">
              {stats.topPredictors.map((p, i) => (
                <li key={p.wallet} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-5 text-white/30">{i + 1}</span>
                    <span className="font-mono text-white/70">{shortAddr(p.wallet)}</span>
                    <span className="text-[11px] text-white/30">
                      {p.bets} bet{p.bets === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="tabular-nums font-semibold text-neon">
                    {fmtMusdc(p.staked)} <span className="text-white/40">mUSDC</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <SectionTitle>🔥 Biggest markets</SectionTitle>
          {!stats || stats.biggestMarkets.length === 0 ? (
            <p className="text-sm text-white/40">No markets yet.</p>
          ) : (
            <ol className="space-y-2">
              {stats.biggestMarkets.map((m, i) => (
                <li key={m.id}>
                  <Link
                    href={`/markets/${m.id}`}
                    className="flex items-center justify-between text-sm hover:text-neon"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-5 text-white/30">{i + 1}</span>
                      <span className="truncate text-white/70">
                        {m.homeTeam && m.awayTeam ? `${m.homeTeam} v ${m.awayTeam}` : m.id}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold text-neon">
                      {fmtMusdc(m.totalPool)} <span className="text-white/40">mUSDC</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass p-4">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums ${accent ? "text-neon" : "text-white"}`}>
        {value}
        {unit ? <span className="ml-1 text-[11px] font-normal text-white/40">{unit}</span> : null}
      </div>
      {sub ? <div className="text-[11px] text-white/35">{sub}</div> : null}
    </div>
  );
}
