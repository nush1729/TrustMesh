'use client';

import { useState } from 'react';
import { RequireIdentity } from '@/components/IdentityGate';
import { GovernanceApprovalModal } from '@/components/GovernanceApprovalModal';
import { api } from '@/lib/api';

export default function AdminAssetsPage() {
  return (
    <RequireIdentity>
      <AssetAdminFlow />
    </RequireIdentity>
  );
}

function AssetAdminFlow() {
  const [to, setTo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cid, setCid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMint() {
    if (!to || !file) return;
    setError(null);
    try {
      const res = await api.mintAsset(to, file);
      setCid(res.ipfsCID);
      setProposalId(res.proposalId);
      setModalOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin · Assets</h1>
      <p className="text-sm text-mist">
        Minting and transfers are proposed to the governance chaincode — a single administrator cannot mint or move
        an asset. Documents go to the institution&rsquo;s own private storage node, never a public pinning service.
      </p>

      <div className="space-y-4 rounded-xl border border-white/10 bg-ink-800 p-5">
        <label className="block text-sm text-mist">
          Recipient (DID hash)
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="64-character DID hash"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
          />
        </label>

        <label className="block text-sm text-mist">
          Asset document / metadata file
          <input
            type="file"
            className="mt-1 w-full text-sm text-mist file:mr-3 file:rounded-full file:border-0 file:bg-gold file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          className="w-full rounded-full bg-gold py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
          onClick={handleMint}
          disabled={!to || !file}
        >
          Propose Mint
        </button>
        {cid && <p className="break-all text-xs text-mist">Stored at CID {cid}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <GovernanceApprovalModal open={modalOpen} proposalId={proposalId} onClose={() => setModalOpen(false)} />
    </div>
  );
}
