// Diagnostic: stake from the platform authority on a given market PDA, to prove
// the place_prediction on-chain path works independently of the browser wallet.
// Run from app/:  npm run --silent tsx ../scripts/stake-once.ts <marketPda> <outcome> <amount>
import { placePredictionSigned } from "../app/lib/onchain/program.js";

const [marketPda, outcomeArg, amountArg] = process.argv.slice(2);
const outcome = Number(outcomeArg ?? 0);
const amount = Number(amountArg ?? 10);

placePredictionSigned({ marketPda, outcome, amount })
  .then((sig) => console.log(`OK staked ${amount} on outcome ${outcome} -> ${sig}`))
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
