// MatchCall — initialize the prediction_escrow platform config (one-time).
// Run from app/:  npm run market:init
import { initializeConfig } from "../app/lib/onchain/program.js";

initializeConfig()
  .then((result) => {
    console.log(
      result.created
        ? `initialize_config sent. Config PDA ${result.configPda}. Signature: ${result.signature}`
        : `Config already initialized at ${result.configPda}.`
    );
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
