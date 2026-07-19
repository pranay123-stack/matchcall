import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load the SAME server-side env the backend uses. The keeper lives in
// `<repo>/keeper`, so the backend env is one level up in `app/.env.local`.
// We also fall back to a keeper-local `.env` / `.env.local` for overrides.
const here = dirname(fileURLToPath(import.meta.url)); // keeper/src
const repoRoot = resolve(here, "..", "..");
const keeperRoot = resolve(here, "..");

const envCandidates = [
  process.env.KEEPER_ENV_PATH, // explicit override
  resolve(keeperRoot, ".env.local"),
  resolve(keeperRoot, ".env"),
  resolve(repoRoot, "app", ".env.local"),
  resolve(repoRoot, "app", ".env"),
  resolve(repoRoot, ".env.local")
].filter((p): p is string => Boolean(p));

for (const path of envCandidates) {
  if (existsSync(path)) dotenv.config({ path, override: false });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var ${name} (looked in app/.env.local and keeper/.env)`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function normalizeBase(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

// TxLINE's documented devnet program. Fixed contract value (SPEC).
export const TXLINE_DEVNET_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

export const config = {
  // ---- Solana / on-chain (shared with backend) ----
  rpcUrl: optional("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
  predictionEscrowProgramId: optional(
    "PREDICTION_ESCROW_PROGRAM_ID",
    "DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2"
  ),
  musdcMint: optional("MUSDC_MINT", "EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j"),
  // JSON byte array; only needed for the direct-settle fallback.
  marketAuthoritySecret: process.env.MARKET_AUTHORITY_SECRET?.trim(),

  // ---- TxLINE data feed (shared with backend) ----
  txlineBaseUrl: normalizeBase(optional("TXLINE_BASE_URL", "https://txline-dev.txodds.com/api/")),
  txlineAuthJwt: process.env.TXLINE_AUTH_JWT?.trim(),
  txlineApiToken: process.env.TXLINE_API_TOKEN?.trim(),
  txlineGuestStart: optional("TXLINE_GUEST_START_URL", "https://txline-dev.txodds.com/auth/guest/start"),

  // ---- Keeper behaviour ----
  apiBase: normalizeBase(optional("KEEPER_API_BASE", "http://localhost:3000")).replace(/\/$/, ""),
  pollIntervalMs: Number(optional("KEEPER_POLL_INTERVAL_MS", "15000")),
  // If true, when the backend settle route is missing/failing we try to settle
  // directly with the market authority keypair + local Anchor IDL (best-effort).
  directSettleEnabled: optional("KEEPER_DIRECT_SETTLE", "true") !== "false",
  idlPath: resolve(repoRoot, "target", "idl", "prediction_escrow.json"),

  repoRoot,
  requiredTxline() {
    return { jwt: required("TXLINE_AUTH_JWT"), apiToken: required("TXLINE_API_TOKEN") };
  }
};

export type KeeperConfig = typeof config;
