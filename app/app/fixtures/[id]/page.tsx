"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Fixture, type Market } from "@/app/_lib/api";
import { ScoreHeader } from "@/components/ScoreHeader";
import { OddsPanel } from "@/components/OddsPanel";
import { CreateMarketPanel } from "@/components/CreateMarketPanel";
import { MarketCard } from "@/components/MarketCard";
import { BackLink, Card, SectionTitle, StatePanel } from "@/components/ui";

export default function FixtureDetailPage({ params }: { params: { id: string } }) {
  const fixtureId = params.id;
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFixture = useCallback(async () => {
    try {
      const { fixtures } = await api.getFixtures();
      const f = fixtures.find((x) => String(x.id) === String(fixtureId)) ?? null;
      setFixture(f);
      if (!f) setError("Fixture not found.");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [fixtureId]);

  const loadMarkets = useCallback(async () => {
    try {
      const { markets } = await api.getMarkets();
      setMarkets(markets.filter((m) => String(m.fixtureId) === String(fixtureId)));
    } catch {
      setMarkets((m) => m ?? []);
    }
  }, [fixtureId]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadFixture(), loadMarkets()]).finally(() => setLoading(false));
    const t = setInterval(loadFixture, 15_000);
    return () => clearInterval(t);
  }, [loadFixture, loadMarkets]);

  if (loading && !fixture) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (!fixture) {
    return (
      <div className="space-y-4">
        <BackLink href="/">Back to dashboard</BackLink>
        <StatePanel kind="error" title="Fixture not found" detail={error ?? undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/">Back to dashboard</BackLink>

      <ScoreHeader fixture={fixture} />

      {/* odds + create */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <OddsPanel fixtureId={fixture.id} />
        </Card>
        <Card>
          <CreateMarketPanel
            fixture={fixture}
            onCreated={(m) => {
              setMarkets((prev) => {
                const rest = (prev ?? []).filter((x) => x.id !== m.id);
                return [m, ...rest];
              });
            }}
          />
        </Card>
      </div>

      {/* markets on this fixture — horizontal cards, click one to stake */}
      <section className="space-y-3">
        <SectionTitle right={<span className="text-xs text-white/40">{markets?.length ?? 0}</span>}>
          Markets on this fixture
        </SectionTitle>

        {markets == null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <Card className="text-sm text-white/50">
            No markets yet — create the first one above. It goes live on-chain instantly.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
