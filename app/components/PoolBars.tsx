import type { Market } from "@/app/_lib/api";
import { fmtMusdc } from "@/app/_lib/api";
import { MeterBar } from "./ui";

const COLORS = ["neon", "gold", "sky", "violet"] as const;

export function PoolBars({
  market,
  highlight,
}: {
  market: Market;
  highlight?: number | null;
}) {
  const total = market.totalPool || 0;
  return (
    <div className="space-y-1">
      {market.outcomes.map((o, i) => (
        <MeterBar
          key={o.index}
          color={COLORS[i % COLORS.length]}
          active={highlight === o.index || market.winningOutcome === o.index}
          fraction={total > 0 ? o.pool / total : 0}
          label={
            <span className="flex items-center gap-1.5">
              {o.label}
              {market.winningOutcome === o.index ? (
                <span className="text-[10px] font-bold text-gold">WON</span>
              ) : null}
            </span>
          }
          rightLabel={
            <>
              {fmtMusdc(o.pool)} <span className="text-white/35">mUSDC</span>
              <span className="ml-1 text-white/35">
                ({total > 0 ? Math.round((o.pool / total) * 100) : 0}%)
              </span>
            </>
          }
        />
      ))}
    </div>
  );
}
