'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireIdentity } from '@/components/IdentityGate';
import { api, Proposal } from '@/lib/api';

/**
 * NEW PAGE — the approval queue.
 *
 * On the EVM stack this screen did not exist, because co-signers approved in
 * the Safe{Wallet} web UI, a separate product. §3's application-level
 * governance moves that state machine into chaincode, so the queue of pending
 * actions and the record of who approved what becomes part of TrustMesh
 * itself — and, unlike the Safe UI, it can show the specific action being
 * authorized rather than an opaque transaction hash.
 */
export default function GovernancePage() {
  return (
    <RequireIdentity>
      <ApprovalQueue />
    </RequireIdentity>
  );
}

function ApprovalQueue() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [orgs, setOrgs] = useState<Array<{ org: string; mspId: string; role: string }>>([]);
  const [threshold, setThreshold] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [pending, signers] = await Promise.all([api.pendingProposals(), api.governanceSigners()]);
      setProposals(pending.proposals);
      setOrgs(signers.organizations);
      setThreshold(signers.threshold);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin · Approvals</h1>
        <p className="mt-1 text-sm text-mist">
          Actions awaiting a second organization&rsquo;s approval. {threshold} of {orgs.length} separate
          organizations must approve before anything takes effect.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {orgs.map((o) => (
          <span key={o.org} className="rounded-full border border-white/15 px-3 py-1 text-xs text-mist">
            {o.role} <span className="font-mono text-[10px] text-gold-soft">{o.mspId}</span>
          </span>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {proposals.length === 0 ? (
        <p className="text-sm text-mist">Nothing awaiting approval.</p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => {
            const approved = new Set(p.approvals.map((a) => a.mspId));
            const ready = approved.size >= p.threshold;
            return (
              <li key={p.proposalId} className="rounded-xl border border-white/10 bg-ink-800 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{p.actionType}</p>
                    <p className="truncate font-mono text-[10px] text-mist" title={p.proposalId}>
                      {p.proposalId}
                    </p>
                    <p className="mt-1 text-xs text-mist">
                      proposed by {p.proposedBy} ({p.proposedByMsp}) · {new Date(p.proposedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-ink-700 px-2 py-1 text-xs text-mist">
                    {approved.size}/{p.threshold}
                  </span>
                </div>

                <dl className="mt-3 space-y-1 text-xs">
                  {Object.entries(p.params).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-mist">{k}</dt>
                      <dd className="truncate text-right font-mono text-gold-soft" title={v}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  {orgs
                    .filter((o) => !approved.has(o.mspId))
                    .map((o) => (
                      <button
                        key={o.org}
                        disabled={busy === p.proposalId}
                        onClick={() => act(p.proposalId, () => api.approveProposal(p.proposalId, o.org))}
                        className="rounded-full border border-gold/50 px-3 py-1 text-xs font-semibold text-gold hover:bg-gold/10 disabled:opacity-40"
                      >
                        Approve as {o.role}
                      </button>
                    ))}
                  <button
                    disabled={!ready || busy === p.proposalId}
                    onClick={() => act(p.proposalId, () => api.executeProposal(p.proposalId))}
                    className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-30"
                  >
                    Execute
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
