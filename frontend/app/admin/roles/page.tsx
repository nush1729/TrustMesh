'use client';

import { useState } from 'react';
import { RequireIdentity } from '@/components/IdentityGate';
import { GovernanceApprovalModal } from '@/components/GovernanceApprovalModal';
import { api, RoleName } from '@/lib/api';

const ROLES: RoleName[] = ['Admin', 'Manager', 'Auditor', 'User'];

export default function AdminRolesPage() {
  return (
    <RequireIdentity>
      <RoleAdminFlow />
    </RequireIdentity>
  );
}

function RoleAdminFlow() {
  const [role, setRole] = useState<RoleName>('Manager');
  const [subject, setSubject] = useState('');
  const [orgLabel, setOrgLabel] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose(kind: 'grant' | 'revoke') {
    if (!subject) return;
    setError(null);
    try {
      const expiry = Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60;
      const res =
        kind === 'grant'
          ? await api.grantRole(role, subject, expiry, orgLabel || undefined)
          : await api.revokeRole(role, subject);
      setProposalId(res.proposalId);
      setModalOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin · Roles</h1>
      <p className="text-sm text-mist">
        Every grant and revoke below is proposed to the governance chaincode. It never executes on a single
        administrator&rsquo;s authority — a second organization must approve first.
      </p>

      <div className="space-y-4 rounded-xl border border-white/10 bg-ink-800 p-5">
        <label className="block text-sm text-mist">
          Role
          <select
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-white focus:border-gold focus:outline-none"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleName)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-mist">
          Subject (DID hash)
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="64-character DID hash"
            value={subject}
            onChange={(e) => setSubject(e.target.value.trim())}
          />
        </label>

        <label className="block text-sm text-mist">
          Organisation label (stored off-chain, erasable under DPDP)
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-sm text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="e.g. Records Department"
            value={orgLabel}
            onChange={(e) => setOrgLabel(e.target.value)}
          />
        </label>

        <label className="block text-sm text-mist">
          Expiry (days)
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-white focus:border-gold focus:outline-none"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
          />
        </label>

        <div className="flex gap-2">
          <button
            className="flex-1 rounded-full bg-gold py-2 text-sm font-semibold text-black hover:opacity-90"
            onClick={() => propose('grant')}
          >
            Propose Grant
          </button>
          <button
            className="flex-1 rounded-full border border-gold/50 py-2 text-sm font-semibold text-gold hover:bg-gold/10"
            onClick={() => propose('revoke')}
          >
            Propose Revoke
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <GovernanceApprovalModal open={modalOpen} proposalId={proposalId} onClose={() => setModalOpen(false)} />
    </div>
  );
}
