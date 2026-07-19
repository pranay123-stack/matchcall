// MatchCall — prediction_escrow on-chain client.
//
// Manual Borsh encoders + computed Anchor discriminators (sha256("global:<ix>")
// [0..8]). This deliberately does NOT depend on target/idl/prediction_escrow.json
// so the backend compiles and runs even before the Anchor program is built.
//
// Escrow model: SPL classic-token (Tokenkeg) mUSDC held in the market PDA's
// associated token account. Multi market-type (MATCH_WINNER / TOTALS / BTTS).
import { createHash } from "node:crypto";
import {
  ComputeBudgetProgram,
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
} from "@solana/spl-token";
import { config, requireAuthoritySecret, MUSDC_DECIMALS } from "../config.js";

// -------------------------------- Constants ---------------------------------
export const PROGRAM_ID = new PublicKey(config.PREDICTION_ESCROW_PROGRAM_ID);
export const MUSDC_MINT = new PublicKey(config.MUSDC_MINT);
export const TXLINE_DEVNET_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
);
export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

// Market-type tags (mirror lib.rs).
export const MARKET_MATCH_WINNER = 0;
export const MARKET_TOTALS = 1;
export const MARKET_BTTS = 2;
export type MarketTypeTag = 0 | 1 | 2;
export type MarketTypeName = "MATCH_WINNER" | "TOTALS" | "BTTS";

export function marketTypeName(tag: number): MarketTypeName {
  switch (tag) {
    case 0:
      return "MATCH_WINNER";
    case 1:
      return "TOTALS";
    case 2:
      return "BTTS";
    default:
      throw new Error(`Unknown market type ${tag}`);
  }
}

export function marketTypeTag(name: string): MarketTypeTag {
  switch (name) {
    case "MATCH_WINNER":
      return 0;
    case "TOTALS":
      return 1;
    case "BTTS":
      return 2;
    default:
      throw new Error(`Unknown market type "${name}"`);
  }
}

export function outcomeLabels(tag: number): string[] {
  switch (tag) {
    case MARKET_MATCH_WINNER:
      return ["Home", "Draw", "Away"];
    case MARKET_TOTALS:
      return ["Over", "Under"];
    case MARKET_BTTS:
      return ["Yes", "No"];
    default:
      throw new Error(`Unknown market type ${tag}`);
  }
}

// mUSDC has 6 decimals — API amounts are human units, chain amounts base units.
const MUSDC_UNIT = 10n ** BigInt(MUSDC_DECIMALS);
export function toBaseUnits(human: number): bigint {
  if (!Number.isFinite(human) || human <= 0) {
    throw new Error("Amount must be a positive number");
  }
  return BigInt(Math.round(human * Number(MUSDC_UNIT)));
}
export function fromBaseUnits(base: bigint): number {
  return Number(base) / Number(MUSDC_UNIT);
}

// -------------------------- TxLINE proof payload shape ----------------------
export type TxlineProofNode = { hash: Buffer; isRightSibling: boolean };
export type TxlineScoreStat = { key: number; value: number; period: number };
export type TxlineStatLeaf = { stat: TxlineScoreStat; statProof: TxlineProofNode[] };
export type TxlineProofPayload = {
  ts: bigint;
  fixtureSummary: {
    fixtureId: bigint;
    updateStats: { updateCount: number; minTimestamp: bigint; maxTimestamp: bigint };
    eventsSubTreeRoot: Buffer;
  };
  fixtureProof: TxlineProofNode[];
  mainTreeProof: TxlineProofNode[];
  eventStatRoot: Buffer;
  stats: TxlineStatLeaf[];
};

// -------------------------------- Utilities ---------------------------------
function rpc() {
  return new Connection(config.SOLANA_RPC_URL, "confirmed");
}

export function authorityKeypair(): Keypair {
  const secret = requireAuthoritySecret();
  const parsed = JSON.parse(secret) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((n) => !Number.isInteger(n) || (n as number) < 0 || (n as number) > 255)
  ) {
    throw new Error("MARKET_AUTHORITY_SECRET must be a JSON keypair byte array");
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}

function discriminator(namespace: "global" | "account", name: string): Buffer {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

// --- Borsh scalar encoders ---
function u8(v: number) {
  return Buffer.from([v & 0xff]);
}
function u16(v: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function i32(v: number) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
}
function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function bool(v: boolean) {
  return Buffer.from([v ? 1 : 0]);
}
function bytes32(v: Buffer, label: string) {
  if (v.length !== 32) throw new Error(`${label} must be exactly 32 bytes`);
  return v;
}
function encodeVec<T>(items: T[], encode: (item: T) => Buffer) {
  if (items.length > 256) throw new Error("Proof payload exceeds supported item count");
  return Buffer.concat([u32(items.length), ...items.map(encode)]);
}

// --- TxlineStatValidationInput encoder (byte-identical to on-chain layout) ---
function encodeProofNode(node: TxlineProofNode) {
  return Buffer.concat([bytes32(node.hash, "proof hash"), bool(node.isRightSibling)]);
}
function encodeScoreStat(stat: TxlineScoreStat) {
  if (
    !Number.isInteger(stat.key) ||
    stat.key < 0 ||
    stat.key > 0xffff_ffff ||
    !Number.isInteger(stat.value) ||
    stat.value < -2_147_483_648 ||
    stat.value > 2_147_483_647 ||
    !Number.isInteger(stat.period) ||
    stat.period < -2_147_483_648 ||
    stat.period > 2_147_483_647
  ) {
    throw new Error("Invalid TxLINE stat");
  }
  return Buffer.concat([u32(stat.key), i32(stat.value), i32(stat.period)]);
}
export function encodeTxlineProofPayload(payload: TxlineProofPayload): Buffer {
  const update = payload.fixtureSummary.updateStats;
  if (payload.ts !== update.minTimestamp) {
    throw new Error("TxLINE proof timestamp must equal the update minimum timestamp");
  }
  if (
    payload.stats.length !== 2 ||
    payload.stats[0]?.stat.key !== 1 ||
    payload.stats[1]?.stat.key !== 2 ||
    payload.stats[0]?.stat.period !== 0 ||
    payload.stats[1]?.stat.period !== 0
  ) {
    throw new Error(
      "TxLINE settlement proof must contain participant 1 and participant 2 total-goal stats (key 1,2 period 0)"
    );
  }
  return Buffer.concat([
    i64(payload.ts),
    i64(payload.fixtureSummary.fixtureId),
    i32(update.updateCount),
    i64(update.minTimestamp),
    i64(update.maxTimestamp),
    bytes32(payload.fixtureSummary.eventsSubTreeRoot, "event subtree root"),
    encodeVec(payload.fixtureProof, encodeProofNode),
    encodeVec(payload.mainTreeProof, encodeProofNode),
    bytes32(payload.eventStatRoot, "event stat root"),
    encodeVec(payload.stats, (leaf) =>
      Buffer.concat([encodeScoreStat(leaf.stat), encodeVec(leaf.statProof, encodeProofNode)])
    ),
  ]);
}

// -------------------------------- PDAs --------------------------------------
export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function marketSeed(id: string): Buffer {
  return createHash("sha256").update(`matchcall-market:v1:${id}`).digest();
}

export function marketPda(seed: Buffer): PublicKey {
  if (seed.length !== 32) throw new Error("Market seed must be 32 bytes");
  return PublicKey.findProgramAddressSync([Buffer.from("market"), seed], PROGRAM_ID)[0];
}

export function positionPda(market: PublicKey, user: PublicKey, outcome: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer(), Buffer.from([outcome])],
    PROGRAM_ID
  )[0];
}

export function marketEscrow(market: PublicKey): PublicKey {
  // ATA of the market PDA (off-curve owner) for the mUSDC mint, classic token program.
  return getAssociatedTokenAddressSync(
    MUSDC_MINT,
    market,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

function userTokenAccount(wallet: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    MUSDC_MINT,
    wallet,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

function txlineDailyScoresRootsPda(tsMs: bigint): PublicKey {
  const epochDay = tsMs / 86_400_000n;
  if (epochDay < 0n || epochDay > 0xffffn) {
    throw new Error("TxLINE proof timestamp is out of range");
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), u16(Number(epochDay))],
    TXLINE_DEVNET_PROGRAM_ID
  )[0];
}

// ---------------------------- Transaction sends -----------------------------
async function sendAuthorityTx(
  tx: Transaction,
  extraSigners: Keypair[] = []
): Promise<string> {
  const connection = rpc();
  const authority = authorityKeypair();
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = latest.blockhash;
  const signers = [authority, ...extraSigners];
  const signature = await connection.sendTransaction(tx, signers, {
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

// ------------------------------ initialize_config ---------------------------
export async function initializeConfig(): Promise<{ configPda: string; signature?: string; created: boolean }> {
  const connection = rpc();
  const authority = authorityKeypair();
  const cfg = configPda();
  if (await connection.getAccountInfo(cfg, "confirmed")) {
    return { configPda: cfg.toBase58(), created: false };
  }
  const data = discriminator("global", "initialize_config");
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: cfg, isSigner: false, isWritable: true },
      { pubkey: MUSDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const signature = await sendAuthorityTx(new Transaction().add(ix));
  return { configPda: cfg.toBase58(), signature, created: true };
}

// -------------------------------- create_market -----------------------------
export async function createMarket(input: {
  id: string;
  txlineFixtureId: number;
  participant1IsHome: boolean;
  marketType: MarketTypeTag;
  lineParam: number;
  lockAt: number; // unix seconds
}): Promise<{ marketPda: string; escrow: string; seedHex: string; signature: string }> {
  const authority = authorityKeypair();
  const seed = marketSeed(input.id);
  const market = marketPda(seed);
  const escrow = marketEscrow(market);

  if (input.marketType === MARKET_TOTALS && (input.lineParam <= 0 || input.lineParam % 2 !== 1)) {
    throw new Error("TOTALS markets require an odd positive line_param (line * 2, e.g. 5 for 2.5)");
  }
  const lockAt = BigInt(Math.floor(input.lockAt));
  if (lockAt <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("Market lock time must be in the future");
  }

  const data = Buffer.concat([
    discriminator("global", "create_market"),
    seed,
    i64(BigInt(input.txlineFixtureId)),
    bool(input.participant1IsHome),
    u8(input.marketType),
    i32(input.lineParam | 0),
    i64(lockAt),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true }, // creator
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

  const signature = await sendAuthorityTx(new Transaction().add(ix));
  return {
    marketPda: market.toBase58(),
    escrow: escrow.toBase58(),
    seedHex: seed.toString("hex"),
    signature,
  };
}

// ----------------------------- place_prediction -----------------------------
export async function buildPlacePredictionTx(input: {
  marketPda?: string;
  seedHex?: string;
  wallet: string;
  outcome: number;
  amount: number; // human mUSDC
}): Promise<{ transactionBase64: string; positionAddress: string; lastValidBlockHeight: number }> {
  const wallet = new PublicKey(input.wallet);
  const market = resolveMarket(input);
  const escrow = marketEscrow(market);
  const userToken = userTokenAccount(wallet);
  const position = positionPda(market, wallet, input.outcome);
  const amount = toBaseUnits(input.amount);

  const data = Buffer.concat([
    discriminator("global", "place_prediction"),
    u8(input.outcome),
    u64(amount),
  ]);

  const tx = new Transaction();
  // Ensure the user's mUSDC ATA exists (idempotent — no-op if already there).
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      userToken,
      wallet,
      MUSDC_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true }, // user
        { pubkey: configPda(), isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: userToken, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const latest = await rpc().getLatestBlockhash("confirmed");
  tx.feePayer = wallet;
  tx.recentBlockhash = latest.blockhash;
  return {
    transactionBase64: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    positionAddress: position.toBase58(),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

/**
 * Build + sign + send place_prediction with a server-held keypair (defaults to
 * the platform authority). Used by the demo-seed script to pre-populate a pool;
 * real users sign in the browser via buildPlacePredictionTx. Returns the sig.
 */
export async function placePredictionSigned(input: {
  marketPda?: string;
  seedHex?: string;
  outcome: number;
  amount: number; // human mUSDC
  signer?: Keypair;
}): Promise<string> {
  const signer = input.signer ?? authorityKeypair();
  const { transactionBase64 } = await buildPlacePredictionTx({
    marketPda: input.marketPda,
    seedHex: input.seedHex,
    wallet: signer.publicKey.toBase58(),
    outcome: input.outcome,
    amount: input.amount,
  });
  const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  tx.sign(signer);
  const connection = rpc();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

/** Confirm the place_prediction signature landed and the Position matches. */
export async function verifyPosition(input: {
  marketPda?: string;
  seedHex?: string;
  wallet: string;
  outcome: number;
  signature: string;
}): Promise<{ positionAddress: string; amount: bigint }> {
  const wallet = new PublicKey(input.wallet);
  const market = resolveMarket(input);
  const position = positionPda(market, wallet, input.outcome);
  const connection = rpc();

  const status = (
    await connection.getSignatureStatuses([input.signature], { searchTransactionHistory: true })
  ).value[0];
  if (
    !status ||
    status.err ||
    !["confirmed", "finalized"].includes(status.confirmationStatus ?? "")
  ) {
    throw new Error("Prediction transaction is not confirmed");
  }

  const account = await connection.getAccountInfo(position, "confirmed");
  if (!account || !account.owner.equals(PROGRAM_ID)) {
    throw new Error("On-chain position was not found");
  }
  const decoded = decodePosition(account.data);
  if (
    !decoded.market.equals(market) ||
    !decoded.user.equals(wallet) ||
    decoded.outcome !== input.outcome
  ) {
    throw new Error("On-chain position does not match the pending prediction");
  }
  return { positionAddress: position.toBase58(), amount: decoded.amount };
}

// ------------------------------- claim_payout -------------------------------
export async function buildClaimTx(input: {
  marketPda?: string;
  seedHex?: string;
  wallet: string;
  outcome: number;
}): Promise<{ transactionBase64: string; lastValidBlockHeight: number }> {
  const wallet = new PublicKey(input.wallet);
  const market = resolveMarket(input);
  const escrow = marketEscrow(market);
  const userToken = userTokenAccount(wallet);
  const position = positionPda(market, wallet, input.outcome);

  const tx = new Transaction();
  // The winner may not have an ATA yet if they staked from another account —
  // idempotent create keeps claim self-contained.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      userToken,
      wallet,
      MUSDC_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true }, // user
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: userToken, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: discriminator("global", "claim_payout"),
    })
  );

  const latest = await rpc().getLatestBlockhash("confirmed");
  tx.feePayer = wallet;
  tx.recentBlockhash = latest.blockhash;
  return {
    transactionBase64: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

// ------------------------------- settle_market ------------------------------
export function computeWinningOutcome(
  homeGoals: number,
  awayGoals: number,
  marketType: number,
  lineParam: number
): number {
  switch (marketType) {
    case MARKET_MATCH_WINNER:
      if (homeGoals > awayGoals) return 0;
      if (homeGoals === awayGoals) return 1;
      return 2;
    case MARKET_TOTALS: {
      const total2 = (homeGoals + awayGoals) * 2;
      return total2 > lineParam ? 0 : 1;
    }
    case MARKET_BTTS:
      return homeGoals > 0 && awayGoals > 0 ? 0 : 1;
    default:
      throw new Error(`Unknown market type ${marketType}`);
  }
}

export async function settleMarketWithProof(input: {
  marketPda?: string;
  seedHex?: string;
  participant1IsHome: boolean;
  marketType: number;
  lineParam: number;
  payload: TxlineProofPayload;
}): Promise<{
  signature: string;
  finalHomeGoals: number;
  finalAwayGoals: number;
  winningOutcome: number;
}> {
  const market = resolveMarket(input);
  const rootsPda = txlineDailyScoresRootsPda(input.payload.ts);

  const data = Buffer.concat([
    discriminator("global", "settle_market"),
    encodeTxlineProofPayload(input.payload),
  ]);

  const authority = authorityKeypair();
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
    .add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: true }, // cranker
          { pubkey: market, isSigner: false, isWritable: true },
          { pubkey: TXLINE_DEVNET_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: rootsPda, isSigner: false, isWritable: false },
        ],
        data,
      })
    );

  const signature = await sendAuthorityTx(tx);

  const p1 = input.payload.stats[0]!.stat.value;
  const p2 = input.payload.stats[1]!.stat.value;
  const finalHomeGoals = input.participant1IsHome ? p1 : p2;
  const finalAwayGoals = input.participant1IsHome ? p2 : p1;
  const winningOutcome = computeWinningOutcome(
    finalHomeGoals,
    finalAwayGoals,
    input.marketType,
    input.lineParam
  );
  return { signature, finalHomeGoals, finalAwayGoals, winningOutcome };
}

// ------------------------------ account decoders ----------------------------
export type OnchainMarket = {
  status: "OPEN" | "SETTLED" | "REFUNDING";
  marketType: number;
  lineParam: number;
  participant1IsHome: boolean;
  txlineFixtureId: bigint;
  lockAt: bigint;
  numOutcomes: number;
  outcomeStakes: bigint[];
  totalPool: bigint;
  winningOutcome: number | null;
  finalHomeGoals: number;
  finalAwayGoals: number;
};

function statusName(v: number): "OPEN" | "SETTLED" | "REFUNDING" {
  switch (v) {
    case 0:
      return "OPEN";
    case 1:
      return "SETTLED";
    case 2:
      return "REFUNDING";
    default:
      throw new Error(`Unknown market status ${v}`);
  }
}

export async function fetchMarketOnchain(marketPdaStr: string): Promise<OnchainMarket | null> {
  const connection = rpc();
  const account = await connection.getAccountInfo(new PublicKey(marketPdaStr), "confirmed");
  if (!account || !account.owner.equals(PROGRAM_ID)) return null;
  const d = account.data;
  let o = 8; // skip account discriminator
  o += 32; // config
  o += 32; // creator
  o += 32; // stake_mint
  o += 32; // escrow
  o += 32; // seed
  const txlineFixtureId = d.readBigInt64LE(o); o += 8;
  const participant1IsHome = d.readUInt8(o) === 1; o += 1;
  const marketType = d.readUInt8(o); o += 1;
  const lineParam = d.readInt32LE(o); o += 4;
  const numOutcomes = d.readUInt8(o); o += 1;
  const lockAt = d.readBigInt64LE(o); o += 8;
  const totalPool = d.readBigUInt64LE(o); o += 8;
  const stakesLen = d.readUInt32LE(o); o += 4;
  const outcomeStakes: bigint[] = [];
  for (let i = 0; i < stakesLen; i++) {
    outcomeStakes.push(d.readBigUInt64LE(o));
    o += 8;
  }
  const finalHomeGoals = d.readUInt8(o); o += 1;
  const finalAwayGoals = d.readUInt8(o); o += 1;
  const winningOutcomeRaw = d.readInt16LE(o); o += 2;
  o += 8; // winning_pool
  o += 8; // claimed_pool
  const status = statusName(d.readUInt8(o)); o += 1;

  return {
    status,
    marketType,
    lineParam,
    participant1IsHome,
    txlineFixtureId,
    lockAt,
    numOutcomes,
    outcomeStakes,
    totalPool,
    winningOutcome: winningOutcomeRaw < 0 ? null : winningOutcomeRaw,
    finalHomeGoals,
    finalAwayGoals,
  };
}

function decodePosition(d: Buffer): {
  market: PublicKey;
  user: PublicKey;
  outcome: number;
  amount: bigint;
  claimed: boolean;
} {
  let o = 8;
  const market = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const user = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const outcome = d.readUInt8(o); o += 1;
  const amount = d.readBigUInt64LE(o); o += 8;
  const claimed = d.readUInt8(o) === 1; o += 1;
  return { market, user, outcome, amount, claimed };
}

// -------------------------------- helpers -----------------------------------
function resolveMarket(input: { marketPda?: string; seedHex?: string }): PublicKey {
  if (input.marketPda) return new PublicKey(input.marketPda);
  if (input.seedHex) return marketPda(Buffer.from(input.seedHex, "hex"));
  throw new Error("Either marketPda or seedHex is required");
}
