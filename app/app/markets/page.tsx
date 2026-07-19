"use client";

import { useEffect, useState } from "react";
import { api, type Market } from "@/app/_lib/api";
import { MarketCard } from "@/components/MarketCard";
import { Card, SectionTitle, StatePanel } from "@/components/ui";

export default function MarketsPage() {
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

  const open = (markets ?? []).filter((m) => m.status === "OPEN");
  const resolved = (markets ?? []).filter((m) => m.status !== "OPEN");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">Markets</h1>
        <p className="mt-1 text-sm text-white/60">
          Every prediction market, live from Solana devnet. Pools and status are read straight
          from the on-chain <span className="text-neon">prediction_escrow</span> program.
        </p>
      </div>

      {error && !markets ? (
        <StatePanel kind="error" title="Couldn't load markets" detail={error} />
      ) : null}

      <section>
        <SectionTitle right={<span className="text-xs text-white/40">{open.length} open</span>}>
          Open for staking
        </SectionTitle>
        {markets == null ? (
          <Grid skeleton />
        ) : open.length === 0 ? (
          <Card className="text-sm text-white/50">
            No open markets. Open a fixture from the Dashboard and hit “Create market”.
          </Card>
        ) : (
          <Grid>
            {open.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </Grid>
        )}
      </section>

      {resolved.length > 0 ? (
        <section>
          <SectionTitle>Settled &amp; resolving</SectionTitle>
          <Grid>
            {resolved.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </Grid>
        </section>
      ) : null}
    </div>
  );
}

function Grid({ children, skeleton }: { children?: React.ReactNode; skeleton?: boolean }) {
  if (skeleton) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    );
  }
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
