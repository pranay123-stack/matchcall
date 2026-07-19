import { config } from "./config.js";
import { makeLogger, errText } from "./logger.js";
import { FixtureTracker, runScoreStream } from "./txlineStream.js";
import { fetchMarkets, settlementCandidates, requestBackendSettle, type Market } from "./markets.js";
import { directSettle, directSettleEnabled } from "./directSettle.js";

const log = makeLogger("keeper");

// Idempotency + concurrency guards (in-memory; on-chain state is source of truth).
const settled = new Set<string>(); // marketIds we have confirmed SETTLED/REFUNDING
const inFlight = new Set<string>(); // marketIds currently being settled
let lastSettle: { marketId: string; signature: string; at: string } | null = null;

/** Report liveness to the backend so the dashboard can show keeper status. */
async function heartbeat(tracker: FixtureTracker): Promise<void> {
  try {
    await fetch(`${config.apiBase}/api/keeper/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        streamConnected: true,
        fixturesWatched: tracker.watchedCount(),
        lastEventAt: tracker.lastEventIso(),
        settledCount: settled.size,
        lastSettle,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* backend may be down; ignore */
  }
}

async function pollOnce(tracker: FixtureTracker): Promise<void> {
  let markets: Market[];
  try {
    markets = await fetchMarkets();
  } catch (err) {
    log.error(`could not fetch markets from ${config.apiBase}/api/markets`, err);
    return;
  }

  // Idempotent: anything already terminal on-chain is remembered and skipped.
  for (const m of markets) {
    if (m.status === "SETTLED" || m.status === "REFUNDING") settled.add(m.id);
  }

  const candidates = settlementCandidates(markets).filter(
    (m) => !settled.has(m.id) && !inFlight.has(m.id)
  );
  if (candidates.length === 0) return;

  for (const market of candidates) {
    const fx = tracker.finalWithSeq(market.fixtureId);
    if (!fx) {
      const s = tracker.get(market.fixtureId);
      log.info(
        `market ${market.id} (fixture ${market.fixtureId}) past lock but not final yet` +
          (s ? ` [status ${s.matchStatus ?? "?"}, seq ${s.seq ?? "none"}]` : " [no stream data yet]")
      );
      continue;
    }
    inFlight.add(market.id);
    settleMarket(market, fx.seq!).finally(() => inFlight.delete(market.id));
  }
}

async function settleMarket(market: Market, seq: string): Promise<void> {
  const tag = `fixture ${market.fixtureId} FT -> settling market ${market.id} (seq ${seq})`;
  log.decision(tag);

  // Primary path: backend does proof-fetch + CPI settle + records the receipt.
  const res = await requestBackendSettle(market.id, seq);
  if (res.ok) {
    settled.add(market.id);
    lastSettle = { marketId: market.id, signature: res.signature, at: new Date().toISOString() };
    log.decision(`${tag} -> tx ${res.signature || "(recorded)"} via backend`);
    return;
  }

  log.warn(`backend settle for market ${market.id} failed (${res.status}): ${res.error}`);

  // Fallback: settle directly with the market authority + local Anchor IDL.
  if (directSettleEnabled()) {
    log.info(`attempting direct on-chain settle for market ${market.id}`);
    const direct = await directSettle(market, seq);
    if (direct.ok) {
      settled.add(market.id);
      lastSettle = { marketId: market.id, signature: direct.signature, at: new Date().toISOString() };
      log.decision(`${tag} -> tx ${direct.signature} via direct-settle`);
      return;
    }
    log.error(`direct settle for market ${market.id} failed`, direct.error);
  }

  // Leave it unmarked so the next poll retries (e.g. once the backend route is live).
  log.warn(`market ${market.id} left OPEN; will retry next poll`);
}

async function main(): Promise<void> {
  log.info("MatchCall keeper starting");
  log.info(`  api base:        ${config.apiBase}`);
  log.info(`  rpc:             ${config.rpcUrl}`);
  log.info(`  program:         ${config.predictionEscrowProgramId}`);
  log.info(`  txline stream:   ${config.txlineBaseUrl}scores/stream`);
  log.info(`  poll interval:   ${config.pollIntervalMs}ms`);
  log.info(`  direct-settle:   ${directSettleEnabled() ? "enabled" : "disabled (backend route only)"}`);
  if (!config.txlineAuthJwt || !config.txlineApiToken) {
    log.warn("TXLINE_AUTH_JWT / TXLINE_API_TOKEN not set — run the txline:activate script first");
  }

  const controller = new AbortController();
  const shutdown = (sig: string) => {
    log.info(`received ${sig}; shutting down`);
    controller.abort();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const tracker = new FixtureTracker();
  // Fire-and-forget the SSE watcher; it self-reconnects until aborted.
  runScoreStream(tracker, controller.signal).catch((err) =>
    log.error("score stream terminated unexpectedly", err)
  );

  // Poll loop.
  while (!controller.signal.aborted) {
    try {
      await pollOnce(tracker);
    } catch (err) {
      log.error("poll iteration failed", err);
    }
    void heartbeat(tracker);
    await sleep(config.pollIntervalMs, controller.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      res();
    }, { once: true });
  });
}

main().catch((err) => {
  console.error(`fatal: ${errText(err)}`);
  process.exit(1);
});
