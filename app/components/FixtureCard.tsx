import Link from "next/link";
import type { Fixture } from "@/app/_lib/api";
import { relativeTime } from "@/app/_lib/api";
import { LiveBadge, cx } from "./ui";

export function TeamRow({
  name,
  goals,
  emphasize,
}: {
  name: string;
  goals?: number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cx("truncate text-sm", emphasize ? "font-semibold text-white" : "text-white/85")}>
        {name}
      </span>
      {goals != null ? (
        <span className="tabular-nums text-lg font-bold text-white">{goals}</span>
      ) : null}
    </div>
  );
}

export function FixtureCard({ fixture }: { fixture: Fixture }) {
  const hasScore = fixture.homeGoals != null && fixture.awayGoals != null;
  return (
    <Link href={`/fixtures/${fixture.id}`} className="block">
      <div className="glass glass-hover h-full p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wider text-white/40">
            {fixture.competition || "World Cup"}
          </span>
          {fixture.live ? (
            <LiveBadge />
          ) : (
            <span className="text-[11px] text-white/40">{relativeTime(fixture.kickoffAt)}</span>
          )}
        </div>

        <div className="space-y-1.5">
          <TeamRow name={fixture.homeTeam} goals={hasScore ? fixture.homeGoals : undefined} />
          <TeamRow name={fixture.awayTeam} goals={hasScore ? fixture.awayGoals : undefined} />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-xs text-white/50">
          <span className="capitalize">{(fixture.status || "scheduled").toLowerCase()}</span>
          {fixture.live && fixture.matchClock ? (
            <span className="font-mono text-neon">{fixture.matchClock}</span>
          ) : (
            <span className="text-neon/80">View →</span>
          )}
        </div>
      </div>
    </Link>
  );
}
