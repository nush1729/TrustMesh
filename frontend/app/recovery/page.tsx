'use client';

import { useState } from 'react';
import { RequireIdentity } from '@/components/IdentityGate';
import { useIdentity } from '@/lib/identity-context';
import { api } from '@/lib/api';

/**
 * NEW PAGE — guardian-based social recovery.
 *
 * The backend/chaincode side (recovery.routes -> recovery.service ->
 * UPDATE_CONTROLLER governance action) predates this page; there was
 * previously no way to reach it except curl. Three independent actions live
 * here because they are performed by different people at different times:
 * a citizen adding guardians for THEIR OWN identity, and — separately — a
 * guardian proposing or voting on someone else's recovery.
 */
export default function RecoveryPage() {
  return (
    <RequireIdentity>
      <RecoveryView />
    </RequireIdentity>
  );
}

function RecoveryView() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Guardian Recovery</h1>
        <p className="mt-1 text-sm text-mist">
          Guardians can vote to re-bind your DID to a new key if you lose this device. Re-binding itself is a governed
          chaincode action — no single guardian, and no single administrator, can move your identity alone.
        </p>
      </div>
      <AddGuardianCard />
      <ProposeRecoveryCard />
      <VoteRecoveryCard />
    </div>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-ink-800 p-5">
      <div>
        <h2 className="font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-mist">{description}</p>
      </div>
      {children}
    </section>
  );
}

function AddGuardianCard() {
  const { identity } = useIdentity();
  const [guardianId, setGuardianId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!guardianId) return;
    setBusy(true);
    setStatus(null);
    try {
      // Always adds a guardian for the CALLER's own DID — the backend derives
      // that from the session, never from a field on this form.
      await api.addGuardian(guardianId.trim());
      setStatus(`Guardian added for your DID (${identity?.did.slice(0, 20)}…).`);
      setGuardianId('');
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Add a guardian"
      description="Register someone you trust to vote on recovering your own identity. Add at least two — with only one guardian, a recovery vote can never reach threshold and can never execute."
    >
      <label className="block text-sm text-mist">
        Guardian&rsquo;s DID hash
        <input
          className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="64-character DID hash"
          value={guardianId}
          onChange={(e) => setGuardianId(e.target.value.trim())}
        />
      </label>
      <button
        className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
        onClick={submit}
        disabled={busy || !guardianId}
      >
        Add guardian
      </button>
      {status && <p className="text-sm text-mist">{status}</p>}
    </Card>
  );
}

function ProposeRecoveryCard() {
  const [didHash, setDidHash] = useState('');
  const [newControllerPublicKey, setNewControllerPublicKey] = useState('');
  const [result, setResult] = useState<{ requestId: string; threshold: number; votes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!didHash || !newControllerPublicKey) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.proposeRecovery(didHash.trim(), newControllerPublicKey.trim());
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Propose a recovery"
      description="For a DID whose guardian you are. Requires the new device's public key — export it from Create Identity on that device before it is registered."
    >
      <label className="block text-sm text-mist">
        DID hash to recover
        <input
          className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="64-character DID hash"
          value={didHash}
          onChange={(e) => setDidHash(e.target.value.trim())}
        />
      </label>
      <label className="block text-sm text-mist">
        New controller public key (SPKI, base64)
        <textarea
          rows={3}
          className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="base64 SPKI public key of the new device's identity"
          value={newControllerPublicKey}
          onChange={(e) => setNewControllerPublicKey(e.target.value.trim())}
        />
      </label>
      <button
        className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
        onClick={submit}
        disabled={busy || !didHash || !newControllerPublicKey}
      >
        Propose recovery
      </button>
      {result && (
        <div className="rounded-lg bg-ink-700 p-3 text-xs text-mist">
          <p>
            Request ID: <span className="font-mono text-gold-soft">{result.requestId}</span>
          </p>
          <p className="mt-1">
            {result.votes} / {result.threshold} guardian votes so far — share the request ID with the other
            guardians so they can vote.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Card>
  );
}

function VoteRecoveryCard() {
  const [requestId, setRequestId] = useState('');
  const [result, setResult] = useState<{ status: string; votes: number; threshold?: number; proposalId?: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.voteRecovery(requestId.trim());
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Vote on a recovery"
      description="Cast your guardian vote. Once enough guardians vote, the controller change is itself submitted as a governed action requiring separate multi-organization approval before it takes effect on the ledger."
    >
      <label className="block text-sm text-mist">
        Request ID
        <input
          className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="recovery request ID"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value.trim())}
        />
      </label>
      <button
        className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
        onClick={submit}
        disabled={busy || !requestId}
      >
        Vote
      </button>
      {result && (
        <div className="rounded-lg bg-ink-700 p-3 text-xs text-mist">
          <p>
            Status: <span className="text-gold-soft">{result.status}</span> — {result.votes}
            {result.threshold ? ` / ${result.threshold}` : ''} votes
          </p>
          {result.proposalId && (
            <p className="mt-1">
              Threshold met — controller update proposed to governance as{' '}
              <span className="font-mono text-gold-soft">{result.proposalId}</span> and auto-approved in this demo
              deployment (see Admin · Approvals to watch it, or query <code>/verify/:did</code> once executed).
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Card>
  );
}
