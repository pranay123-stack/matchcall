"use client";

import { useState } from "react";
import Link from "next/link";
import type { Market } from "@/app/_lib/api";
import { fmtMusdc, marketTitle } from "@/app/_lib/api";
import { PredictionWidget } from "./PredictionWidget";
import { StatusPill, cx } from "./ui";

/**
 * Compact accordion of a fixture's markets. Each row shows type + pool + status;
 * clicking a row expands its staking form. One market open at a time — much
 * cleaner than stacking full staking panels down the page.
 */
export function MarketsAccordion({
  markets,
  onDone,
}: {
  markets: Market[];
  onDone: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(markets[0]?.id ?? null);

  return (
    <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-pitch-900/40">
      {markets.map((m) => {
        const open = openId === m.id;
        return (
          <div key={m.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : m.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
            >
              <span
                className={cx(
                  "text-xs transition-transform",
                  open ? "rotate-90 text-neon" : "text-white/40",
                )}
              >
                ▸
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {marketTitle(m)}
                </span>
                <span className="block text-[11px] text-white/40">
                  {m.outcomes.length} outcomes
                </span>
              </span>
              <span className="whitespace-nowrap text-right">
                <span className="block tabular-nums text-sm font-semibold text-neon">
                  {fmtMusdc(m.totalPool)} <span className="text-white/40">mUSDC</span>
                </span>
              </span>
              <StatusPill status={m.status} />
            </button>

            {open ? (
              <div className="border-t border-white/5 bg-pitch-950/40 px-4 py-4">
                <div className="mb-2 flex justify-end">
                  <Link
                    href={`/markets/${m.id}`}
                    className="text-xs text-white/40 transition hover:text-neon"
                  >
                    open full market ↗
                  </Link>
                </div>
                <PredictionWidget market={m} onDone={onDone} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
