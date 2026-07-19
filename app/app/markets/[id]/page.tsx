"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  api,
  explorerAddr,
  explorerTx,
  fmtMusdc,
  marketTitle,
  shortAddr,
  type Fixture,
  type Market,
  type Position,
} from "@/app/_lib/api";
import { PredictionWidget } from "@/components/PredictionWidget";
import { ClaimButton } from "@/components/ClaimButton";
import { BackLink, Card, SectionTitle, StatePanel, StatusPill } from "@/components/ui";

export default function MarketDetailPage({ params }: { params: { id: string } }) {
  const marketId = params.id;
  const { publicKey } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { market, positions } = await api.getMarket(marketId);
      setMarket(market);
      setPositions(positions ?? []);
      setError(null);
      // best-effort: resolve fixture for team names
      try {
        const { fixtures } = await api.getFixtures();
        setFixture(fixtures.find((f) => String(f.id) === String(market.fixtureId)) ?? null);
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [marketId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  if (loading && !market) {
    return <div className="h-64 animate-pulse rounded-2xl bg-white/5" />;
  }
  if (!market) {
    return (
      <div className="space-y-4">
        <BackLink href="/">Back to dashboard</BackLink>
        <StatePanel kind="error" title="Market not found" detail={error ?? undefined} />
      </div>
    );
  }

  const settled = market.status !== "OPEN";
  const winnerLabel =
    market.winningOutcome != null
      ? market.outcomes.find((o) => o.index === market.winningOutcome)?.label
      : null;
  const myPositions = publicKey
    ? positions.filter((p) => p.wallet === publicKey.toBase58())
    : [];

  return (
    <div className="space-y-6">
      <BackLink href={`/fixtures/${market.fixtureId}`}>Back to fixture</BackLink>

      {/* header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40">
              {fixture ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : "Market"}
            </div>
            <h1 className="text-xl font-extrabold text-white sm:text-2xl">{marketTitle(market)}</h1>
          </div>
          <StatusPill status={market.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total pool" value={`${fmtMusdc(market.totalPool)} mUSDC`} accent />
          <Stat
            label="Final score"
            value={
              market.finalHomeGoals != null && market.finalAwayGoals != null
                ? `${market.finalHomeGoals} : ${market.finalAwayGoals}`
                : "—"
            }
          />
          <Stat label="Winning outcome" value={winnerLabel ?? "—"} gold={!!winnerLabel} />
          <Stat
            label="Market PDA"
            value={
              <a
                className="font-mono text-neon hover:underline"
                href={explorerAddr(market.marketPda)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(market.marketPda)}
              </a>
            }
          />
        </div>

        {settled ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
            {market.settleSignature ? (
              <a
                className="text-sm text-neon hover:underline"
                href={explorerTx(market.settleSignature)}
                target="_blank"
                rel="noreferrer"
              >
                Settlement tx ↗
              </a>
            ) : null}
            <Link
              href={`/receipts/${market.id}`}
              className="rounded-lg border border-gold/40 px-3 py-1.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
            >
              View verifiable receipt →
            </Link>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* place prediction */}
        <Card>
          <PredictionWidget market={market} onDone={load} />
        </Card>

        {/* claim + positions */}
        <div className="space-y-6">
          {settled ? (
            <Card>
              <h3 className="mb-3 font-semibold text-white">Claim</h3>
              <ClaimButton market={market} onDone={load} />
            </Card>
          ) : null}

          <Card>
            <SectionTitle right={<span className="text-xs text-white/40">{positions.length}</span>}>
              Positions
            </SectionTitle>
            {positions.length === 0 ? (
              <p className="text-sm text-white/50">No stakes placed yet.</p>
            ) : (
              <div className="space-y-1.5">
                {positions.map((p, i) => {
                  const mine = publicKey && p.wallet === publicKey.toBase58();
                  const label =
                    market.outcomes.find((o) => o.index === p.outcome)?.label ?? `#${p.outcome}`;
                  return (
                    <div
                      key={`${p.wallet}-${p.outcome}-${i}`}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                        mine ? "bg-neon/10 ring-1 ring-neon/25" : "bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-white/60">{shortAddr(p.wallet)}</span>
                        {mine ? <span className="text-[10px] text-neon">you</span> : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-white/70">{label}</span>
                        <span className="tabular-nums font-semibold text-white">
                          {fmtMusdc(p.amount)}
                        </span>
                        {p.claimed ? (
                          <span className="text-[10px] uppercase text-gold">claimed</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {myPositions.length > 0 && settled ? (
              <p className="mt-3 text-[11px] text-white/40">
                You have {myPositions.length} position(s) in this settled market — claim above.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  gold,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  gold?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div
        className={`mt-0.5 font-semibold ${accent ? "text-neon" : gold ? "text-gold" : "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}
