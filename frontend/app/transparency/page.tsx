'use client';

import { useEffect, useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

type Stats = {
  activeRolesByType: Record<string, number>;
  totalAssetsMinted: number;
  governance: {
    totalProposals: number;
    executedProposals: number;
    pendingOrCancelledProposals: number;
    avgTimeToApprovalMs: number | null;
  };
  generatedAt: string;
};

/**
 * Item 4 (public transparency dashboard). No session, no identity required —
 * this is the one page in the app anyone can load without an identity at
 * all. Backed by GET /transparency/stats (also public — see PUBLIC_PATHS in
 * backend/src/server.fabric.ts), which computes these numbers from live
 * ledger/indexer state (backend/src/fabric/transparency.service.ts), never
 * from fabricated placeholders.
 */
export default function TransparencyPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${BACKEND_URL}/transparency/stats`);
      if (!res.ok) throw new Error(`${res.status}`);
      setStats(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Public Transparency Dashboard</h1>
        <p className="mt-2 text-sm text-mist">
          Aggregate, PII-free statistics computed live from ledger state. No sign-in required — nothing here is a
          name, a document, or any other personal data, only counts and durations.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Could not load stats: {error}</p>}
      {!stats && !error && <p className="text-sm text-mist">Loading…</p>}

      {stats && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-semibold text-white">Active roles by type</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(stats.activeRolesByType).map(([role, count]) => (
                <div key={role} className="rounded-xl border border-white/10 bg-ink-800 p-4 text-center">
                  <p className="text-2xl font-bold text-gold">{count}</p>
                  <p className="mt-1 text-xs text-mist">{role}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-semibold text-white">Assets</h2>
            <div className="rounded-xl border border-white/10 bg-ink-800 p-4 text-center sm:w-48">
              <p className="text-2xl font-bold text-gold">{stats.totalAssetsMinted}</p>
              <p className="mt-1 text-xs text-mist">Total assets minted</p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-semibold text-white">Governance proposals</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total proposed" value={stats.governance.totalProposals} />
              <Stat label="Executed" value={stats.governance.executedProposals} />
              <Stat label="Pending / cancelled" value={stats.governance.pendingOrCancelledProposals} />
              <Stat
                label="Avg. time to approval"
                value={
                  stats.governance.avgTimeToApprovalMs === null
                    ? '—'
                    : formatDuration(stats.governance.avgTimeToApprovalMs)
                }
              />
            </div>
          </section>

          <p className="text-right text-[11px] text-mist/60">
            Last updated {new Date(stats.generatedAt).toLocaleTimeString()} — refreshes automatically.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 p-4 text-center">
      <p className="text-2xl font-bold text-gold">{value}</p>
      <p className="mt-1 text-xs text-mist">{label}</p>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)}m`;
}
