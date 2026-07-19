"use client";

import { useEffect, useState } from "react";
import { api, type Fixture } from "@/app/_lib/api";
import { FixtureCard } from "@/components/FixtureCard";
import { Card, LiveBadge, SectionTitle, StatePanel } from "@/components/ui";

export default function FixturesPage() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { fixtures } = await api.getFixtures();
        if (alive) {
          setFixtures(fixtures);
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

  const live = (fixtures ?? []).filter((f) => f.live);
  const upcoming = (fixtures ?? []).filter((f) => !f.live);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">Fixtures</h1>
        <p className="mt-1 text-sm text-white/60">
          Live World Cup fixtures straight from TxLINE&apos;s signed feed. Open one to see live
          scores, implied-probability odds, and to create or stake a market.
        </p>
      </div>

      {error && !fixtures ? (
        <StatePanel kind="error" title="Couldn't load fixtures" detail={error} />
      ) : null}

      <section>
        <SectionTitle right={live.length ? <LiveBadge /> : null}>Live now</SectionTitle>
        {fixtures == null ? (
          <Grid skeleton />
        ) : live.length === 0 ? (
          <Card className="text-sm text-white/50">No matches are live right now.</Card>
        ) : (
          <Grid>
            {live.map((f) => (
              <FixtureCard key={f.id} fixture={f} />
            ))}
          </Grid>
        )}
      </section>

      <section>
        <SectionTitle>Upcoming</SectionTitle>
        {fixtures == null ? (
          <Grid skeleton />
        ) : upcoming.length === 0 ? (
          <Card className="text-sm text-white/50">No upcoming fixtures found.</Card>
        ) : (
          <Grid>
            {upcoming.map((f) => (
              <FixtureCard key={f.id} fixture={f} />
            ))}
          </Grid>
        )}
      </section>
    </div>
  );
}

function Grid({ children, skeleton }: { children?: React.ReactNode; skeleton?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {skeleton
        ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
          ))
        : children}
    </div>
  );
}
