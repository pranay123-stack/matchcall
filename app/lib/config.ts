// MatchCall — server-only configuration.
//
// Loads env from `app/.env.local` (and a couple of fallbacks) WITHOUT depending
// on the `dotenv` package (it may not be installed yet), then validates with
// zod. Every value has a safe devnet default from the shared SPEC so the app can
// boot for read-only routes even before credentials are provisioned. Anything
// that actually needs a secret (creating/settling markets, faucet) asks for it
// explicitly through `requireAuthoritySecret()`.
//
// NEVER import this from client components — it reads process secrets.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// --- tiny .env loader (no external dependency) ------------------------------
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue; // never override real env
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Resolve candidate locations relative to the current working directory. Next
// runs with cwd=app/, tsx scripts (per package.json) also run with cwd=app/.
const cwd = process.cwd();
for (const candidate of [
  path.join(cwd, ".env.local"),
  path.join(cwd, "app", ".env.local"),
  path.join(cwd, ".env"),
  path.join(cwd, "..", "app", ".env.local"),
]) {
  loadEnvFile(candidate);
}

// --- schema -----------------------------------------------------------------
const optionalString = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.string().optional()
);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),

  // Solana
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  PREDICTION_ESCROW_PROGRAM_ID: z
    .string()
    .default("DuB3yJQMPWCESJoEzShBWt1Jc3Q6j6DXLyi1XpAB6EQ2"),
  MUSDC_MINT: z.string().default("EgkrEEpXKn61tdWDTJj9bDd68oW4ifiUC4M5uqiAhv9j"),
  // Backend signer: a JSON byte array (Anchor keypair). Optional at boot.
  MARKET_AUTHORITY_SECRET: optionalString,
  // Path fallback for the authority secret / used by ops scripts.
  MARKET_AUTHORITY_KEYPAIR_PATH: optionalString,
  DEPLOYER_KEYPAIR_PATH: z.string().default(".keys/deployer.json"),
  MUSDC_MINT_KEYPAIR_PATH: z.string().default(".keys/musdc-mint.json"),

  // TxLINE
  TXLINE_BASE_URL: z
    .string()
    .url()
    .default("https://txline-dev.txodds.com/api/"),
  TXLINE_ORIGIN: z.string().url().default("https://txline-dev.txodds.com"),
  TXLINE_GUEST_URL: z
    .string()
    .url()
    .default("https://txline-dev.txodds.com/auth/guest/start"),
  TXLINE_AUTH_JWT: optionalString,
  TXLINE_API_TOKEN: optionalString,
  TXLINE_COMPETITION_ID: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),

  // Storage
  DATABASE_PATH: z.string().default("./matchcall.db"),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);

// Fixed on-chain constants from SPEC (kept here so callers have one source).
export const TXLINE_DEVNET_PROGRAM_ID =
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const TXL_TOKEN_MINT = "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG";
export const MUSDC_DECIMALS = 6;

/** Returns the backend authority secret (JSON byte array string), or throws. */
export function requireAuthoritySecret(): string {
  if (config.MARKET_AUTHORITY_SECRET) return config.MARKET_AUTHORITY_SECRET;
  if (config.MARKET_AUTHORITY_KEYPAIR_PATH) {
    const p = config.MARKET_AUTHORITY_KEYPAIR_PATH;
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(
    "MARKET_AUTHORITY_SECRET (JSON byte array) is not configured. Set it in app/.env.local."
  );
}
