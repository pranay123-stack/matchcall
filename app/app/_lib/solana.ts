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
  sendTransaction: (tx: Transaction | VersionedTransaction, connection: Connection) => Promise<string>,
  transactionBase64: string,
): Promise<string> {
  const tx = deserializeTx(transactionBase64);
  const latest = await connection.getLatestBlockhash("confirmed");
  // The tx was built server-side; refresh its blockhash on the client so it
  // can't expire between build and wallet approval (legacy tx only — versioned
  // messages are immutable and the wallet handles them).
  if (tx instanceof Transaction) {
    tx.recentBlockhash = latest.blockhash;
    tx.lastValidBlockHeight = latest.lastValidBlockHeight;
  }
  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}
