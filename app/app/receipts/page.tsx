"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtMusdc, marketTitle, type Market } from "@/app/_lib/api";
import { Card, SectionTitle, StatePanel, StatusPill } from "@/components/ui";

export default function ReceiptsPage() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { markets } = await api.getMarkets();
        if (alive) {
          setMarkets(markets);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const settled = (markets ?? []).filter((m) => m.status !== "OPEN");
  const open = (markets ?? []).filter((m) => m.status === "OPEN");

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
          Verifiable resolutions
        </div>
        <h1 className="text-2xl font-extrabold">Receipts</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Every settled market gets a cryptographic receipt: the TxLINE final score, the Merkle
          proof it was anchored under, and the on-chain settlement transaction. Open one to
          re-verify each step.
        </p>
      </div>

      {error && !markets ? (
        <StatePanel kind="error" title="Couldn't load receipts" detail={error} />
      ) : null}

      <section>
        <SectionTitle right={<span className="text-xs text-white/40">{settled.length}</span>}>
          Settled — proof ready
        </SectionTitle>
        {markets == null ? (
          <Grid skeleton />
        ) : settled.length === 0 ? (
          <Card className="text-sm text-white/50">
            No markets settled yet. When a match reaches full-time, the keeper settles it against
            TxLINE data and its receipt appears here.
          </Card>
        ) : (
          <Grid>
            {settled.map((m) => (
              <ReceiptCard key={m.id} market={m} ready />
            ))}
          </Grid>
        )}
      </section>

      {open.length > 0 ? (
        <section>
          <SectionTitle>Awaiting settlement</SectionTitle>
          <Grid>
            {open.map((m) => (
              <ReceiptCard key={m.id} market={m} />
            ))}
          </Grid>
        </section>
      ) : null}
    </div>
  );
}

function ReceiptCard({ market, ready }: { market: Market; ready?: boolean }) {
  return (
    <Link href={`/receipts/${market.id}`} className="block">
      <div className="glass glass-hover h-full p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">{marketTitle(market)}</span>
          <StatusPill status={market.status} />
        </div>
        {ready ? (
          <div className="text-sm">
            <span className="text-white/50">Final score </span>
            <span className="font-bold text-white">
              {market.finalHomeGoals ?? "–"} : {market.finalAwayGoals ?? "–"}
            </span>
          </div>
        ) : (
          <div className="text-xs text-white/45">Proof fills in at full-time.</div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
          <span className="tabular-nums text-neon">{fmtMusdc(market.totalPool)} mUSDC pool</span>
          <span className={ready ? "font-semibold text-gold" : "text-white/40"}>
            {ready ? "View proof →" : "Pending →"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Grid({ children, skeleton }: { children?: React.ReactNode; skeleton?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skeleton
        ? Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/5" />
          ))
        : children}
    </div>
  );
}
