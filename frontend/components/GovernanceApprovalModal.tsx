'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Proposal } from '@/lib/api';

/**
 * Replaces components/MultiSigApprovalModal.tsx (§6 Phase 4.5).
 *
 * The Safe version could only display a hash and a signature count, because
 * approvals happened in a different application entirely — the Safe{Wallet}
 * web UI — and the backend just polled for a number.
 *
 * Under §3's design the approval state machine lives in chaincode, so this
 * modal can do something the Safe version could not: show WHICH organization
 * has approved and which named signer's certificate authorized it, and let a
 * second organization approve in place. That is the "individually
 * attributable" property §3 requires, made visible rather than asserted.
 */
export function GovernanceApprovalModal({
  open,
  proposalId,
  onClose,
}: {
  open: boolean;
  proposalId: string | null;
  onClose: () => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [orgs, setOrgs] = useState<Array<{ org: string; mspId: string; role: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!proposalId) return;
    try {
      setProposal(await api.proposal(proposalId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [proposalId]);

  useEffect(() => {
    if (!open) return;
    api.governanceSigners().then((r) => setOrgs(r.organizations)).catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [open, refresh]);

  if (!open) return null;

  const approvedMsps = new Set(proposal?.approvals.map((a) => a.mspId) ?? []);
  const threshold = proposal?.threshold ?? 2;
  const executed = proposal?.status === 'EXECUTED';

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-white">Multi-Party Approval Required</h2>
        <p className="mt-2 text-sm text-mist">
          Proposed to the governance chaincode. No single administrator can execute it — {threshold} separate
          organizations must each approve before it takes effect.
        </p>

        <div className="mt-4 rounded-lg bg-ink-800 p-3">
          <p className="text-xs uppercase tracking-wide text-mist">Proposal</p>
          <code className="mt-1 block truncate text-xs text-gold-soft">{proposalId ?? 'pending…'}</code>
          {proposal && <p className="mt-1 text-xs text-mist">{proposal.actionType}</p>}
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded bg-ink-700">
            <div
              className="h-full bg-gold transition-all"
              style={{ width: `${Math.min(100, (approvedMsps.size / threshold) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-mist">
            {approvedMsps.size} / {threshold} organizations approved — status: {proposal?.status ?? 'loading'}
          </p>
        </div>

        {/* Who approved, by organization AND by named signer — the audit story. */}
        <ul className="mt-4 space-y-2">
          {orgs.map((o) => {
            const approval = proposal?.approvals.find((a) => a.mspId === o.mspId);
            return (
              <li key={o.org} className="flex items-center justify-between rounded bg-ink-800 px-3 py-2 text-xs">
                <div>
                  <p className="text-white">{o.role}</p>
                  <p className="text-mist">
                    {approval ? `signed by ${approval.signer}` : 'awaiting approval'}
                  </p>
                </div>
                {approval ? (
                  <span className="text-green-400">✓</span>
                ) : (
                  <button
                    className="rounded bg-gold px-2 py-1 font-semibold text-black disabled:opacity-40"
                    disabled={busy || executed || !proposalId}
                    onClick={() => act(() => api.approveProposal(proposalId!, o.org))}
                  >
                    Approve
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button
            className="flex-1 rounded-lg bg-gold py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
            disabled={busy || executed || approvedMsps.size < threshold || !proposalId}
            onClick={() => act(() => api.executeProposal(proposalId!))}
          >
            {executed ? 'Executed' : 'Execute'}
          </button>
          <button
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-mist hover:text-gold"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
