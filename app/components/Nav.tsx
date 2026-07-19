"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

// WalletMultiButton reads browser wallet state; load client-only to avoid SSR mismatch.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-36 animate-pulse rounded-xl bg-pitch-700" /> },
);

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-pitch-950/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon to-neon-600 text-lg shadow-lg shadow-neon/20">
            <span className="text-pitch-950">⚽</span>
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Match<span className="text-neon">Call</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 text-sm sm:flex">
          <NavLink href="/">Dashboard</NavLink>
          <NavLink href="/fixtures">Fixtures</NavLink>
          <NavLink href="/markets">Markets</NavLink>
          <NavLink href="/positions">Positions</NavLink>
          <NavLink href="/receipts">Receipts</NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-neon" /> devnet
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-white/70 transition hover:bg-white/5 hover:text-white"
    >
      {children}
    </Link>
  );
}
