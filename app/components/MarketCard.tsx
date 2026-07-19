import Link from "next/link";
import type { Market } from "@/app/_lib/api";
import { fmtMusdc, marketTitle, matchLabel, relativeTime } from "@/app/_lib/api";
import { StatusPill } from "./ui";

export function MarketCard({ market }: { market: Market }) {
  const winner =
    market.winningOutcome != null
      ? market.outcomes.find((o) => o.index === market.winningOutcome)?.label
      : null;
  return (
    <Link href={`/markets/${market.id}`} className="block">
      <div className="glass glass-hover h-full min-w-[240px] p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-neon/80">
            {matchLabel(market)}
          </span>
          <StatusPill status={market.status} />
        </div>
        <div className="mb-2 text-sm font-semibold text-white">{marketTitle(market)}</div>

        <div className="flex flex-wrap gap-1.5">
          {market.outcomes.map((o) => (
            <span
              key={o.index}
              className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/70"
            >
              {o.label}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
          <div>
            <div className="text-white/40">Total pool</div>
            <div className="tabular-nums font-semibold text-neon">
              {fmtMusdc(market.totalPool)} <span className="text-white/40">mUSDC</span>
            </div>
          </div>
          <div className="text-right">
            {winner ? (
              <>
                <div className="text-white/40">Winner</div>
                <div className="font-semibold text-gold">{winner}</div>
              </>
            ) : (
              <>
                <div className="text-white/40">Locks</div>
                <div className="text-white/70">{relativeTime(market.lockAt)}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
