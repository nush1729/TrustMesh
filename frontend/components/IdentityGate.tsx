'use client';

import { useState } from 'react';
import { useIdentity } from '@/lib/identity-context';

/**
 * Replaces components/WalletConnect.tsx.
 *
 * The EVM version gated pages on "is a wallet connected". Under §4 there is no
 * wallet, and the gate has three distinct states instead of one, because they
 * need genuinely different actions from the user:
 *
 *   no identity  -> create a keypair on this device (or restore a backup)
 *   not anchored -> register the DID on the ledger
 *   no session   -> sign a challenge to log in
 *
 * Collapsing these into one "connect" button, as wagmi did, would leave a user
 * whose DID was re-bound by guardian recovery staring at a button that silently
 * does nothing.
 */
export function RequireIdentity({ children }: { children: React.ReactNode }) {
  const { identity, registered, session, loading } = useIdentity();

  if (loading) {
    return <Panel><p className="text-mist">Checking this device’s identity…</p></Panel>;
  }
  if (!identity) return <Panel><CreateIdentity /></Panel>;
  if (!registered) return <Panel><RegisterIdentity /></Panel>;
  if (!session) return <Panel><LoginPrompt /></Panel>;

  return <>{children}</>;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-ink-800 p-8 text-center">{children}</div>
  );
}

function ErrorLine() {
  const { error } = useIdentity();
  if (!error) return null;
  return <p className="mt-3 text-sm text-red-400">{error}</p>;
}

export function CreateIdentity() {
  const { create, createWithBackup, restore, loading } = useIdentity();
  const [mode, setMode] = useState<'simple' | 'backup' | 'restore'>('simple');
  const [passphrase, setPassphrase] = useState('');
  const [backupJson, setBackupJson] = useState('');

  async function handleBackup() {
    const blob = await createWithBackup(passphrase);
    // The backup never leaves the browser except by the user's own action.
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trustmesh-identity-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    setPassphrase('');
  }

  return (
    <div className="space-y-4 text-left">
      <div>
        <h2 className="text-center font-semibold text-white">Create your identity</h2>
        <p className="mt-2 text-center text-sm text-mist">
          A keypair is generated in this browser and never leaves it. No wallet extension, no account, no password
          held by any server.
        </p>
      </div>

      <div className="flex justify-center gap-2 text-xs">
        {(['simple', 'backup', 'restore'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 transition ${
              mode === m ? 'bg-gold text-black' : 'border border-white/15 text-mist hover:text-gold'
            }`}
          >
            {m === 'simple' ? 'This device only' : m === 'backup' ? 'With backup' : 'Restore backup'}
          </button>
        ))}
      </div>

      {mode === 'simple' && (
        <div className="text-center">
          <p className="text-xs text-mist">
            Strongest option: the key is stored so that no script — including a compromised page — can read it out.
            It cannot be moved to another browser; if you lose this device, guardian recovery is the way back.
          </p>
          <button
            className="mt-4 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
            onClick={() => create()}
            disabled={loading}
          >
            Create identity
          </button>
        </div>
      )}

      {mode === 'backup' && (
        <div className="space-y-3 text-center">
          <p className="text-xs text-mist">
            Also downloads an encrypted backup file so you can restore this identity on another device. The
            passphrase encrypts it; nobody can recover it for you if you forget it.
          </p>
          <input
            type="password"
            placeholder="Backup passphrase (min 8 characters)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-sm text-white focus:border-gold focus:outline-none"
          />
          <button
            className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
            onClick={handleBackup}
            disabled={loading || passphrase.length < 8}
          >
            Create identity and download backup
          </button>
        </div>
      )}

      {mode === 'restore' && (
        <div className="space-y-3 text-center">
          <input
            type="file"
            accept="application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setBackupJson(await file.text());
            }}
            className="w-full text-xs text-mist file:mr-3 file:rounded-full file:border-0 file:bg-gold file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
          />
          <input
            type="password"
            placeholder="Backup passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-sm text-white focus:border-gold focus:outline-none"
          />
          <button
            className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
            onClick={() => restore(backupJson, passphrase)}
            disabled={loading || !backupJson || !passphrase}
          >
            Restore
          </button>
        </div>
      )}

      <ErrorLine />
    </div>
  );
}

export function RegisterIdentity() {
  const { identity, register, loading } = useIdentity();
  return (
    <div>
      <h2 className="font-semibold text-white">Anchor your DID</h2>
      <p className="mt-2 text-sm text-mist">
        Records your public key on the ledger as this identity’s controller. You sign a proof that you hold the
        matching private key, so nobody — including this service — can register a DID you do not control.
      </p>
      <p className="mt-3 break-all rounded bg-ink-700 p-2 font-mono text-xs text-gold-soft">{identity?.did}</p>
      <button
        className="mt-4 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
        onClick={() => register()}
        disabled={loading}
      >
        Register DID
      </button>
      <ErrorLine />
    </div>
  );
}

export function LoginPrompt() {
  const { login, loading } = useIdentity();
  return (
    <div>
      <h2 className="font-semibold text-white">Sign in</h2>
      <p className="mt-2 text-sm text-mist">
        Sign a one-time challenge with your key. The server checks it against the public key the ledger holds for
        your DID — there is no password to steal.
      </p>
      <button
        className="mt-4 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
        onClick={() => login()}
        disabled={loading}
      >
        Sign challenge
      </button>
      <ErrorLine />
    </div>
  );
}

/** Compact identity status + actions for the navbar. Replaces <ConnectButton />. */
export function IdentityButton() {
  const { identity, registered, session, login, register, logout, loading } = useIdentity();
  const [open, setOpen] = useState(false);

  if (loading && !identity) return <span className="text-xs text-mist">…</span>;

  if (!identity) {
    return (
      <a href="/onboard" className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90">
        Create identity
      </a>
    );
  }

  const short = `${identity.did.slice(0, 16)}…${identity.did.slice(-4)}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-mist transition hover:border-gold hover:text-gold"
      >
        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${session ? 'bg-green-400' : 'bg-amber-400'}`} />
        {short}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-white/10 bg-ink-800 p-3 text-left shadow-xl">
          <p className="break-all font-mono text-[10px] text-mist">{identity.did}</p>
          <p className="mt-2 text-xs text-mist">
            {!registered ? 'DID not yet anchored' : session ? 'Signed in' : 'Not signed in'}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {!registered && (
              <button onClick={() => register()} className="rounded bg-gold px-3 py-1 text-xs font-semibold text-black">
                Register DID
              </button>
            )}
            {registered && !session && (
              <button onClick={() => login()} className="rounded bg-gold px-3 py-1 text-xs font-semibold text-black">
                Sign in
              </button>
            )}
            {session && (
              <button
                onClick={() => logout()}
                className="rounded border border-white/15 px-3 py-1 text-xs text-mist hover:text-gold"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
