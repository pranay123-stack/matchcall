"use client";

import { useMemo, type FC, type ReactNode } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  ConnectionProvider as ConnectionProviderRaw,
  WalletProvider as WalletProviderRaw,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as WalletModalProviderRaw } from "@solana/wallet-adapter-react-ui";
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
  // Empty list on purpose: modern Phantom (and Solflare/Backpack) register
  // themselves through the Wallet Standard, so WalletProvider auto-detects the
  // installed extension. This opens the extension popup on Connect — unlike the
  // deprecated PhantomWalletAdapter, which redirects to phantom.com when it
  // fails to detect the injected provider.
  const wallets = useMemo<Adapter[]>(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
