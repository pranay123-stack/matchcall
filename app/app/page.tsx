"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Fixture, type Market } from "@/app/_lib/api";
import { FixtureCard } from "@/components/FixtureCard";
import { MarketCard } from "@/components/MarketCard";
import { KeeperStatus } from "@/components/KeeperStatus";
import { Card, LiveBadge, SectionTitle, StatePanel } from "@/components/ui";

export default function Dashboard() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const loadFixtures = useCallback(async () => {
    try {
      const { fixtures } = await api.getFixtures();
      setFixtures(fixtures);
      setError(null);
    } catch (e) {
      if (firstLoad.current) setError((e as Error).message);
    }
  }, []);

  const loadMarkets = useCallback(async () => {
    try {
      const { markets } = await api.getMarkets();
      setMarkets(markets);
    } catch {
      setMarkets((m) => m ?? []);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadFixtures(), loadMarkets()]).finally(() => {
      firstLoad.current = false;
    });
    const t = setInterval(loadFixtures, 15_000); // auto-refresh live scores
    return () => clearInterval(t);
  }, [loadFixtures, loadMarkets]);

  const live = (fixtures ?? []).filter((f) => f.live);
  const upcoming = (fixtures ?? []).filter((f) => !f.live);
  const activeMarkets = (markets ?? []).filter((m) => m.status === "OPEN");
  const otherMarkets = (markets ?? []).filter((m) => m.status !== "OPEN");

  return (
    <div className="space-y-10">
      <Hero liveCount={live.length} marketCount={(markets ?? []).length} />

      <KeeperStatus />

      {error && !fixtures ? (
        <StatePanel kind="error" title="Couldn't load fixtures" detail={error} />
      ) : null}

      {/* LIVE */}
      <section>
        <SectionTitle right={live.length ? <LiveBadge /> : null}>Live now</SectionTitle>
        {fixtures == null ? (
          <SkeletonGrid />
        ) : live.length === 0 ? (
          <Card className="text-sm text-white/50">
            No matches are live right now. Check the upcoming fixtures below.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((f) => (
              <FixtureCard key={f.id} fixture={f} />
            ))}
          </div>
        )}
      </section>

      {/* MARKETS */}
      <section id="markets">
        <SectionTitle right={<span className="text-xs text-white/40">{activeMarkets.length} open</span>}>
          Active markets
        </SectionTitle>
        {markets == null ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 w-64 flex-shrink-0 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : activeMarkets.length === 0 ? (
          <Card className="text-sm text-white/50">
            No open markets yet. Open a fixture and hit “Create market” to launch one.
          </Card>
        ) : (
          <div className="flex snap-x gap-3 overflow-x-auto pb-2">
            {activeMarkets.map((m) => (
              <div key={m.id} className="w-72 flex-shrink-0 snap-start">
                <MarketCard market={m} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* UPCOMING */}
      <section>
        <SectionTitle>Upcoming fixtures</SectionTitle>
        {fixtures == null ? (
          <SkeletonGrid />
        ) : upcoming.length === 0 ? (
          <Card className="text-sm text-white/50">No upcoming fixtures found.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((f) => (
              <FixtureCard key={f.id} fixture={f} />
            ))}
          </div>
        )}
      </section>

      {/* SETTLED / REFUNDING markets */}
      {otherMarkets.length > 0 ? (
        <section>
          <SectionTitle>Settled &amp; resolving</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {otherMarkets.map((m) => (
              <div key={m.id} className="w-72 flex-shrink-0">
                <MarketCard market={m} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Hero({ liveCount, marketCount }: { liveCount: number; marketCount: number }) {
  return (
    <div className="glass relative overflow-hidden p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-neon/20 blur-3xl" />
      <div className="relative">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-wider text-white/60">
          Trustlessly settled · TxLINE proofs
        </div>
        <h1 className="max-w-2xl text-2xl font-extrabold leading-tight sm:text-3xl">
          Call the match. <span className="text-neon">Stake mUSDC.</span> Settle on-chain with
          cryptographic proof.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-white/60">
          Live World Cup prediction markets on Solana devnet. Every payout is proved against
          TxLINE&apos;s signed, on-chain sports data — no oracle you have to trust.
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <Stat value={liveCount} label="live matches" accent />
          <Stat value={marketCount} label="markets" />
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-extrabold tabular-nums ${accent ? "text-neon" : "text-white"}`}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
      ))}
    </div>
  );
}
