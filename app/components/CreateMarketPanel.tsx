"use client";

import { useMemo, useState } from "react";
import type { Fixture, Market, MarketType } from "@/app/_lib/api";
import { api, ApiError, marketTypeLabel } from "@/app/_lib/api";
import { Button, Spinner, cx } from "./ui";

const TYPES: MarketType[] = ["MATCH_WINNER", "TOTALS", "BTTS"];
const TOTALS_LINES = [0.5, 1.5, 2.5, 3.5];

/** Default lock time = kickoff if in the future, else now + 10 min. Returns value for datetime-local. */
function defaultLockLocal(fixture: Fixture): string {
  const kick = fixture.kickoffAt ? new Date(fixture.kickoffAt).getTime() : NaN;
  const base = Number.isFinite(kick) && kick > Date.now() ? kick : Date.now() + 10 * 60_000;
  const d = new Date(base);
  // to local `YYYY-MM-DDTHH:mm`
  const off = d.getTimezoneOffset();
  return new Date(base - off * 60_000).toISOString().slice(0, 16);
}

export function CreateMarketPanel({
  fixture,
  onCreated,
}: {
  fixture: Fixture;
  onCreated?: (m: Market) => void;
}) {
  const [type, setType] = useState<MarketType>("MATCH_WINNER");
  const [line, setLine] = useState<number>(2.5);
  const [lockLocal, setLockLocal] = useState<string>(() => defaultLockLocal(fixture));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lineParam = useMemo(() => Math.round(line * 2), [line]); // e.g. 2.5 -> 5 (odd)

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const lockAt = new Date(lockLocal).toISOString();
      const { market } = await api.createMarket({
        fixtureId: fixture.id,
        marketType: type,
        lineParam: type === "TOTALS" ? lineParam : null,
        lockAt,
      });
      setMsg({ ok: true, text: `Market created (${marketTypeLabel(type)}).` });
      onCreated?.(market);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-white">Create a market</h3>
        <p className="text-xs text-white/45">
          You&apos;ll launch it on-chain for this fixture. Anyone can then stake.
        </p>
      </div>

      {/* type */}
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Market type</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cx(
                "rounded-xl border px-3 py-2 text-sm font-medium transition",
                type === t
                  ? "border-neon bg-neon/15 text-neon"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/25",
              )}
            >
              {marketTypeLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {/* totals line */}
      {type === "TOTALS" ? (
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
            Goal line (Over / Under)
          </div>
          <div className="flex flex-wrap gap-2">
            {TOTALS_LINES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLine(l)}
                className={cx(
                  "rounded-lg border px-3 py-1.5 text-sm tabular-nums transition",
                  line === l
                    ? "border-neon bg-neon/15 text-neon"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/25",
                )}
              >
                {l.toFixed(1)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-white/35">
            On-chain line_param = line × 2 = <span className="font-mono text-white/60">{lineParam}</span>
          </p>
        </div>
      ) : null}

      {/* lock time */}
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Locks at</div>
        <input
          type="datetime-local"
          value={lockLocal}
          onChange={(e) => setLockLocal(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2 text-sm text-white outline-none focus:border-neon/50 [color-scheme:dark]"
        />
      </div>

      <Button onClick={create} disabled={busy} className="w-full">
        {busy ? <Spinner /> : "🏗"} Create market
      </Button>

      {msg ? (
        <div
          className={cx(
            "rounded-lg border px-3 py-2 text-sm",
            msg.ok
              ? "border-neon/30 bg-neon/10 text-neon"
              : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
