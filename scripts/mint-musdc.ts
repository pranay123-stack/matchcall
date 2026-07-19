// MatchCall — mUSDC mint + faucet CLI (thin wrapper over app/lib).
//
// Usage (run from app/):
//   npm run mint:musdc              -> create the fixed mUSDC mint + initial supply
//   npm run mint:musdc -- <wallet>  -> airdrop 1000 mUSDC to <wallet>
//   npm run mint:musdc -- <wallet> <amount>
import { airdropMusdc, createMusdcMint } from "../app/lib/onchain/musdc.js";

async function main(): Promise<void> {
  const [wallet, amountArg] = process.argv.slice(2);

  if (!wallet) {
    const result = await createMusdcMint();
    console.log(
      result.created
        ? `Created mUSDC mint ${result.mint} and minted initial supply to the deployer.`
        : `mUSDC mint ${result.mint} already exists.`
    );
    return;
  }

  const amount = amountArg ? Number(amountArg) : 1000;
  const result = await airdropMusdc(wallet, amount);
  console.log(`Airdropped ${result.amount} mUSDC to ${wallet} (ATA ${result.ata}). Signature: ${result.signature}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
