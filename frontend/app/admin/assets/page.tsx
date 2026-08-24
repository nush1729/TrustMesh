"use client";

import { useState } from "react";
import { RequireWallet } from "@/components/WalletConnect";
import { MultiSigApprovalModal, SafeTxStatus } from "@/components/MultiSigApprovalModal";
import { api } from "@/lib/api";

export default function AdminAssetsPage() {
  return (
    <RequireWallet>
      <AssetAdminFlow />
    </RequireWallet>
  );
}

function AssetAdminFlow() {
  const [to, setTo] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [safeTxHash, setSafeTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<SafeTxStatus>("pending");

  async function handleMint() {
    if (!to || !file) return;
    setModalOpen(true);
    setStatus("pending");
    const { safeTxHash: hash } = await api.mintAsset(to, file, description);
    setSafeTxHash(hash);
    setStatus("awaiting-cosigner");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin · Assets</h1>
      <p className="text-sm text-mist">
        Minting and transfers are proposed to the Gnosis Safe — a single admin key cannot mint or move an asset.
      </p>

      <div className="space-y-4 rounded-xl border border-white/10 bg-ink-800 p-5">
        <label className="block text-sm text-mist">
          Recipient Wallet / DID-linked Address
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="0x..."
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>

        <label className="block text-sm text-mist">
          Description
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="e.g. Lab Equipment #14 custody certificate"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="block text-sm text-mist">
          Asset Document / Metadata File
          <input
            type="file"
            className="mt-1 w-full text-sm text-mist file:mr-3 file:rounded-full file:border-0 file:bg-gold file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          className="w-full rounded-full bg-gold py-2 text-sm font-semibold text-black hover:opacity-90"
          onClick={handleMint}
        >
          Propose Mint
        </button>
      </div>

      <MultiSigApprovalModal
        open={modalOpen}
        safeTxHash={safeTxHash}
        status={status}
        requiredSignatures={2}
        collectedSignatures={status === "executed" ? 2 : 1}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
