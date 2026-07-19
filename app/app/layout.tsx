import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "MatchCall — Live World Cup Prediction Market",
  description:
    "Trustlessly-settled World Cup prediction markets on Solana, backed by TxLINE cryptographically-signed sports data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-center text-xs text-white/30 sm:px-6">
            MatchCall · Solana devnet · settlement proved by TxLINE on-chain sports data
          </footer>
        </Providers>
      </body>
    </html>
  );
}
