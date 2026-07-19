"use client";

import { useEffect, useState } from "react";
import {
  api,
  explorerTx,
  shortAddr,
  type ProofNode,
  type Receipt,
} from "@/app/_lib/api";
import { BackLink, Card, StatePanel } from "@/components/ui";

export default function ReceiptPage({ params }: { params: { id: string } }) {
  const marketId = params.id;
  const [receipt, setReceipt] = useState<Receipt | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getReceipt(marketId)
      .then((r) => alive && setReceipt(r))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [marketId]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink href={`/markets/${marketId}`}>Back to market</BackLink>
        <StatePanel kind="error" title="Couldn't load receipt" detail={error} />
      </div>
    );
  }

  if (receipt === undefined) {
    return (
      <div className="space-y-4">
        <BackLink href={`/markets/${marketId}`}>Back to market</BackLink>
        <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (receipt === null) {
    return (
      <div className="space-y-4">
        <BackLink href={`/markets/${marketId}`}>Back to market</BackLink>
        <StatePanel
          kind="empty"
          title="No receipt yet"
          detail="This market hasn't been settled on-chain. Once a cranker settles it against TxLINE data, the verifiable receipt appears here."
        />
      </div>
    );
  }

  const { settlement, proof, explanation } = receipt;

  return (
    <div className="space-y-6">
      <BackLink href={`/markets/${marketId}`}>Back to market</BackLink>

      <div>
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
          Verifiable resolution
        </div>
        <h1 className="text-2xl font-extrabold text-white">Proof of settlement</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/55">
          This market did not trust an oracle. The final score came from TxLINE&apos;s
          cryptographically-signed feed, was proved against an on-chain Merkle root, and the payout
          was settled by an on-chain program. Anyone can re-verify each step below.
        </p>
      </div>

      {/* 3-step flow */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StepCard
          n={1}
          title="TxLINE said"
          tint="sky"
          body={
            <>
              <div className="text-3xl font-extrabold tabular-nums text-white">
                {settlement.finalHomeGoals} : {settlement.finalAwayGoals}
              </div>
              <div className="mt-1 text-xs text-white/50">
                Final score reported by the signed sports-data feed.
              </div>
            </>
          }
        />
        <StepCard
          n={2}
          title="Cryptographic proof"
          tint="violet"
          body={
            <>
              <div className="text-xs text-white/50">Merkle root</div>
              <div className="mt-0.5 break-all font-mono text-xs text-violet-300">
                {shortAddr(proof.root, 10)}
              </div>
              <div className="mt-2 text-xs text-white/50">
                Score hashes into this root — the proof below shows the path.
              </div>
            </>
          }
        />
        <StepCard
          n={3}
          title="On-chain settlement"
          tint="neon"
          body={
            <>
              <div className="text-xs text-white/50">Winning outcome</div>
              <div className="text-lg font-bold text-neon">#{settlement.winningOutcome}</div>
              {settlement.signature ? (
                <a
                  className="mt-1 inline-block break-all font-mono text-xs text-neon hover:underline"
                  href={explorerTx(settlement.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(settlement.signature, 8)} ↗
                </a>
              ) : null}
            </>
          }
        />
      </div>

      {/* explanation */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/60">
          What happened
        </h2>
        <p className="text-sm leading-relaxed text-white/80">{explanation}</p>
      </Card>

      {/* settlement tx */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
          Settlement transaction
        </h2>
        {settlement.signature ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="break-all rounded-lg bg-pitch-950/60 px-3 py-2 font-mono text-xs text-white/80">
              {settlement.signature}
            </code>
            <a
              className="rounded-lg bg-neon-600 px-3 py-1.5 text-sm font-semibold text-pitch-950 hover:bg-neon"
              href={explorerTx(settlement.signature)}
              target="_blank"
              rel="noreferrer"
            >
              Open in Explorer ↗
            </a>
          </div>
        ) : (
          <p className="text-sm text-white/50">Signature unavailable.</p>
        )}
      </Card>

      {/* merkle proof detail */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
          Merkle proof
        </h2>
        <ProofRow label="Root">
          <code className="break-all font-mono text-xs text-neon">{proof.root}</code>
        </ProofRow>
        {proof.eventStatRoot ? (
          <ProofRow label="Event-stat root">
            <code className="break-all font-mono text-xs text-white/70">{proof.eventStatRoot}</code>
          </ProofRow>
        ) : null}

        <div className="mt-3 space-y-2">
          {proof.statProofs?.map((nodes, i) => (
            <ProofArray key={`stat-${i}`} title={`Stat proof #${i + 1}`} nodes={nodes} />
          ))}
          {proof.subTreeProof ? (
            <ProofArray title="Sub-tree proof" nodes={proof.subTreeProof} />
          ) : null}
          {proof.mainTreeProof ? (
            <ProofArray title="Main-tree proof" nodes={proof.mainTreeProof} />
          ) : null}
        </div>

        <p className="mt-3 text-[11px] text-white/35">
          Each node is a sibling hash and a left/right flag. Fold them from the leaf upward and you
          reproduce the root — proving the score was in the committed data set.
        </p>
      </Card>
    </div>
  );
}

function StepCard({
  n,
  title,
  body,
  tint,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
  tint: "sky" | "violet" | "neon";
}) {
  const ring: Record<string, string> = {
    sky: "ring-sky-400/30",
    violet: "ring-violet-400/30",
    neon: "ring-neon/30",
  };
  const badge: Record<string, string> = {
    sky: "bg-sky-400/15 text-sky-300",
    violet: "bg-violet-400/15 text-violet-300",
    neon: "bg-neon/15 text-neon",
  };
  return (
    <div className={`glass p-4 ring-1 ${ring[tint]}`}>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${badge[tint]}`}
        >
          {n}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/60">{title}</span>
      </div>
      {body}
    </div>
  );
}

function ProofRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/5 py-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-32 flex-shrink-0 text-xs uppercase tracking-wide text-white/40">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ProofArray({ title, nodes }: { title: string; nodes: ProofNode[] }) {
  return (
    <details className="rounded-lg border border-white/10 bg-pitch-950/50">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm text-white/70 hover:text-white">
        {title}{" "}
        <span className="text-xs text-white/40">({nodes.length} node{nodes.length === 1 ? "" : "s"})</span>
      </summary>
      <div className="max-h-72 overflow-auto px-3 pb-3">
        <ol className="space-y-1">
          {nodes.map((node, i) => (
            <li key={i} className="flex items-start gap-2 font-mono text-[11px]">
              <span className="mt-0.5 w-6 flex-shrink-0 text-white/30">{i}</span>
              <span
                className={`mt-0.5 flex-shrink-0 rounded px-1 text-[10px] ${
                  node.isRightSibling ? "bg-violet-400/15 text-violet-300" : "bg-sky-400/15 text-sky-300"
                }`}
              >
                {node.isRightSibling ? "R" : "L"}
              </span>
              <span className="break-all text-white/70">{node.hash}</span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
