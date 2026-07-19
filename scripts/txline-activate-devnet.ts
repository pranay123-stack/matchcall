// MatchCall — TxLINE devnet activation (thin wrapper).
//
// Delegates to app/lib/onchain/activate.ts so all bare imports resolve against
// app/node_modules. Subscribes on TxLINE devnet with .keys/deployer.json and
// writes TXLINE_AUTH_JWT + TXLINE_API_TOKEN into app/.env.local.
//
// Run from app/:  npm run txline:activate
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activateTxline } from "../app/lib/onchain/activate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, "app", ".env.local");

activateTxline(ENV_PATH).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
