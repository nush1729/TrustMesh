'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

type VerifyResult = Awaited<ReturnType<typeof api.verifyStatus>>;

export default function VerifyPage() {
  const [did, setDid] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (!did) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.verifyStatus(did.trim()));
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
        Checks role and asset ownership directly against ledger state. This endpoint never returns raw personal data
        from the encrypted vault — only status and identifiers.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-white/15 bg-ink-800 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="did:key:z… or a 64-character DID hash"
          value={did}
          onChange={(e) => setDid(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
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
        <div className="space-y-3 rounded-xl border border-white/10 bg-ink-800 p-5 text-sm">
          <p>
            <span className="font-semibold text-white">DID hash:</span>{' '}
            <span className="break-all font-mono text-xs text-gold-soft">{result.didHash}</span>
          </p>
          <p>
            <span className="font-semibold text-white">Active roles:</span>{' '}
            <span className="text-mist">{result.roles.length ? result.roles.join(', ') : 'none'}</span>
          </p>
          <div>
            <span className="font-semibold text-white">Assets owned:</span>{' '}
            {result.assets.length === 0 ? (
              <span className="text-mist">none</span>
            ) : (
              <ul className="mt-2 space-y-1">
                {result.assets.map((a) => (
                  <li key={a.assetId} className="rounded bg-ink-700 p-2 text-xs">
                    <span className="text-white">Asset #{a.assetId}</span>
                    <span className="ml-2 break-all font-mono text-gold-soft">{a.ipfsCID}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
