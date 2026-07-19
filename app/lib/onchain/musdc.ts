// MatchCall — mUSDC devnet test-token helpers (creation + faucet).
//
// mUSDC is our own devnet SPL classic-token stake asset (6 decimals). The
// deployer keypair is the mint authority. The faucet mints tokens to any wallet
// so testers can place predictions.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { config, MUSDC_DECIMALS } from "../config.js";

const MUSDC_UNIT = 10n ** BigInt(MUSDC_DECIMALS);

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function keypairFromFile(p: string, label: string): Keypair {
  const full = resolvePath(p);
  if (!existsSync(full)) {
    // Also try one level up (repo root) since scripts run from app/.
    const up = path.join(process.cwd(), "..", p);
    if (existsSync(up)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(up, "utf8"))));
    throw new Error(`${label} keypair not found at ${full}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(full, "utf8"))));
}

export function deployerKeypair(): Keypair {
  // Prefer a keypair file (local dev). In a container there is no keys file, so
  // fall back to the inline authority secret env (deployer == authority here).
  const p = config.DEPLOYER_KEYPAIR_PATH;
  const full = resolvePath(p);
  const up = path.join(process.cwd(), "..", p);
  if (existsSync(full) || existsSync(up)) return keypairFromFile(p, "Deployer");
  if (config.MARKET_AUTHORITY_SECRET) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(config.MARKET_AUTHORITY_SECRET)));
  }
  throw new Error(
    "Deployer keypair not found — set DEPLOYER_KEYPAIR_PATH (file) or MARKET_AUTHORITY_SECRET (inline array)."
  );
}

export function musdcMintKeypair(): Keypair {
  return keypairFromFile(config.MUSDC_MINT_KEYPAIR_PATH, "mUSDC mint");
}

function rpc(): Connection {
  return new Connection(config.SOLANA_RPC_URL, "confirmed");
}

/**
 * Create the fixed mUSDC mint (idempotent). Mint authority = deployer, 6
 * decimals, then mint an initial large supply to the deployer.
 */
export async function createMusdcMint(initialSupplyHuman = 100_000_000): Promise<{
  mint: string;
  created: boolean;
}> {
  const connection = rpc();
  const payer = deployerKeypair();
  const mintKp = musdcMintKeypair();

  const existing = await connection.getAccountInfo(mintKp.publicKey, "confirmed");
  if (existing) return { mint: mintKp.publicKey.toBase58(), created: false };

  await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    null, // freeze authority
    MUSDC_DECIMALS,
    mintKp,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  await airdropMusdc(payer.publicKey.toBase58(), initialSupplyHuman);
  return { mint: mintKp.publicKey.toBase58(), created: true };
}

/** Faucet: mint `amountHuman` mUSDC to `wallet` (creates its ATA if needed). */
export async function airdropMusdc(
  wallet: string,
  amountHuman = 1000
): Promise<{ signature: string; ata: string; amount: number }> {
  const connection = rpc();
  const payer = deployerKeypair();
  // Use the mint pubkey from config so this works in a container without the
  // mint keypair file (only the deployer/mint-authority key is needed to mint).
  const mint = new PublicKey(config.MUSDC_MINT);
  const owner = new PublicKey(wallet);

  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  const amount = BigInt(Math.round(amountHuman * Number(MUSDC_UNIT)));
  const signature = await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer, // mint authority
    amount,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  return { signature, ata: ata.address.toBase58(), amount: amountHuman };
}

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Gas drip: top a fresh tester up to a little devnet SOL so they can actually
 * submit a stake (mUSDC is the bet; SOL pays the fee + position-account rent).
 * Only sends if the wallet is below `minSol`, and never if the authority itself
 * is running low — so repeat clicks and a near-empty faucet can't drain it.
 */
export async function dripSol(
  wallet: string,
  opts?: { minSol?: number; topUpSol?: number }
): Promise<{ sent: number; signature?: string; reason?: string }> {
  const minSol = opts?.minSol ?? 0.02;
  const topUpSol = opts?.topUpSol ?? 0.05;
  const connection = rpc();
  const payer = deployerKeypair();
  const owner = new PublicKey(wallet);

  const balance = await connection.getBalance(owner, "confirmed");
  if (balance >= minSol * LAMPORTS_PER_SOL) return { sent: 0, reason: "already funded" };

  const lamports = Math.round(topUpSol * LAMPORTS_PER_SOL);
  const authBalance = await connection.getBalance(payer.publicKey, "confirmed");
  // Keep a buffer so the authority can still pay its own fees.
  if (authBalance < lamports + 20_000_000) return { sent: 0, reason: "faucet low on SOL" };

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner, lamports })
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  return { sent: topUpSol, signature };
}
