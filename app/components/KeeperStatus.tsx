"use client";

import { useEffect, useState } from "react";
import { api, explorerTx, type KeeperStatus as Status } from "@/app/_lib/api";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Live badge showing the automated settlement keeper's state. */
export function KeeperStatus() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const st = await api.keeperStatus();
        if (alive) setS(st);
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const online = s?.online ?? false;

  return (
    <div className="glass flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          {online ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
          ) : null}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              online ? "bg-neon" : "bg-white/25"
            }`}
          />
        </span>
        <div>
          <div className="text-sm font-semibold text-white">
            Settlement keeper {online ? "live" : "offline"}
          </div>
          <div className="text-[11px] text-white/45">
            {online
              ? "Watching TxLINE's live scores — settles markets automatically at full-time."
              : "Start it with: cd keeper && npm start"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <Stat label="Stream" value={s?.streamConnected ? "connected" : "—"} good={s?.streamConnected} />
        <Stat label="Watching" value={`${s?.fixturesWatched ?? 0} fixtures`} />
        <Stat label="Last event" value={ago(s?.lastEventAt ?? null)} />
        <Stat label="Settled" value={String(s?.settledCount ?? 0)} />
        {s?.lastSettle ? (
          <a
            className="font-mono text-neon hover:underline"
            href={explorerTx(s.lastSettle.signature)}
            target="_blank"
            rel="noreferrer"
          >
            last tx ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div className="text-white/35">{label}</div>
      <div className={`font-semibold ${good ? "text-neon" : "text-white/70"}`}>{value}</div>
    </div>
  );
}
