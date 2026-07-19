// In-memory keeper liveness, updated by the keeper's heartbeat POSTs and read by
// the dashboard status widget. Resets on server restart — fine for a live demo.

export type KeeperHeartbeat = {
  streamConnected: boolean;
  fixturesWatched: number;
  lastEventAt: string | null;
  settledCount: number;
  lastSettle: { marketId: string; signature: string; at: string } | null;
};

export type KeeperStatus = KeeperHeartbeat & {
  online: boolean; // heartbeat seen within the freshness window
  lastHeartbeat: string | null;
};

const FRESHNESS_MS = 30_000;

let state: KeeperHeartbeat & { lastHeartbeat: number | null } = {
  streamConnected: false,
  fixturesWatched: 0,
  lastEventAt: null,
  settledCount: 0,
  lastSettle: null,
  lastHeartbeat: null,
};

export function recordHeartbeat(partial: Partial<KeeperHeartbeat>): void {
  state = { ...state, ...partial, lastHeartbeat: Date.now() };
}

export function getKeeperStatus(): KeeperStatus {
  const online = state.lastHeartbeat != null && Date.now() - state.lastHeartbeat < FRESHNESS_MS;
  return {
    online,
    streamConnected: online && state.streamConnected,
    fixturesWatched: state.fixturesWatched,
    lastEventAt: state.lastEventAt,
    settledCount: state.settledCount,
    lastSettle: state.lastSettle,
    lastHeartbeat: state.lastHeartbeat ? new Date(state.lastHeartbeat).toISOString() : null,
  };
}
