"use client";

import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

/** base64 -> Uint8Array, browser-safe (no Buffer dependency). */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Deserialize a wallet-ready tx: prefer VersionedTransaction, fall back to legacy. */
export function deserializeTx(b64: string): Transaction | VersionedTransaction {
  const bytes = base64ToBytes(b64);
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

/**
 * Sign + send a base64 tx via the connected wallet, then wait for confirmation.
 * `sendTransaction` comes from useWallet() and handles both tx flavors.
 */
export async function signSendConfirm(
  connection: Connection,
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    connection: Connection,
    options?: { skipPreflight?: boolean; maxRetries?: number },
  ) => Promise<string>,
  transactionBase64: string,
): Promise<string> {
  const tx = deserializeTx(transactionBase64);
  // Use the blockhash the server already put on the tx (it has propagated by
  // now). Skip client-side preflight — some wallets simulate against an RPC
  // node that is slightly behind and reject a valid tx as "Unexpected error";
  // we do our own confirmation below.
  let signature: string;
  try {
    signature = await sendTransaction(tx, connection, { skipPreflight: true, maxRetries: 3 });
  } catch (err) {
    throw new Error(walletErrorDetail(err));
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

/** Wallet adapters wrap the real cause as a generic "Unexpected error"; dig it out. */
function walletErrorDetail(err: unknown): string {
  const e = err as { message?: string; error?: { message?: string }; cause?: { message?: string }; logs?: string[] };
  const inner = e?.error?.message || e?.cause?.message;
  const logs = Array.isArray(e?.logs) ? ` | logs: ${e!.logs!.slice(-3).join(" ")}` : "";
  // eslint-disable-next-line no-console
  console.error("[MatchCall] wallet send failed:", err);
  if (inner && inner !== e?.message) return `${e?.message ?? "Wallet error"}: ${inner}${logs}`;
  return `${e?.message ?? "Wallet error"}${logs}`;
}
