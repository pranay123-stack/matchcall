import { Connection } from "@solana/web3.js";
import { config } from "@/lib/config";
import { txlineClient } from "@/lib/txline/client";
import { configPda, PROGRAM_ID, MUSDC_MINT } from "@/lib/onchain/program";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let txlineOk = false;
  try {
    const fixtures = await txlineClient.fixtures();
    txlineOk = Array.isArray(fixtures);
  } catch {
    txlineOk = false;
  }

  let chainOk = false;
  let configInitialized = false;
  try {
    const connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
    const version = await connection.getVersion();
    chainOk = Boolean(version);
    const cfg = await connection.getAccountInfo(configPda(), "confirmed");
    configInitialized = Boolean(cfg);
  } catch {
    chainOk = false;
  }

  return json({
    txline: txlineOk,
    chain: chainOk,
    config: {
      rpcUrl: config.SOLANA_RPC_URL,
      programId: PROGRAM_ID.toBase58(),
      musdcMint: MUSDC_MINT.toBase58(),
      txlineBaseUrl: config.TXLINE_BASE_URL,
      txlineCredentials: Boolean(config.TXLINE_API_TOKEN),
      configInitialized,
    },
  });
}
