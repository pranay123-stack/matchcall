"use client";

import { useMemo, type FC, type ReactNode } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  ConnectionProvider as ConnectionProviderRaw,
  WalletProvider as WalletProviderRaw,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as WalletModalProviderRaw } from "@solana/wallet-adapter-react-ui";
// Import from the dedicated Phantom package (not the wallet-adapter-wallets
// barrel) so we don't pull in WalletConnect/viem/ox/pino — which only produce
// noisy webpack "Critical dependency" / pino-pretty warnings. Phantom also
// auto-registers via Wallet Standard, so this stays minimal.
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import type { Adapter } from "@solana/wallet-adapter-base";
import "@solana/wallet-adapter-react-ui/styles.css";

// The wallet-adapter packages ship a nested @types/react@19 that makes their FC
// components read as invalid JSX under the app's @types/react@18. Cast to local
// component types so JSX composes correctly (behaviour is unchanged).
const ConnectionProvider = ConnectionProviderRaw as unknown as FC<{
  endpoint: string;
  children: ReactNode;
}>;
const WalletProvider = WalletProviderRaw as unknown as FC<{
  wallets: Adapter[];
  autoConnect?: boolean;
  children: ReactNode;
}>;
const WalletModalProvider = WalletModalProviderRaw as unknown as FC<{ children: ReactNode }>;

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl("devnet"),
    [],
  );
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
