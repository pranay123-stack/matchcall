"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Market } from "@/app/_lib/api";
import { api, ApiError, marketTitle, isLockPassed } from "@/app/_lib/api";
import { signSendConfirm } from "@/app/_lib/solana";
import { PoolBars } from "./PoolBars";
import { Button, Spinner, cx } from "./ui";

type Phase = "idle" | "signing" | "confirming" | "recording" | "done" | "error";

export function PredictionWidget({
  market,
  onDone,
}: {
  market: Market;
  onDone?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [outcome, setOutcome] = useState<number>(market.outcomes[0]?.index ?? 0);
  const [amount, setAmount] = useState<string>("10");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  const lockPassed = isLockPassed(market);
  const locked = market.status !== "OPEN" || lockPassed;
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const busy = phase === "signing" || phase === "confirming" || phase === "recording";

  async function stake() {
    if (!publicKey || !connected) {
      setMsg("Connect your wallet first.");
      return;
    }
    if (!amountValid) {
      setMsg("Enter a valid mUSDC amount.");
      return;
    }
    setMsg(null);
    setTxSig(null);
    try {
      setPhase("signing");
      const wallet = publicKey.toBase58();
      const intent = await api.predictionIntent({
        marketId: market.id,
        wallet,
        outcome,
        amount: amountNum, // whole mUSDC — the backend converts to base units
      });

      setPhase("confirming");
      const signature = await signSendConfirm(connection, sendTransaction, intent.transactionBase64);
      setTxSig(signature);

      setPhase("recording");
      await api.predictionConfirm({ marketId: market.id, wallet, outcome, signature });

      setPhase("done");
      setMsg(`Staked ${amountNum} mUSDC on “${outcomeLabel(market, outcome)}”.`);
      onDone?.();
    } catch (e) {
      setPhase("error");
      setMsg(errText(e));
    }
  }

  async function getFaucet() {
    if (!publicKey) {
      setMsg("Connect your wallet to receive test mUSDC.");
      return;
    }
    setFaucetBusy(true);
    setMsg(null);
    try {
      const res = await api.faucet(publicKey.toBase58());
      const gas = res && typeof res === "object" && "solSent" in res && (res as { solSent?: number }).solSent
        ? " + a little devnet SOL for gas"
        : "";
      setMsg(`Sent 1000 test mUSDC${gas}. Ready to stake in a few seconds.`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setFaucetBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Place a prediction</h3>
        <span className="text-xs text-white/40">{marketTitle(market)}</span>
      </div>

      {/* live pools */}
      <PoolBars market={market} highlight={outcome} />

      {locked ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/60">
          {lockPassed
            ? "This market is locked — the lock time has passed, so no new predictions. It stays locked until the match ends and the keeper settles it against TxLINE."
            : `This market is ${market.status.toLowerCase()} — new predictions are closed.`}
        </div>
      ) : (
        <>
          {/* outcome picker */}
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Your call</div>
            <div className="grid grid-cols-3 gap-2">
              {market.outcomes.map((o) => (
                <button
                  key={o.index}
                  type="button"
                  onClick={() => setOutcome(o.index)}
                  className={cx(
                    "rounded-xl border px-2 py-2.5 text-sm font-medium transition",
                    outcome === o.index
                      ? "border-neon bg-neon/15 text-neon"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/25",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* amount */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-white/40">Stake (mUSDC)</span>
              <div className="flex gap-1">
                {[10, 25, 100].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-white/60 hover:bg-white/10"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full rounded-xl border border-white/10 bg-pitch-950/60 px-3 py-2.5 text-lg font-semibold tabular-nums text-white outline-none focus:border-neon/50"
              placeholder="0.00"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={stake}
              disabled={!connected || busy || !amountValid}
              className="flex-1"
            >
              {busy ? <Spinner /> : null}
              {phase === "signing"
                ? "Building tx…"
                : phase === "confirming"
                  ? "Confirming…"
                  : phase === "recording"
                    ? "Recording…"
                    : connected
                      ? "Stake prediction"
                      : "Connect wallet to stake"}
            </Button>
            <Button variant="outline" onClick={getFaucet} disabled={faucetBusy}>
              {faucetBusy ? <Spinner /> : "＋"} Get test mUSDC
            </Button>
          </div>
        </>
      )}

      {msg ? (
        <div
          className={cx(
            "rounded-lg border px-3 py-2 text-sm",
            phase === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-neon/30 bg-neon/10 text-neon",
          )}
        >
          {msg}
          {txSig ? (
            <>
              {" "}
              <a
                className="underline decoration-dotted underline-offset-2"
                href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
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

function outcomeLabel(m: Market, index: number): string {
  return m.outcomes.find((o) => o.index === index)?.label ?? `#${index}`;
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) {
    if (/reject|denied|cancel/i.test(e.message)) return "Transaction was rejected in your wallet.";
    return e.message;
  }
  return "Something went wrong.";
}
