import { explorerAddr, MUSDC_MINT, PROGRAM_ID, TXLINE_PROGRAM_ID } from "@/app/_lib/api";

export const metadata = { title: "How MatchCall works" };

const STEPS = [
  {
    n: 1,
    tint: "sky",
    title: "TxLINE signs the data",
    body: "Live World Cup scores come from TxLINE's cryptographically-signed sports feed. Every score update is hashed into a Merkle tree.",
  },
  {
    n: 2,
    tint: "violet",
    title: "The root is anchored on Solana",
    body: "TxLINE writes the day's Merkle root into an on-chain account (a daily_scores_roots PDA of the TxLINE oracle program). The truth now lives on-chain.",
  },
  {
    n: 3,
    tint: "gold",
    title: "You stake into a program-owned escrow",
    body: "Creating a market spins up a PDA + an SPL token escrow. Your mUSDC stake is transferred into that escrow by the prediction_escrow program — no operator custody.",
  },
  {
    n: 4,
    tint: "neon",
    title: "Settlement is proved, not trusted",
    body: "At full-time the keeper fetches the score's Merkle proof and calls settle_market, which CPIs into TxLINE's validate_stat_v2. That instruction re-folds the proof to the anchored root; the market only settles if it matches. Winners then pull their pari-mutuel payout.",
  },
];

const tintClasses: Record<string, { ring: string; badge: string }> = {
  sky: { ring: "ring-sky-400/30", badge: "bg-sky-400/15 text-sky-300" },
  violet: { ring: "ring-violet-400/30", badge: "bg-violet-400/15 text-violet-300" },
  gold: { ring: "ring-gold/30", badge: "bg-gold/15 text-gold" },
  neon: { ring: "ring-neon/30", badge: "bg-neon/15 text-neon" },
};

export default function HowItWorksPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-wider text-white/60">
          Trustless settlement
        </div>
        <h1 className="max-w-2xl text-2xl font-extrabold leading-tight sm:text-3xl">
          No oracle you have to trust. The chain checks the score itself.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-white/60">
          MatchCall never lets an operator decide who won. A market can only resolve to the outcome
          TxLINE cryptographically proved — verified on-chain, by the program, at settlement time.
        </p>
      </div>

      {/* flow */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {STEPS.map((s) => {
          const t = tintClasses[s.tint];
          return (
            <div key={s.n} className={`glass p-5 ring-1 ${t.ring}`}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${t.badge}`}
                >
                  {s.n}
                </span>
                <span className="font-semibold text-white">{s.title}</span>
              </div>
              <p className="text-sm leading-relaxed text-white/60">{s.body}</p>
            </div>
          );
        })}
      </div>

      {/* the CPI, spelled out */}
      <div className="glass p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
          The settlement instruction, precisely
        </h2>
        <ol className="space-y-2 text-sm text-white/70">
          <li>
            <span className="font-mono text-neon">settle_market(payload)</span> is permissionless —
            anyone (our keeper) can call it with a valid TxLINE proof.
          </li>
          <li>
            It re-derives the <span className="font-mono text-white/80">daily_scores_roots</span> PDA
            straight from the proof&apos;s own timestamp and checks the account is owned by the TxLINE
            program — so a caller can&apos;t swap in a fake root.
          </li>
          <li>
            It CPIs into TxLINE&apos;s{" "}
            <span className="font-mono text-white/80">validate_stat_v2</span> (discriminator{" "}
            <span className="font-mono text-[11px] text-white/50">[208,215,194,214,241,71,246,178]</span>
            ) and reads the returned boolean. If the proof doesn&apos;t fold to the anchored root, the
            CPI returns false and the whole transaction reverts.
          </li>
          <li>
            The winning outcome is <em>derived on-chain</em> from the proven final score — never
            supplied by the caller. Payout is pari-mutuel: your stake × total pool ÷ your-outcome
            pool.
          </li>
        </ol>
      </div>

      {/* verify */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Addr label="prediction_escrow" addr={PROGRAM_ID} />
        <Addr label="TxLINE oracle" addr={TXLINE_PROGRAM_ID} />
        <Addr label="mUSDC token" addr={MUSDC_MINT} />
      </div>
    </div>
  );
}

function Addr({ label, addr }: { label: string; addr: string }) {
  return (
    <a
      href={explorerAddr(addr)}
      target="_blank"
      rel="noreferrer"
      className="group rounded-xl border border-white/5 bg-pitch-950/40 px-3 py-2 text-xs transition hover:border-neon/30"
    >
      <div className="text-white/50 group-hover:text-white/70">{label} ↗</div>
      <div className="truncate font-mono text-[11px] text-neon/80">{addr}</div>
    </a>
  );
}
