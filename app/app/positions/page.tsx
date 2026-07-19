"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, fmtMusdc, marketTitle, matchLabel, type WalletEntry } from "@/app/_lib/api";
import { ClaimButton } from "@/components/ClaimButton";
import { Card, SectionTitle, StatePanel } from "@/components/ui";

type Result = "OPEN" | "WON" | "LOST" | "REFUND";

function resultOf(e: WalletEntry): Result {
  const m = e.market;
  if (m.status === "REFUNDING") return "REFUND";
  if (m.status === "SETTLED") return e.position.outcome === m.winningOutcome ? "WON" : "LOST";
  return "OPEN";
}

function outcomeLabel(e: WalletEntry): string {
  return e.market.outcomes.find((o) => o.index === e.position.outcome)?.label ?? `#${e.position.outcome}`;
}

const badge: Record<Result, string> = {
  OPEN: "bg-white/10 text-white/60",
  WON: "bg-gold/15 text-gold",
  LOST: "bg-red-500/15 text-red-300",
  REFUND: "bg-sky-400/15 text-sky-300",
};

export default function PositionsPage() {
  const { publicKey, connected } = useWallet();
  const [entries, setEntries] = useState<WalletEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
    try {
      const { positions } = await api.getPositions(publicKey.toBase58());
      setEntries(positions);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [publicKey]);

  useEffect(() => {
    if (!connected) {
      setEntries(null);
      return;
    }
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [connected, load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">My Positions</h1>
        <p className="mt-1 text-sm text-white/60">
          Every prediction you&apos;ve staked, across all markets — with live status and one-click
          claim on winners and refunds.
        </p>
      </div>

      {!connected ? (
        <StatePanel
          kind="empty"
          title="Connect your wallet"
          detail="Connect Phantom (top-right) to see the predictions you've staked."
        />
      ) : error ? (
        <StatePanel kind="error" title="Couldn't load positions" detail={error} />
      ) : entries == null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="text-sm text-white/50">
          No positions yet. Open a market and stake a prediction — it&apos;ll show up here.
        </Card>
      ) : (
        <>
          <SectionTitle right={<span className="text-xs text-white/40">{entries.length}</span>}>
            Your stakes
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => {
              const result = resultOf(e);
              const claimable =
                !e.position.claimed &&
                (result === "REFUND" || (result === "WON" && e.market.status === "SETTLED"));
              return (
                <Card key={`${e.market.id}:${e.position.outcome}`} className="flex flex-col">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-neon/80">
                      {matchLabel(e.market)}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${badge[result]}`}>
                      {result}
                    </span>
                  </div>
                  <Link
                    href={`/markets/${e.market.id}`}
                    className="text-sm font-semibold text-white hover:text-neon"
                  >
                    {marketTitle(e.market)}
                  </Link>

                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-2 text-xs">
                    <div>
                      <div className="text-white/40">Your call</div>
                      <div className="font-semibold text-white">{outcomeLabel(e)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-white/40">Staked</div>
                      <div className="tabular-nums font-semibold text-neon">
                        {fmtMusdc(e.position.amount)} mUSDC
                      </div>
                    </div>
                  </div>

                  {e.position.claimed ? (
                    <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 px-3 py-1.5 text-center text-xs text-gold/80">
                      ✓ Claimed
                    </div>
                  ) : claimable ? (
                    <div className="mt-3">
                      <ClaimButton market={e.market} outcome={e.position.outcome} onDone={load} />
                    </div>
                  ) : null}

                  <Link
                    href={`/positions/${e.market.id}`}
                    className="mt-3 flex items-center justify-end gap-1 border-t border-white/5 pt-2 text-xs font-semibold text-white/50 transition hover:text-neon"
                  >
                    View position →
                  </Link>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
