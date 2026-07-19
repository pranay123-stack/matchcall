// MatchCall — test-side on-chain client.
//
// A small, self-contained mirror of app/lib/onchain/program.ts. It intentionally
// re-implements the SAME manual Borsh encoders, Anchor discriminators
// (sha256("global:<ix>")[0..8]) and PDA derivations that the app uses, so the
// tests exercise the REAL byte layout the deployed program expects — without
// importing across the app package boundary (which would drag in the app's
// zod/env config loader). program.ts remains the source of truth for account
// order + discriminators; if it changes, mirror it here.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// ------------------------------ Fixed devnet values -------------------------
export const RPC_URL = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  "DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2"
);
export const MUSDC_MINT = new PublicKey(
  "EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j"
);
export const TXLINE_DEVNET_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
);
export const MUSDC_DECIMALS = 6;
export const MUSDC_UNIT = 10n ** BigInt(MUSDC_DECIMALS);

// Market-type tags (mirror lib.rs).
export const MARKET_MATCH_WINNER = 0;
export const MARKET_TOTALS = 1;
export const MARKET_BTTS = 2;

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

export function connection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// The funded devnet deployer/authority keypair. It is BOTH the config admin and
// the mUSDC mint authority, so the tests use it as a throwaway player: it can
// mint itself stake and create/settle markets.
export function deployerKeypair(): Keypair {
  const candidates = [
    path.join(__dirname, "..", ".keys", "deployer.json"),
    path.join(process.cwd(), ".keys", "deployer.json"),
    path.join(process.cwd(), "..", ".keys", "deployer.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(p, "utf8")) as number[])
      );
    }
  }
  throw new Error(
    `Deployer keypair not found (looked in: ${candidates.join(", ")})`
  );
}

// ------------------------------ Borsh scalar encoders -----------------------
export function u8(v: number): Buffer {
  return Buffer.from([v & 0xff]);
}
function u16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function i32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
}
export function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function bool(v: boolean): Buffer {
  return Buffer.from([v ? 1 : 0]);
}
function bytes32(v: Buffer, label: string): Buffer {
  if (v.length !== 32) throw new Error(`${label} must be exactly 32 bytes`);
  return v;
}
function encodeVec<T>(items: T[], encode: (item: T) => Buffer): Buffer {
  return Buffer.concat([u32(items.length), ...items.map(encode)]);
}

export function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

// ------------------------------ PDA derivations -----------------------------
export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

/** A unique, deterministic 32-byte market seed from an id string. */
export function marketSeed(id: string): Buffer {
  return createHash("sha256").update(`matchcall-market:v1:${id}`).digest();
}

export function marketPda(seed: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), seed],
    PROGRAM_ID
  )[0];
}

export function positionPda(
  market: PublicKey,
  user: PublicKey,
  outcome: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
    PROGRAM_ID
  )[0];
}

/** ATA of the market PDA (off-curve owner) for the mUSDC mint — the escrow. */
export function marketEscrow(market: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    MUSDC_MINT,
    market,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function userTokenAccount(wallet: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    MUSDC_MINT,
    wallet,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

// ------------------------------ Instruction builders ------------------------
export function createMarketIx(input: {
  creator: PublicKey;
  seed: Buffer;
  txlineFixtureId: number;
  participant1IsHome: boolean;
  marketType: number;
  lineParam: number;
  lockAt: number; // unix seconds
}): TransactionInstruction {
  const market = marketPda(input.seed);
  const escrow = marketEscrow(market);
  const data = Buffer.concat([
    discriminator("create_market"),
    bytes32(input.seed, "market seed"),
    i64(BigInt(input.txlineFixtureId)),
    bool(input.participant1IsHome),
    u8(input.marketType),
    i32(input.lineParam | 0),
    i64(BigInt(Math.floor(input.lockAt))),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: input.creator, isSigner: true, isWritable: true }, // creator
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: MUSDC_MINT, isSigner: false, isWritable: false }, // stake_mint
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** place_prediction (prefixed with an idempotent create of the user's ATA). */
export function placePredictionIxs(input: {
  user: PublicKey;
  market: PublicKey;
  outcome: number;
  amountBase: bigint;
}): TransactionInstruction[] {
  const escrow = marketEscrow(input.market);
  const userToken = userTokenAccount(input.user);
  const position = positionPda(input.market, input.user, input.outcome);
  const data = Buffer.concat([
    discriminator("place_prediction"),
    u8(input.outcome),
    u64(input.amountBase),
  ]);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      input.user,
      userToken,
      input.user,
      MUSDC_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: input.user, isSigner: true, isWritable: true }, // user
        { pubkey: configPda(), isSigner: false, isWritable: false },
        { pubkey: input.market, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: userToken, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  ];
}

// A minimal but structurally-VALID TxlineStatValidationInput. It Borsh-decodes
// cleanly on-chain (so instruction-data deserialization succeeds) but is NOT a
// real Merkle proof — the settle guards we test all revert BEFORE the proof is
// used. `stats` carries the participant-1/participant-2 total-goal leaves
// (key 1 & 2, period 0) the encoder + program require.
export function encodeDummySettlePayload(): Buffer {
  const ts = 1_720_000_000_000n; // ms; epochDay well within u16
  const zero32 = Buffer.alloc(32);
  const encodeProofNode = () => Buffer.alloc(0); // no nodes
  const stat = (key: number) =>
    Buffer.concat([u32(key), i32(0), i32(0)]); // key, value=0, period=0
  const leaf = (key: number) =>
    Buffer.concat([stat(key), encodeVec([], encodeProofNode)]);
  return Buffer.concat([
    i64(ts), // ts
    i64(1n), // fixture_summary.fixture_id
    i32(0), // update_stats.update_count
    i64(ts), // update_stats.min_timestamp (== ts, required)
    i64(ts), // update_stats.max_timestamp
    bytes32(zero32, "events_sub_tree_root"),
    encodeVec([], encodeProofNode), // fixture_proof
    encodeVec([], encodeProofNode), // main_tree_proof
    bytes32(zero32, "event_stat_root"),
    encodeVec([1, 2], leaf), // stats: [key1, key2]
  ]);
}

/**
 * settle_market with caller-chosen `txline_program` / `daily_scores_merkle_roots`
 * accounts, so the negative tests can feed a BOGUS TxLINE program and assert the
 * on-chain guard rejects it. A real settle would pass the true TxLINE program
 * and the roots PDA derived from the proof timestamp.
 */
export function settleMarketIx(input: {
  cranker: PublicKey;
  market: PublicKey;
  txlineProgram: PublicKey;
  rootsAccount: PublicKey;
}): TransactionInstruction {
  const data = Buffer.concat([
    discriminator("settle_market"),
    encodeDummySettlePayload(),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: input.cranker, isSigner: true, isWritable: true }, // cranker
      { pubkey: input.market, isSigner: false, isWritable: true },
      { pubkey: input.txlineProgram, isSigner: false, isWritable: false },
      { pubkey: input.rootsAccount, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ------------------------------ Account decoders ----------------------------
export function decodeConfig(d: Buffer): {
  admin: PublicKey;
  stakeMint: PublicKey;
  paused: boolean;
  marketCount: bigint;
  bump: number;
} {
  let o = 8; // skip account discriminator
  const admin = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const stakeMint = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const paused = d.readUInt8(o) === 1;
  o += 1;
  const marketCount = d.readBigUInt64LE(o);
  o += 8;
  const bump = d.readUInt8(o);
  return { admin, stakeMint, paused, marketCount, bump };
}

export function decodeMarket(d: Buffer): {
  config: PublicKey;
  creator: PublicKey;
  stakeMint: PublicKey;
  escrow: PublicKey;
  seed: Buffer;
  txlineFixtureId: bigint;
  participant1IsHome: boolean;
  marketType: number;
  lineParam: number;
  numOutcomes: number;
  lockAt: bigint;
  totalPool: bigint;
  outcomeStakes: bigint[];
  status: "OPEN" | "SETTLED" | "REFUNDING";
} {
  let o = 8;
  const config = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const creator = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const stakeMint = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const escrow = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const seed = Buffer.from(d.subarray(o, o + 32));
  o += 32;
  const txlineFixtureId = d.readBigInt64LE(o);
  o += 8;
  const participant1IsHome = d.readUInt8(o) === 1;
  o += 1;
  const marketType = d.readUInt8(o);
  o += 1;
  const lineParam = d.readInt32LE(o);
  o += 4;
  const numOutcomes = d.readUInt8(o);
  o += 1;
  const lockAt = d.readBigInt64LE(o);
  o += 8;
  const totalPool = d.readBigUInt64LE(o);
  o += 8;
  const stakesLen = d.readUInt32LE(o);
  o += 4;
  const outcomeStakes: bigint[] = [];
  for (let i = 0; i < stakesLen; i++) {
    outcomeStakes.push(d.readBigUInt64LE(o));
    o += 8;
  }
  o += 1; // final_home_goals
  o += 1; // final_away_goals
  o += 2; // winning_outcome (i16)
  o += 8; // winning_pool
  o += 8; // claimed_pool
  const statusRaw = d.readUInt8(o);
  const status = (["OPEN", "SETTLED", "REFUNDING"] as const)[statusRaw];
  if (!status) throw new Error(`Unknown market status ${statusRaw}`);
  return {
    config,
    creator,
    stakeMint,
    escrow,
    seed,
    txlineFixtureId,
    participant1IsHome,
    marketType,
    lineParam,
    numOutcomes,
    lockAt,
    totalPool,
    outcomeStakes,
    status,
  };
}

export function decodePosition(d: Buffer): {
  market: PublicKey;
  user: PublicKey;
  outcome: number;
  amount: bigint;
  claimed: boolean;
} {
  let o = 8;
  const market = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const user = new PublicKey(d.subarray(o, o + 32));
  o += 32;
  const outcome = d.readUInt8(o);
  o += 1;
  const amount = d.readBigUInt64LE(o);
  o += 8;
  const claimed = d.readUInt8(o) === 1;
  return { market, user, outcome, amount, claimed };
}

// ------------------------------ Send / assert helpers -----------------------
export async function sendTx(
  conn: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[] = []
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const latest = await conn.getLatestBlockhash("confirmed");
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = latest.blockhash;
  const sig = await conn.sendTransaction(tx, [payer, ...signers], {
    preflightCommitment: "confirmed",
  });
  const conf = await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  if (conf.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

/**
 * Send a transaction expected to REVERT, and return the combined program logs +
 * error message so a test can assert the specific Anchor error code appears
 * (e.g. "MarketLocked"). Throws if the transaction unexpectedly SUCCEEDS.
 */
export async function expectTxError(
  conn: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[] = []
): Promise<string> {
  try {
    await sendTx(conn, ixs, payer, signers);
  } catch (err: unknown) {
    let text = err instanceof Error ? err.message : String(err);
    const anyErr = err as { logs?: string[]; getLogs?: (c: Connection) => Promise<string[]> };
    if (Array.isArray(anyErr.logs)) text += "\n" + anyErr.logs.join("\n");
    else if (typeof anyErr.getLogs === "function") {
      try {
        text += "\n" + (await anyErr.getLogs(conn)).join("\n");
      } catch {
        /* logs unavailable; fall back to message */
      }
    }
    return text;
  }
  throw new Error("Expected the transaction to revert, but it succeeded");
}

/** Mint `amountHuman` mUSDC to `wallet` using the deployer mint authority.
 *  Mirrors app/lib/onchain/musdc.ts `airdropMusdc`. */
export async function airdropMusdc(
  conn: Connection,
  authority: Keypair,
  wallet: PublicKey,
  amountHuman: number
): Promise<void> {
  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    authority,
    MUSDC_MINT,
    wallet,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  await mintTo(
    conn,
    authority,
    MUSDC_MINT,
    ata.address,
    authority,
    BigInt(Math.round(amountHuman * Number(MUSDC_UNIT))),
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
}

export async function escrowBalance(conn: Connection, market: PublicKey): Promise<bigint> {
  const escrow = marketEscrow(market);
  const info = await conn.getTokenAccountBalance(escrow, "confirmed");
  return BigInt(info.value.amount);
}

/** Poll until the chain's block time reaches `targetSec` (or time out). */
export async function waitForChainTime(
  conn: Connection,
  targetSec: number,
  timeoutMs = 90_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const slot = await conn.getSlot("confirmed");
    const blockTime = await conn.getBlockTime(slot);
    if (blockTime !== null && blockTime >= targetSec) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for chain time to reach ${targetSec} (last=${blockTime})`
      );
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
