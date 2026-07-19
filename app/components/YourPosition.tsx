"use client";

import type { Market, Position } from "@/app/_lib/api";
import { fmtMusdc } from "@/app/_lib/api";
import { ClaimButton } from "./ClaimButton";
import { Card } from "./ui";

type Result = "OPEN" | "WON" | "LOST" | "REFUND";

const badge: Record<Result, string> = {
  OPEN: "bg-white/10 text-white/60",
  WON: "bg-gold/15 text-gold",
  LOST: "bg-red-500/15 text-red-300",
  REFUND: "bg-sky-400/15 text-sky-300",
};

/** Highlighted summary of the connected wallet's stake(s) on this market. */
export function YourPosition({
  market,
  positions,
  onDone,
}: {
  market: Market;
  positions: Position[];
  onDone: () => void;
}) {
  if (positions.length === 0) return null;

  return (
    <Card className="border-neon/30 bg-neon/[0.04]">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-neon">
        Your position
      </div>

      <div className="space-y-3">
        {positions.map((p) => {
          const outcome = market.outcomes.find((o) => o.index === p.outcome);
          const label = outcome?.label ?? `#${p.outcome}`;
          const outcomePool = outcome?.pool ?? 0;
          const total = market.totalPool;

          // Pari-mutuel: if your outcome wins, you take back your stake's share
          // of the WHOLE pool. payout = stake × total ÷ (pool on your outcome).
          const estPayout = outcomePool > 0 ? (p.amount * total) / outcomePool : p.amount;
          const poolShare = total > 0 ? (p.amount / total) * 100 : 0;

          const result: Result =
            market.status === "REFUNDING"
              ? "REFUND"
              : market.status === "SETTLED"
                ? p.outcome === market.winningOutcome
                  ? "WON"
                  : "LOST"
                : "OPEN";
          const claimable =
            !p.claimed && (result === "REFUND" || (result === "WON" && market.status === "SETTLED"));

          return (
            <div key={p.outcome} className="rounded-xl border border-white/10 bg-pitch-950/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-white/50">Your call: </span>
                  <span className="font-bold text-white">{label}</span>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${badge[result]}`}>
                  {result}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Metric label="Staked" value={`${fmtMusdc(p.amount)}`} unit="mUSDC" />
                <Metric label="Pool share" value={`${poolShare.toFixed(0)}%`} />
                <Metric
                  label={result === "WON" ? "Payout" : result === "LOST" ? "Payout" : "Est. if wins"}
                  value={result === "LOST" ? "0" : fmtMusdc(estPayout)}
                  unit="mUSDC"
                  accent={result !== "LOST"}
                />
              </div>

              {p.claimed ? (
                <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 px-3 py-1.5 text-center text-xs text-gold/80">
                  ✓ Claimed
                </div>
              ) : claimable ? (
                <div className="mt-3">
                  <ClaimButton market={market} outcome={p.outcome} onDone={onDone} />
                </div>
              ) : result === "OPEN" ? (
                <p className="mt-2 text-[11px] text-white/40">
                  Pari-mutuel estimate — final payout depends on the pool at lock time.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-white/40">{label}</div>
      <div className={`tabular-nums font-semibold ${accent ? "text-neon" : "text-white"}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[10px] text-white/40">{unit}</span> : null}
      </div>
    </div>
  );
}
