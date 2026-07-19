// MatchCall — TxLINE devnet activation logic.
//
// Lives in app/lib so bare imports resolve against app/node_modules regardless
// of the cwd the wrapper script runs from. Subscribes on the TxLINE devnet
// program (free World Cup tier), fetches a guest JWT, signs the activation
// message, activates the API token, and writes credentials to app/.env.local.
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "node:fs";
import nacl from "tweetnacl";
import { config } from "../config.js";
import { deployerKeypair } from "./musdc.js";

const DEVNET = {
  rpcUrl: config.SOLANA_RPC_URL,
  apiOrigin: config.TXLINE_ORIGIN,
  programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
  txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
};

const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: string[] = [];

function setEnvValue(filePath: string, key: string, value: string): void {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const line = `${key}=${value}`;
  const next = current.match(new RegExp(`^${key}=.*$`, "m"))
    ? current.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${current.trimEnd()}\n${line}\n`;
  fs.writeFileSync(filePath, next.endsWith("\n") ? next : `${next}\n`);
}

function getAssociatedTokenAddressSync(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) throw new Error("Owner cannot be off curve");
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function fetchDevnetIdl(provider: anchor.AnchorProvider): Promise<anchor.Idl> {
  // Prefer the IDL published ON-CHAIN by the TxLINE program — robust to docs
  // format changes (the devnet.md page no longer embeds a JSON block).
  try {
    const onchain = await anchor.Program.fetchIdl(DEVNET.programId, provider);
    if (onchain) return onchain as anchor.Idl;
  } catch {
    /* fall through to docs scrape */
  }
  const markdown = await fetch("https://txline.txodds.com/documentation/programs/devnet.md").then((r) => r.text());
  const match = markdown.match(/```json[^\n]*\n([\s\S]*?)```/);
  if (!match) {
    throw new Error("Could not load TxLINE devnet IDL (on-chain fetch failed and no JSON block in docs)");
  }
  return JSON.parse(match[1]) as anchor.Idl;
}

export async function activateTxline(envPath: string): Promise<{ jwt: string; apiToken: string }> {
  const payer = deployerKeypair();
  const wallet = new anchor.Wallet(payer);
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = await fetchDevnetIdl(provider);
  const program = new anchor.Program(idl, provider);
  if (!program.programId.equals(DEVNET.programId)) {
    throw new Error(`Loaded program ${program.programId.toBase58()} does not match TxLINE devnet program`);
  }

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], program.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(DEVNET.txlTokenMint, tokenTreasuryPda, true);
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);
  const userTokenAccount = getAssociatedTokenAddressSync(DEVNET.txlTokenMint, payer.publicKey, false);

  console.log(`Using wallet ${payer.publicKey.toBase58()}`);

  const userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
  if (!userTokenAccountInfo) {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, userTokenAccount, payer.publicKey, DEVNET.txlTokenMint)
    );
    const ataSig = await sendAndConfirmTransaction(connection, createAtaTx, [payer], { commitment: "confirmed" });
    console.log(`Created TxL associated token account: ${ataSig}`);
  }

  const txSig: string = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: payer.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: DEVNET.txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`Subscription transaction: ${txSig}`);

  const auth = await fetchJson(`${DEVNET.apiOrigin}/auth/guest/start`, { method: "POST" });
  const jwt: string = auth.token;
  if (!jwt) throw new Error("TxLINE guest auth did not return token");

  const message = new TextEncoder().encode(`${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`);
  const walletSignature = Buffer.from(nacl.sign.detached(message, payer.secretKey)).toString("base64");
  const activation = await fetchJson(`${DEVNET.apiOrigin}/api/token/activate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues: SELECTED_LEAGUES }),
  });
  const apiToken: string = activation.token ?? activation;
  if (typeof apiToken !== "string" || apiToken.length === 0) {
    throw new Error("TxLINE activation did not return an API token");
  }

  setEnvValue(envPath, "TXLINE_BASE_URL", "https://txline-dev.txodds.com/api/");
  setEnvValue(envPath, "TXLINE_AUTH_JWT", jwt);
  setEnvValue(envPath, "TXLINE_API_TOKEN", apiToken);
  console.log(`Wrote TXLINE_AUTH_JWT and TXLINE_API_TOKEN to ${envPath}`);
  return { jwt, apiToken };
}
