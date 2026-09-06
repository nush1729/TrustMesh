'use client';

import { useState } from 'react';
import { CreateIdentity, LoginPrompt, RegisterIdentity } from '@/components/IdentityGate';
import { useIdentity } from '@/lib/identity-context';
import { api } from '@/lib/api';

const DOCUMENT_TYPES = ['10th Marksheet', '12th Marksheet', 'UG Marksheet', 'PG Marksheet', 'Diploma Certificate'];

/**
 * Onboarding, rebuilt for the §4 WebCrypto identity (§6 Phase 4.3).
 *
 * The EVM flow was "connect MetaMask -> sign -> DID". The three steps are now
 * explicit because they are genuinely distinct: a key is created on the device,
 * that key is anchored on the ledger, and only then can it be used to sign in.
 * Showing them separately also makes the self-sovereignty claim visible — the
 * user can see that the key exists before any server was told anything.
 */
export default function OnboardPage() {
  const { identity, registered, session } = useIdentity();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Onboard</h1>

      <Step n={1} title="Create your key" done={!!identity}>
        {identity ? (
          <div>
            <p className="text-sm text-mist">Your identity exists on this device.</p>
            <p className="mt-2 break-all rounded bg-ink-700 p-2 font-mono text-xs text-gold-soft">{identity.did}</p>
          </div>
        ) : (
          <CreateIdentity />
        )}
      </Step>

      <Step n={2} title="Anchor your DID" done={registered}>
        {!identity ? (
          <p className="text-sm text-mist">Create a key first.</p>
        ) : registered ? (
          <p className="text-sm text-mist">Anchored on the ledger.</p>
        ) : (
          <RegisterIdentity />
        )}
      </Step>

      <Step n={3} title="Sign in" done={session}>
        {!registered ? (
          <p className="text-sm text-mist">Anchor your DID first.</p>
        ) : session ? (
          <p className="text-sm text-mist">Signed in.</p>
        ) : (
          <LoginPrompt />
        )}
      </Step>

      <Step n={4} title="Import a verified document (optional)" done={false}>
        {session ? <DigilockerImport /> : <p className="text-sm text-mist">Sign in first.</p>}
      </Step>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-ink-800 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
            done ? 'bg-green-500 text-black' : 'bg-ink-700 text-mist'
          }`}
        >
          {done ? '✓' : n}
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DigilockerImport() {
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]);
  const [status, setStatus] = useState('');

  async function handleImport() {
    setStatus('Importing…');
    try {
      await api.digilockerImport(docType);
      setStatus(`Imported "${docType}" as a Verifiable Credential.`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  return (
    <div>
      <p className="text-sm text-mist">
        Bootstraps a Verifiable Credential from a DigiLocker-style verified document. The document’s field values go
        into the encrypted vault — the credential attests only that it was verified. Sandbox/mock in this prototype.
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
        className="mt-4 rounded-full border border-gold/50 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10"
        onClick={handleImport}
      >
        Import
      </button>
      {status && <p className="mt-3 text-sm text-mist">{status}</p>}
    </div>
  );
}
