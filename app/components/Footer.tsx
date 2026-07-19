import Link from "next/link";
import { explorerAddr, MUSDC_MINT, PROGRAM_ID, TXLINE_PROGRAM_ID } from "@/app/_lib/api";

/** Footer that lets anyone verify the whole system on-chain. */
export function Footer() {
  return (
    <footer className="mx-auto mt-10 max-w-6xl px-4 pb-10 pt-8 text-xs text-white/40 sm:px-6">
      <div className="rounded-2xl border border-white/5 bg-pitch-900/30 p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold uppercase tracking-wider text-white/50">
          <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Verify on-chain (devnet)
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <VerifyLink label="prediction_escrow program" addr={PROGRAM_ID} />
          <VerifyLink label="mUSDC test token" addr={MUSDC_MINT} />
          <VerifyLink label="TxLINE oracle program" addr={TXLINE_PROGRAM_ID} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
          Every market is a PDA of the program above; stakes sit in a program-owned SPL escrow.
          Settlement CPIs into the TxLINE oracle&apos;s <code className="text-white/50">validate_stat_v2</code>,
          which checks the score proof against a Merkle root TxLINE anchors on Solana — so a market
          can only ever resolve to what TxLINE cryptographically proved. No trusted oracle signer.
        </p>
      </div>
      <div className="mt-4 text-center text-white/30">
        MatchCall · Solana devnet · settlement proved by TxLINE on-chain sports data ·{" "}
        <Link href="/how-it-works" className="text-neon/70 hover:text-neon">
          How it works
        </Link>
      </div>
    </footer>
  );
}

function VerifyLink({ label, addr }: { label: string; addr: string }) {
  return (
    <a
      href={explorerAddr(addr)}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col rounded-xl border border-white/5 bg-pitch-950/40 px-3 py-2 transition hover:border-neon/30"
    >
      <span className="text-white/50 group-hover:text-white/70">{label} ↗</span>
      <span className="truncate font-mono text-[11px] text-neon/80">{addr}</span>
    </a>
  );
}
