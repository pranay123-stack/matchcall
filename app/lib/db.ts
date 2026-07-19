// MatchCall — local SQLite store (better-sqlite3).
//
// The chain is the source of truth for pools/outcomes; this DB is the index that
// lets routes list markets, resolve a marketId -> PDA, remember which wallets
// staked, and cache the settlement proof for the receipt endpoint.
//
// The connection is opened LAZILY on first use — never at import time — so that
// `next build`'s page-data collection (which loads every route module at once)
// doesn't race multiple opens into a SQLITE_BUSY lock. WAL + busy_timeout keep
// concurrent SSE/route access happy at runtime.
import Database from "better-sqlite3";
import path from "node:path";
import { config } from "./config.js";

let _db: Database.Database | null = null;
const _stmts = new Map<string, Database.Statement>();

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.isAbsolute(config.DATABASE_PATH)
    ? config.DATABASE_PATH
    : path.join(process.cwd(), config.DATABASE_PATH);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
CREATE TABLE IF NOT EXISTS markets (
  id               TEXT PRIMARY KEY,
  fixtureId        TEXT NOT NULL,
  marketType       INTEGER NOT NULL,
  lineParam        INTEGER,
  lockAt           INTEGER NOT NULL,
  participant1IsHome INTEGER NOT NULL DEFAULT 1,
  marketPda        TEXT NOT NULL,
  escrow           TEXT NOT NULL,
  seedHex          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OPEN',
  homeTeam         TEXT,
  awayTeam         TEXT,
  winningOutcome   INTEGER,
  finalHomeGoals   INTEGER,
  finalAwayGoals   INTEGER,
  settleSignature  TEXT,
  proofJson        TEXT,
  createdAt        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  marketId   TEXT NOT NULL,
  wallet     TEXT NOT NULL,
  outcome    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0,
  signature  TEXT,
  PRIMARY KEY (marketId, wallet, outcome)
);

CREATE INDEX IF NOT EXISTS idx_positions_market ON positions (marketId);
`);
  // Lightweight migration for DBs created before homeTeam/awayTeam existed.
  for (const col of ["homeTeam", "awayTeam"]) {
    try {
      db.exec(`ALTER TABLE markets ADD COLUMN ${col} TEXT`);
    } catch {
      /* column already exists */
    }
  }
  _db = db;
  return db;
}

/** Lazily prepare + cache a statement (keyed by its SQL text). */
function prep(sql: string): Database.Statement {
  let s = _stmts.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    _stmts.set(sql, s);
  }
  return s;
}

/** Explicit initializer for scripts (e.g. `npm run db:init`). */
export function initDb(): void {
  getDb();
}

// -------------------------------- types -------------------------------------
export type MarketRow = {
  id: string;
  fixtureId: string;
  marketType: number;
  lineParam: number | null;
  lockAt: number; // unix seconds
  participant1IsHome: number; // 0/1
  marketPda: string;
  escrow: string;
  seedHex: string;
  status: string;
  homeTeam: string | null;
  awayTeam: string | null;
  winningOutcome: number | null;
  finalHomeGoals: number | null;
  finalAwayGoals: number | null;
  settleSignature: string | null;
  proofJson: string | null;
  createdAt: number;
};

export type PositionRow = {
  marketId: string;
  wallet: string;
  outcome: number;
  amount: number; // mUSDC base units
  claimed: number; // 0/1
  signature: string | null;
};

// ------------------------------- markets ------------------------------------
const INSERT_MARKET = `
  INSERT INTO markets (
    id, fixtureId, marketType, lineParam, lockAt, participant1IsHome,
    marketPda, escrow, seedHex, status, homeTeam, awayTeam, createdAt
  ) VALUES (
    @id, @fixtureId, @marketType, @lineParam, @lockAt, @participant1IsHome,
    @marketPda, @escrow, @seedHex, 'OPEN', @homeTeam, @awayTeam, @createdAt
  )`;

export function insertMarket(input: {
  id: string;
  fixtureId: string;
  marketType: number;
  lineParam: number | null;
  lockAt: number;
  participant1IsHome: boolean;
  marketPda: string;
  escrow: string;
  seedHex: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
}): MarketRow {
  prep(INSERT_MARKET).run({
    ...input,
    participant1IsHome: input.participant1IsHome ? 1 : 0,
    lineParam: input.lineParam ?? null,
    homeTeam: input.homeTeam ?? null,
    awayTeam: input.awayTeam ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
  return getMarket(input.id)!;
}

export function getMarket(id: string): MarketRow | null {
  return (prep(`SELECT * FROM markets WHERE id = ?`).get(id) as MarketRow | undefined) ?? null;
}

export function listMarkets(): MarketRow[] {
  return prep(`SELECT * FROM markets ORDER BY createdAt DESC`).all() as MarketRow[];
}

export function updateMarketStatus(id: string, status: string): void {
  prep(`UPDATE markets SET status = ? WHERE id = ?`).run(status, id);
}

const RECORD_SETTLEMENT = `
  UPDATE markets SET
    status = 'SETTLED',
    winningOutcome = @winningOutcome,
    finalHomeGoals = @finalHomeGoals,
    finalAwayGoals = @finalAwayGoals,
    settleSignature = @settleSignature,
    proofJson = @proofJson
  WHERE id = @id`;

export function recordSettlement(input: {
  id: string;
  winningOutcome: number;
  finalHomeGoals: number;
  finalAwayGoals: number;
  settleSignature: string;
  proofJson: string;
}): MarketRow | null {
  prep(RECORD_SETTLEMENT).run(input);
  return getMarket(input.id);
}

// ------------------------------ positions -----------------------------------
const UPSERT_POSITION = `
  INSERT INTO positions (marketId, wallet, outcome, amount, claimed, signature)
  VALUES (@marketId, @wallet, @outcome, @amount, 0, @signature)
  ON CONFLICT (marketId, wallet, outcome) DO UPDATE SET
    amount = amount + excluded.amount,
    signature = excluded.signature`;

export function upsertPosition(input: {
  marketId: string;
  wallet: string;
  outcome: number;
  amount: number; // base units
  signature: string;
}): PositionRow {
  prep(UPSERT_POSITION).run(input);
  return getPosition(input.marketId, input.wallet, input.outcome)!;
}

const SET_POSITION = `
  INSERT INTO positions (marketId, wallet, outcome, amount, claimed, signature)
  VALUES (@marketId, @wallet, @outcome, @amount, 0, @signature)
  ON CONFLICT (marketId, wallet, outcome) DO UPDATE SET
    amount = excluded.amount,
    signature = excluded.signature`;

/** Set a position's amount to an exact value (on-chain cumulative total). */
export function setPosition(input: {
  marketId: string;
  wallet: string;
  outcome: number;
  amount: number; // base units
  signature: string;
}): PositionRow {
  prep(SET_POSITION).run(input);
  return getPosition(input.marketId, input.wallet, input.outcome)!;
}

export function getPosition(marketId: string, wallet: string, outcome: number): PositionRow | null {
  return (
    (prep(`SELECT * FROM positions WHERE marketId = ? AND wallet = ? AND outcome = ?`).get(
      marketId,
      wallet,
      outcome
    ) as PositionRow | undefined) ?? null
  );
}

export function listPositions(marketId: string): PositionRow[] {
  return prep(`SELECT * FROM positions WHERE marketId = ?`).all(marketId) as PositionRow[];
}

export function markPositionClaimed(marketId: string, wallet: string, outcome: number): void {
  prep(`UPDATE positions SET claimed = 1 WHERE marketId = ? AND wallet = ? AND outcome = ?`).run(
    marketId,
    wallet,
    outcome
  );
}
