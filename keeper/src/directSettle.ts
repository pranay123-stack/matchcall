import { existsSync, readFileSync } from "node:fs";
import { config, TXLINE_DEVNET_PROGRAM_ID } from "./config.js";
import { makeLogger } from "./logger.js";
import type { Market } from "./markets.js";

const log = makeLogger("direct-settle");

// Lazily loaded so a missing IDL / anchor never crashes the keeper at import.
type Anchor = typeof import("@coral-xyz/anchor");
type Web3 = typeof import("@solana/web3.js");

let cached: { anchor: Anchor; web3: Web3; program: any; authority: any } | null = null;
let initFailed = false;

async function ensureProgram() {
  if (cached) return cached;
  if (initFailed) return null;
  try {
    if (!config.directSettleEnabled) throw new Error("KEEPER_DIRECT_SETTLE=false");
    if (!config.marketAuthoritySecret) throw new Error("MARKET_AUTHORITY_SECRET not set");
    if (!existsSync(config.idlPath)) throw new Error(`IDL not found at ${config.idlPath} (run 'anchor build')`);

    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");
    const idl = JSON.parse(readFileSync(config.idlPath, "utf8"));

    const secret = JSON.parse(config.marketAuthoritySecret) as number[];
    const authority = web3.Keypair.fromSecretKey(Uint8Array.from(secret));
    const connection = new web3.Connection(config.rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(authority);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new anchor.Program(idl, provider);

    cached = { anchor, web3, program, authority };
    log.info(`direct-settle ready (authority ${authority.publicKey.toBase58()})`);
    return cached;
  } catch (err) {
    initFailed = true;
    log.warn(`direct-settle unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function directSettleEnabled(): boolean {
  return config.directSettleEnabled && !!config.marketAuthoritySecret && existsSync(config.idlPath);
}

export async function directSettle(market: Market, seq: string): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const ctx = await ensureProgram();
  if (!ctx) return { ok: false, error: "direct-settle path is unavailable" };
  const { anchor, web3, program, authority } = ctx;

  try {
    const raw = await fetchStatValidation(market.fixtureId, seq);
    const payload = toAnchorPayload(raw, anchor.BN);

    // TxLINE daily_scores_roots PDA — derived from the PROOF timestamp, per docs.
    const epochDay = Math.floor(Number(payload.ts.toString()) / 86_400_000);
    const day = Buffer.alloc(2);
    day.writeUInt16LE(epochDay);
    const [dailyScoresRoots] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), day],
      new web3.PublicKey(TXLINE_DEVNET_PROGRAM_ID)
    );

    const signature: string = await program.methods
      .settleMarket(payload)
      .accounts({
        cranker: authority.publicKey,
        market: new web3.PublicKey(market.marketPda),
        txlineProgram: new web3.PublicKey(TXLINE_DEVNET_PROGRAM_ID),
        dailyScoresMerkleRoots: dailyScoresRoots
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .rpc();

    return { ok: true, signature };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- TxLINE proof fetch + parse (Anchor-encodable shape) ----
async function fetchStatValidation(fixtureId: string, seq: string): Promise<Record<string, unknown>> {
  if (!/^\d+$/.test(fixtureId) || !/^\d+$/.test(seq)) {
    throw new Error("stat-validation requires numeric fixtureId and seq");
  }
  const { jwt, apiToken } = config.requiredTxline();
  const url = new URL("scores/stat-validation", config.txlineBaseUrl);
  url.searchParams.set("fixtureId", fixtureId);
  url.searchParams.set("seq", seq);
  url.searchParams.set("statKeys", "1,2");
  const res = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${jwt}`, "x-api-token": apiToken },
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`stat-validation -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

type BNCtor = (typeof import("@coral-xyz/anchor"))["BN"];

function toAnchorPayload(raw: Record<string, unknown>, BN: BNCtor) {
  const summary = obj(field(raw, ["summary"]), "summary");
  const updateStats = obj(field(summary, ["updateStats", "update_stats"]), "updateStats");
  const statsRaw = arr(field(raw, ["statsToProve", "stats_to_prove"]), "statsToProve");
  const proofsRaw = arr(field(raw, ["statProofs", "stat_proofs"]), "statProofs");
  if (statsRaw.length !== 2 || proofsRaw.length !== 2) throw new Error("proof must contain exactly two stats");

  const minTs = String(num(field(updateStats, ["minTimestamp", "min_timestamp"])));
  const stats = statsRaw.map((s, i) => ({
    stat: parseStat(obj(s, "stat")),
    statProof: parseNodes(proofsRaw[i])
  }));
  if (stats[0].stat.key !== 1 || stats[1].stat.key !== 2 || stats.some((s) => s.stat.period !== 0)) {
    throw new Error("proof must provide total-goal stats 1 and 2 (period 0) in order");
  }

  return {
    ts: new BN(minTs),
    fixtureSummary: {
      fixtureId: new BN(String(num(field(summary, ["fixtureId", "fixture_id"])))),
      updateStats: {
        updateCount: num(field(updateStats, ["updateCount", "update_count"])),
        minTimestamp: new BN(minTs),
        maxTimestamp: new BN(String(num(field(updateStats, ["maxTimestamp", "max_timestamp"]))))
      },
      eventsSubTreeRoot: bytes32(field(summary, ["eventStatsSubTreeRoot", "eventsSubTreeRoot", "event_stats_sub_tree_root"]))
    },
    fixtureProof: parseNodes(field(raw, ["subTreeProof", "sub_tree_proof"])),
    mainTreeProof: parseNodes(field(raw, ["mainTreeProof", "main_tree_proof"])),
    eventStatRoot: bytes32(field(raw, ["eventStatRoot", "event_stat_root"])),
    stats
  };
}

function parseStat(s: Record<string, unknown>) {
  return {
    key: num(field(s, ["key"])),
    value: num(field(s, ["value"])),
    period: num(field(s, ["period"]))
  };
}

function parseNodes(value: unknown) {
  return arr(value, "proof nodes").map((item) => {
    const node = obj(item, "proof node");
    const sibling = field(node, ["isRightSibling", "is_right_sibling"]);
    if (typeof sibling !== "boolean") throw new Error("proof node has invalid sibling flag");
    return { hash: bytes32(field(node, ["hash"])), isRightSibling: sibling };
  });
}

// ---- tiny parse helpers ----
function field(source: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) if (n in source) return source[n];
  throw new Error(`TxLINE response missing ${names[0]}`);
}
function obj(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} is invalid`);
  return v as Record<string, unknown>;
}
function arr(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v) || v.length > 256) throw new Error(`${label} is invalid`);
  return v;
}
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  throw new Error("expected a number");
}
function bytes32(v: unknown): Buffer {
  let out: Buffer | null = null;
  if (v instanceof Uint8Array) out = Buffer.from(v);
  else if (Array.isArray(v)) out = Buffer.from(v as number[]);
  else if (typeof v === "string") out = v.startsWith("0x") ? Buffer.from(v.slice(2), "hex") : Buffer.from(v, "base64");
  else if (v && typeof v === "object" && (v as { type?: string }).type === "Buffer") out = Buffer.from((v as { data: number[] }).data);
  if (!out || out.length !== 32) throw new Error("hash must be 32 bytes");
  return out;
}
