"use client";

import { explorerTx, explorerAddr, TXLINE_PROGRAM_ID, type Receipt } from "@/app/_lib/api";
import { Card } from "./ui";

function isHash(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(hex) || /^[A-Za-z0-9+/=]{40,48}$/.test(s); // hex-32 or base64-32
}

/**
 * "Verify it yourself" panel. We do NOT re-implement TxLINE's private Merkle
 * hashing (that would be unverifiable and could falsely show a mismatch).
 * Instead we (1) run honest structural-integrity checks on the proof in the
 * browser and (2) point at the REAL trustless step: the on-chain settlement tx
 * that CPI'd validate_stat_v2 — which only succeeds if the proof folds to the
 * root TxLINE anchored on Solana.
 */
export function ProofVerify({ receipt }: { receipt: Receipt }) {
  const { proof, settlement } = receipt;
  const nodes =
    (proof.statProofs?.reduce((n, arr) => n + arr.length, 0) ?? 0) +
    (proof.subTreeProof?.length ?? 0) +
    (proof.mainTreeProof?.length ?? 0);

  const checks: { ok: boolean; label: string }[] = [
    { ok: isHash(proof.root), label: "Merkle root is a well-formed 32-byte hash" },
    { ok: nodes > 0, label: `Proof path present (${nodes} sibling node${nodes === 1 ? "" : "s"})` },
    {
      ok:
        Number.isInteger(settlement.finalHomeGoals) &&
        Number.isInteger(settlement.finalAwayGoals) &&
        settlement.finalHomeGoals >= 0 &&
        settlement.finalAwayGoals >= 0,
      label: `Final score read from proven leaves: ${settlement.finalHomeGoals}–${settlement.finalAwayGoals}`,
    },
    {
      ok: !!settlement.signature,
      label: "On-chain settlement transaction recorded",
    },
  ];

  return (
    <Card className="border-neon/20 bg-neon/[0.03]">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/60">
        Verify this settlement yourself
      </h2>
      <p className="mb-3 text-xs text-white/50">
        Structural checks run in your browser. The cryptographic check ran{" "}
        <span className="text-white/70">on-chain</span>: the settlement transaction below CPI&apos;d
        TxLINE&apos;s <code className="text-neon">validate_stat_v2</code>, which re-folds this proof to
        the Merkle root TxLINE anchored on Solana. The transaction only confirmed because it matched.
      </p>

      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                c.ok ? "bg-neon/20 text-neon" : "bg-red-500/20 text-red-300"
              }`}
            >
              {c.ok ? "✓" : "✗"}
            </span>
            <span className="text-white/70">{c.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-white/5 pt-3 text-sm">
        {settlement.signature ? (
          <a
            className="rounded-lg bg-neon-600 px-3 py-1.5 font-semibold text-pitch-950 hover:bg-neon"
            href={explorerTx(settlement.signature)}
            target="_blank"
            rel="noreferrer"
          >
            Open settlement tx ↗
          </a>
        ) : null}
        <a
          className="rounded-lg border border-white/10 px-3 py-1.5 text-white/70 hover:border-neon/30"
          href={explorerAddr(TXLINE_PROGRAM_ID)}
          target="_blank"
          rel="noreferrer"
        >
          TxLINE oracle program ↗
        </a>
      </div>
      <p className="mt-2 text-[11px] text-white/35">
        On the settlement tx, the <code className="text-white/50">daily_scores_roots</code> account is
        one of the accounts read — that&apos;s the on-chain Merkle root the proof was checked against.
      </p>
    </Card>
  );
}
