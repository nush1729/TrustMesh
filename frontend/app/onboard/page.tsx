"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { RequireWallet } from "@/components/WalletConnect";
import { api } from "@/lib/api";

const DOCUMENT_TYPES = ["10th Marksheet", "12th Marksheet", "UG Marksheet", "PG Marksheet", "Diploma Certificate"];

export default function OnboardPage() {
  return (
    <RequireWallet>
      <OnboardFlow />
    </RequireWallet>
  );
}

function OnboardFlow() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [did, setDid] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]);

  async function handleCreateDID() {
    if (!address) return;
    setStatus("Requesting signed-DID challenge…");
    const { nonce } = await api.authChallenge(address);
    const signature = await signMessageAsync({ message: `TrustMesh DID challenge: ${nonce}` });
    await api.authVerify(address, signature, nonce);

    setStatus("Creating DID…");
    const result = await api.createDID(address);
    setDid(result.did);
    setStatus("DID created.");
  }

  async function handleImport() {
    if (!did) return;
    setStatus("Importing mock DigiLocker document…");
    await api.digilockerImport(did, docType);
    setStatus(`Imported "${docType}" as a Verifiable Credential.`);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Onboard</h1>

      <section className="rounded-xl border border-white/10 bg-ink-800 p-5">
        <h2 className="font-semibold text-white">1. Create your DID</h2>
        <p className="mt-1 text-sm text-mist">
          Your private key never leaves your wallet. A signed challenge proves control of this address before a DID
          is anchored on-chain.
        </p>
        <button
          className="mt-4 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
          onClick={handleCreateDID}
          disabled={!!did}
        >
          {did ? "DID created" : "Create DID"}
        </button>
        {did && <p className="mt-3 break-all rounded bg-ink-700 p-2 font-mono text-xs text-gold-soft">{did}</p>}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800 p-5">
        <h2 className="font-semibold text-white">2. Import a verified document (optional)</h2>
        <p className="mt-1 text-sm text-mist">
          Bootstraps a Verifiable Credential from a DigiLocker-style verified document instead of starting from
          zero. Sandbox/mock only in this prototype.
        </p>
        <select
          className="mt-4 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-sm text-white focus:border-gold focus:outline-none"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          className="mt-4 rounded-full border border-gold/50 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-40"
          onClick={handleImport}
          disabled={!did}
        >
          Import
        </button>
      </section>

      {status && <p className="text-sm text-mist">{status}</p>}
    </div>
  );
}
