"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

/// Gate that only renders its children once a wallet is connected —
/// used on pages (Admin, Portal, Verify) that require an authenticated DID.
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-ink-800 p-8 text-center">
        <p className="mb-4 text-mist">Connect a wallet to continue.</p>
        <div className="flex justify-center">
          <ConnectButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
