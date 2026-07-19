// MatchCall — mUSDC devnet test-token helpers (creation + faucet).
//
// mUSDC is our own devnet SPL classic-token stake asset (6 decimals). The
// deployer keypair is the mint authority. The faucet mints tokens to any wallet
// so testers can place predictions.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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
  return keypairFromFile(config.DEPLOYER_KEYPAIR_PATH, "Deployer");
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
  const mint = musdcMintKeypair().publicKey;
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
