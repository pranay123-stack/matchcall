// In-memory activity stream: markets created, predictions placed, settlements.
// A module-level EventEmitter fans events out to all open SSE connections in the
// same server process (fine for a single-instance demo).
import { EventEmitter } from "node:events";

export type Activity =
  | { id: number; at: string; type: "market_created"; marketId: string; match: string; market: string }
  | {
      id: number;
      at: string;
      type: "prediction_placed";
      marketId: string;
      match: string;
      market: string;
      wallet: string;
      outcome: string;
      amount: number;
    }
  | {
      id: number;
      at: string;
      type: "market_settled";
      marketId: string;
      match: string;
      market: string;
      finalScore: string;
      winner: string;
      signature: string;
    };

// Omit that distributes over the discriminated union (so per-variant fields
// like `wallet` / `finalScore` stay known).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ActivityInput = DistributiveOmit<Activity, "id" | "at">;

const buffer: Activity[] = [];
const MAX = 100;
let seq = 0;
const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export function recordActivity(a: ActivityInput): void {
  const full = { ...a, id: ++seq, at: new Date().toISOString() } as Activity;
  buffer.push(full);
  if (buffer.length > MAX) buffer.shift();
  emitter.emit("activity", full);
}

export function recentActivity(n = 30): Activity[] {
  return buffer.slice(-n).reverse();
}

export function onActivity(cb: (a: Activity) => void): () => void {
  emitter.on("activity", cb);
  return () => emitter.off("activity", cb);
}
