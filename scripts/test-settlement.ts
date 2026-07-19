// Deterministic unit tests for the settlement DECISION logic — no chain, no live
// match needed. Run from app/:  npm run test:settlement
//
// Covers the three pure pieces of the keeper's settlement flow:
//   1) full-time detection  (when the keeper decides to settle)
//   2) proof parsing        (TxLINE JSON -> the on-chain settle payload shape)
//   3) outcome derivation   (final score -> winning outcome, per market type)
// The on-chain guards (revert-before-lock, wrong-TxLINE-program) are covered by
// tests/prediction_escrow.test.ts; the full valid-proof->settled path needs a
// live TxLINE game_finalised proof and is exercised by the keeper/demo.
import assert from "node:assert/strict";
import { computeWinningOutcome } from "../app/lib/onchain/program.js";
import { parseTxlineScoreProof } from "../app/lib/txline/proof.js";
import { isFinalisedScoreEvent, type NormalizedScoreEvent } from "../app/lib/txline/client.js";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✔ ${name}`);
}

// 32-byte value as a number array (the parser accepts hex(0x…)/base64/array;
// arrays are unambiguous).
const hex32 = (b: number): number[] => Array(32).fill(b & 0xff);

function ev(partial: Partial<NormalizedScoreEvent>): NormalizedScoreEvent {
  return {
    eventId: null,
    seq: "1",
    fixtureId: "18257739",
    eventType: "snapshot",
    matchStatus: null,
    homeGoals: 0,
    awayGoals: 0,
    matchClock: null,
    txlineTimestamp: null,
    raw: {},
    ...partial,
  };
}

console.log("settlement logic (pure, no chain)");

// 1) FULL-TIME DETECTION — settlement only triggers on TxLINE's game_finalised
//    marker (statusId 100 AND period 100), which is what settle.ts keys on.
ok("game_finalised (statusId 100, period 100) is detected as final", () => {
  const e = ev({ eventType: "game_finalised", raw: { statusId: 100, period: 100 } });
  assert.equal(isFinalisedScoreEvent(e), true);
});
ok("game_finalised WITHOUT the 100/100 marker is NOT final", () => {
  assert.equal(isFinalisedScoreEvent(ev({ eventType: "game_finalised", raw: { statusId: 90, period: 100 } })), false);
  assert.equal(isFinalisedScoreEvent(ev({ eventType: "game_finalised", raw: { statusId: 100, period: 2 } })), false);
});
ok("a live in-play goal event is NOT final", () => {
  assert.equal(isFinalisedScoreEvent(ev({ eventType: "goal", matchStatus: "live", homeGoals: 1 })), false);
});

// 2) PROOF PARSING — TxLINE validation JSON -> the exact on-chain payload shape.
ok("parseTxlineScoreProof yields the 2 total-goal stats (key 1,2 / period 0)", () => {
  const raw = {
    summary: {
      fixtureId: 18257739,
      updateStats: { updateCount: 3, minTimestamp: "1784480000000", maxTimestamp: "1784480500000" },
      eventStatsSubTreeRoot: hex32(0xaa),
    },
    statsToProve: [
      { key: 1, value: 2, period: 0 },
      { key: 2, value: 1, period: 0 },
    ],
    statProofs: [
      [{ hash: hex32(0x01), isRightSibling: true }],
      [{ hash: hex32(0x02), isRightSibling: false }],
    ],
    subTreeProof: [{ hash: hex32(0x03), isRightSibling: true }],
    mainTreeProof: [{ hash: hex32(0x04), isRightSibling: false }],
    eventStatRoot: hex32(0xbb),
  };
  const p = parseTxlineScoreProof(raw);
  assert.equal(p.fixtureSummary.fixtureId, 18257739n);
  assert.equal(p.ts, 1784480000000n);
  assert.equal(p.stats.length, 2);
  assert.equal(p.stats[0].stat.key, 1);
  assert.equal(p.stats[1].stat.key, 2);
  assert.equal(p.stats[0].stat.period, 0);
  assert.equal(p.stats[0].stat.value, 2); // participant 1 goals
  assert.equal(p.stats[1].stat.value, 1); // participant 2 goals
  assert.equal(p.eventStatRoot.length, 32);
  assert.equal(p.fixtureProof.length, 1);
  assert.equal(p.mainTreeProof.length, 1);
});
ok("a malformed proof (wrong stat keys) is rejected", () => {
  const bad = {
    summary: { fixtureId: 1, updateStats: { updateCount: 1, minTimestamp: "1", maxTimestamp: "1" }, eventStatsSubTreeRoot: hex32(1) },
    statsToProve: [{ key: 5, value: 0, period: 0 }, { key: 6, value: 0, period: 0 }],
    statProofs: [[], []],
    subTreeProof: [],
    mainTreeProof: [],
    eventStatRoot: hex32(1),
  };
  assert.throws(() => parseTxlineScoreProof(bad));
});

// 3) OUTCOME DERIVATION — final (home,away) goals -> winning outcome index.
const MW = 0, TOT = 1, BTTS = 2;
ok("MATCH_WINNER: home win / draw / away win", () => {
  assert.equal(computeWinningOutcome(2, 1, MW, 0), 0); // Home
  assert.equal(computeWinningOutcome(1, 1, MW, 0), 1); // Draw
  assert.equal(computeWinningOutcome(0, 2, MW, 0), 2); // Away
});
ok("TOTALS O/U 2.5 (lineParam 5): over vs under", () => {
  assert.equal(computeWinningOutcome(2, 1, TOT, 5), 0); // 3 goals > 2.5 -> Over
  assert.equal(computeWinningOutcome(1, 1, TOT, 5), 1); // 2 goals < 2.5 -> Under
  assert.equal(computeWinningOutcome(3, 0, TOT, 5), 0); // 3 goals -> Over
});
ok("BTTS: yes when both scored, no otherwise", () => {
  assert.equal(computeWinningOutcome(2, 1, BTTS, 0), 0); // Yes
  assert.equal(computeWinningOutcome(2, 0, BTTS, 0), 1); // No
  assert.equal(computeWinningOutcome(0, 0, BTTS, 0), 1); // No
});

console.log(`\n✅ ${passed} passing`);
