"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { ActivityEvent } from "@/app/_lib/api";
import { fmtMusdc, shortAddr } from "@/app/_lib/api";
import { useSSE } from "@/app/_lib/useSSE";
import { Card, SectionTitle } from "./ui";

const ICON: Record<ActivityEvent["type"], string> = {
  market_created: "🆕",
  prediction_placed: "🎯",
  market_settled: "✅",
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const onMsg = useCallback((e: ActivityEvent) => {
    setEvents((prev) => {
      if (prev.some((x) => x.id === e.id)) return prev;
      return [e, ...prev].slice(0, 25);
    });
  }, []);

  const { status } = useSSE<ActivityEvent>("/api/activity/stream", onMsg);

  return (
    <Card>
      <SectionTitle
        right={
          <span className="flex items-center gap-1.5 text-[11px] text-white/40">
            <span
              className={`h-1.5 w-1.5 rounded-full ${status === "open" ? "animate-pulse bg-neon" : "bg-white/25"}`}
            />
            live
          </span>
        }
      >
        Activity
      </SectionTitle>

      {events.length === 0 ? (
        <p className="text-sm text-white/40">
          Waiting for on-chain activity… create a market or place a stake and it shows up here
          instantly.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="mt-0.5">{ICON[e.type]}</span>
              <div className="min-w-0 flex-1">
                <Line e={e} />
                <div className="text-[11px] text-white/35">
                  <Link href={`/markets/${e.marketId}`} className="hover:text-neon">
                    {e.match} · {e.market}
                  </Link>{" "}
                  · {ago(e.at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Line({ e }: { e: ActivityEvent }) {
  if (e.type === "market_created") {
    return <span className="text-white/80">New market opened</span>;
  }
  if (e.type === "prediction_placed") {
    return (
      <span className="text-white/80">
        <span className="font-mono text-white/60">{shortAddr(e.wallet)}</span> staked{" "}
        <span className="font-semibold text-neon">{fmtMusdc(e.amount)} mUSDC</span> on{" "}
        <span className="font-semibold text-white">{e.outcome}</span>
      </span>
    );
  }
  return (
    <span className="text-white/80">
      Settled <span className="font-semibold text-white">{e.finalScore}</span> — winner{" "}
      <span className="font-semibold text-gold">{e.winner}</span>{" "}
      <a
        className="text-neon hover:underline"
        href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
      >
        ↗
      </a>
    </span>
  );
}
