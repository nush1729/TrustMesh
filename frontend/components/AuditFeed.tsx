'use client';

import { useEffect, useState } from 'react';
import { api, AuditEvent } from '@/lib/api';

const TYPE_LABELS: Record<AuditEvent['type'], string> = {
  DID_REGISTERED: 'DID Registered',
  CONTROLLER_UPDATED: 'Controller Rotated',
  ROLE_GRANTED: 'Role Granted',
  ROLE_REVOKED: 'Role Revoked',
  ASSET_MINTED: 'Asset Minted',
  ASSET_TRANSFERRED: 'Asset Transferred',
  CREDENTIAL_REVOKED: 'Credential Revoked',
  PROPOSAL_CREATED: 'Action Proposed',
  PROPOSAL_APPROVED: 'Action Approved',
};

export function AuditFeed() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .auditFeed()
        .then((res) => !cancelled && setEvents(res.events))
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) return <p className="text-sm text-mist">Loading audit feed…</p>;
  if (error) return <p className="text-sm text-red-400">Could not load audit feed: {error}</p>;
  if (events.length === 0) return <p className="text-sm text-mist">No events yet.</p>;

  return (
    <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-ink-800">
      {events.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-white">{TYPE_LABELS[e.type] ?? e.type}</p>
            <p className="truncate text-xs text-mist">
              {e.actor} → {e.target}
            </p>
            {/* The Safe could not show this: approvals happened in another
                application entirely, so the audit trail could never name who
                authorized an action alongside the action itself. */}
            {e.governance?.approvals && e.governance.approvals.length > 0 && (
              <p className="mt-1 text-[11px] text-gold-soft">
                approved by {e.governance.approvals.map((a) => `${a.signer} (${a.mspId})`).join(', ')}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right text-xs text-mist">
            <p>{new Date(e.timestamp).toLocaleString()}</p>
            {/* A permissioned ledger has no public block explorer to link to;
                the transaction id and block number are the citable reference. */}
            <p className="font-mono text-[10px]" title={e.txHash}>
              block {e.blockNumber} · {e.txHash.slice(0, 10)}…
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
