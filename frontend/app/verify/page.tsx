"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function VerifyPage() {
  const [did, setDid] = useState("");
  const [result, setResult] = useState<{ roles: string[]; assets: string[]; credentialsValid: boolean } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (!did) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.verifyStatus(did);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Verifier Portal</h1>
      <p className="text-sm text-mist">
        Checks role, ownership, and credential status directly against on-chain state. This endpoint never returns
        raw PII from the encrypted vault — only status booleans and role/asset identifiers.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-white/15 bg-ink-800 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="did:ethr:amoy:0x..."
          value={did}
          onChange={(e) => setDid(e.target.value)}
        />
        <button
          className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          onClick={handleVerify}
        >
          Verify
        </button>
      </div>

      {loading && <p className="text-sm text-mist">Checking…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="rounded-xl border border-white/10 bg-ink-800 p-5 text-sm">
          <p>
            <span className="font-semibold text-white">Credentials valid:</span>{" "}
            <span className="text-mist">{result.credentialsValid ? "Yes" : "No"}</span>
          </p>
          <p className="mt-2">
            <span className="font-semibold text-white">Active roles:</span>{" "}
            <span className="text-mist">{result.roles.length ? result.roles.join(", ") : "none"}</span>
          </p>
          <p className="mt-2">
            <span className="font-semibold text-white">Assets owned:</span>{" "}
            <span className="text-mist">{result.assets.length ? result.assets.join(", ") : "none"}</span>
          </p>
        </div>
      )}
    </div>
  );
}
