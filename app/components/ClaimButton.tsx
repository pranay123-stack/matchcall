"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Market } from "@/app/_lib/api";
import { api, ApiError, explorerTx } from "@/app/_lib/api";
import { signSendConfirm } from "@/app/_lib/solana";
import { Button, Spinner, cx } from "./ui";

export function ClaimButton({
  market,
  outcome,
  onDone,
}: {
  market: Market;
  outcome?: number;
  onDone?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  const isRefund = market.status === "REFUNDING";
  const verb = isRefund ? "Claim refund" : "Claim payout";

  async function claim() {
    if (!publicKey || !connected) {
      setMsg({ ok: false, text: "Connect your wallet to claim." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const wallet = publicKey.toBase58();
      const intent = await api.claimIntent({ marketId: market.id, wallet, outcome });
      const sig = await signSendConfirm(connection, sendTransaction, intent.transactionBase64);
      // Record the claim so the button retires and a re-click can't build an
      // AlreadyClaimed tx. Best-effort — the payout already landed on-chain.
      try {
        await api.claimConfirm({ marketId: market.id, wallet, outcome: intent.outcome });
      } catch {
        /* non-fatal — chain is the source of truth */
      }
      setMsg({ ok: true, text: `${verb} succeeded.`, sig });
      onDone?.();
    } catch (e) {
      // Already claimed (409) is a success, not a failure — the payout is
      // already in the wallet. Refresh so the button retires.
      if (e instanceof ApiError && e.status === 409) {
        setMsg({ ok: true, text: e.message });
        onDone?.();
        return;
      }
      const text =
        e instanceof ApiError
          ? e.message
          : /reject|denied|cancel/i.test((e as Error).message)
            ? "Transaction rejected in wallet."
            : (e as Error).message;
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="gold" onClick={claim} disabled={busy || !connected} className="w-full">
        {busy ? <Spinner /> : "🏆"} {connected ? verb : "Connect wallet to claim"}
      </Button>
      <p className="text-[11px] text-white/40">
        {isRefund
          ? "This market is refunding — you can withdraw your original stake."
          : "Winners share the total pool pro-rata (pari-mutuel). Claim sends your payout to your wallet."}
      </p>
      {msg ? (
        <div
          className={cx(
            "rounded-lg border px-3 py-2 text-sm",
            msg.ok
              ? "border-gold/30 bg-gold/10 text-gold"
              : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
        >
          {msg.text}
          {msg.sig ? (
            <>
              {" "}
              <a
                className="underline decoration-dotted underline-offset-2"
                href={explorerTx(msg.sig)}
                target="_blank"
                rel="noreferrer"
              >
                view tx
              </a>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
