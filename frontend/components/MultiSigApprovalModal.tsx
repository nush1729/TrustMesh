"use client";

import { useState } from "react";

export type SafeTxStatus = "pending" | "awaiting-cosigner" | "executed" | "failed";

/// Shows the Gnosis Safe co-signing flow after an admin action (role grant,
/// asset mint) is proposed. This app never lets a single admin key act
/// alone — every state-changing admin call must clear this modal.
export function MultiSigApprovalModal({
  open,
  safeTxHash,
  status,
  requiredSignatures,
  collectedSignatures,
  onClose,
}: {
  open: boolean;
  safeTxHash: string | null;
  status: SafeTxStatus;
  requiredSignatures: number;
  collectedSignatures: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-white">Multi-Sig Approval Required</h2>
        <p className="mt-2 text-sm text-mist">
          This action was proposed to the Gnosis Safe. No single admin key can execute it — {requiredSignatures}{" "}
          co-signer(s) must approve before it runs on-chain.
        </p>

        <div className="mt-4 rounded-lg bg-ink-800 p-3">
          <p className="text-xs uppercase tracking-wide text-mist">Safe transaction hash</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="truncate text-xs text-gold-soft">{safeTxHash ?? "pending..."}</code>
            {safeTxHash && (
              <button
                className="shrink-0 text-xs text-gold underline"
                onClick={() => {
                  navigator.clipboard.writeText(safeTxHash);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded bg-ink-700">
            <div
              className="h-full bg-gold transition-all"
              style={{ width: `${Math.min(100, (collectedSignatures / requiredSignatures) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-mist">
            {collectedSignatures} / {requiredSignatures} signatures collected — status: {status}
          </p>
        </div>

        <button
          className="mt-6 w-full rounded-lg bg-gold py-2 text-sm font-semibold text-black hover:opacity-90"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
