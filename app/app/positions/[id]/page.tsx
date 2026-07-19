"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, marketTitle, matchLabel, type Market, type Position } from "@/app/_lib/api";
import { YourPosition } from "@/components/YourPosition";
import { BackLink, Card, StatePanel, StatusPill } from "@/components/ui";

export default function PositionDetailPage({ params }: { params: { id: string } }) {
  const marketId = params.id;
  const { publicKey, connected } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { market, positions } = await api.getMarket(marketId);
      setMarket(market);
      setPositions(positions ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [marketId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const mine = publicKey ? positions.filter((p) => p.wallet === publicKey.toBase58()) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink href="/positions">Back to positions</BackLink>

      {loading && !market ? (
        <div className="h-56 animate-pulse rounded-2xl bg-white/5" />
      ) : !market ? (
        <StatePanel kind="error" title="Market not found" detail={error ?? undefined} />
      ) : !connected ? (
        <StatePanel
          kind="empty"
          title="Connect your wallet"
          detail="Connect Phantom (top-right) to view your position."
        />
      ) : mine.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No position here"
          detail="Your connected wallet has no stake on this market."
        />
      ) : (
        <>
          {/* minimal header: which match + market + status */}
          <Card>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neon/80">
                  {matchLabel(market)}
                </div>
                <div className="text-lg font-extrabold text-white">{marketTitle(market)}</div>
              </div>
              <StatusPill status={market.status} />
            </div>
            {market.status !== "OPEN" ? (
              <div className="mt-2 text-sm text-white/60">
                Final score{" "}
                <span className="font-semibold text-white">
                  {market.finalHomeGoals ?? "–"} : {market.finalAwayGoals ?? "–"}
                </span>
              </div>
            ) : null}
          </Card>

          {/* the position itself */}
          <YourPosition market={market} positions={mine} onDone={load} />

          {/* quiet links out */}
          <div className="flex items-center justify-end gap-4 text-xs text-white/40">
            <Link href={`/markets/${market.id}`} className="hover:text-neon">
              Open full market ↗
            </Link>
            <Link href={`/receipts/${market.id}`} className="hover:text-gold">
              Verifiable receipt ↗
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
