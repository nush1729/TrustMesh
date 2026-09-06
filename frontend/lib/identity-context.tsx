'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { getOrCreateDeviceId } from './device';
import {
  createIdentity,
  createIdentityWithBackup,
  forgetIdentity,
  getPublicIdentity,
  PublicIdentity,
  restoreFromBackup,
  signMessage,
} from './identity';

/**
 * The replacement for wagmi's `useAccount` / `useSignMessage`.
 *
 * Two pieces of state that wagmi conflated into one, kept separate here
 * because under §4 they genuinely are separate:
 *
 *   identity — a keypair exists on this device (analogous to "a wallet is
 *              connected"), and its DID may or may not be registered yet.
 *   session  — the backend has verified a signed challenge against the public
 *              key the LEDGER holds for that DID, and issued a session cookie.
 *
 * A device can hold an identity with no session (needs login) or, after
 * guardian recovery re-binds the DID to someone else's key, an identity that
 * can no longer obtain a session at all. Modelling them separately makes both
 * states expressible instead of silently broken.
 */

interface IdentityState {
  identity: PublicIdentity | null;
  registered: boolean;
  session: boolean;
  loading: boolean;
  error: string | null;
  /** Item 3: true immediately after a login that came from a fingerprint this DID has never used before. */
  newDevice: boolean;
  dismissNewDevice: () => void;
  create: () => Promise<void>;
  createWithBackup: (passphrase: string) => Promise<string>;
  restore: (backupJson: string, passphrase: string) => Promise<void>;
  register: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  forget: () => Promise<void>;
}

const IdentityContext = createContext<IdentityState | null>(null);

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  const [registered, setRegistered] = useState(false);
  const [session, setSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDevice, setNewDevice] = useState(false);

  const refresh = useCallback(async () => {
    const stored = await getPublicIdentity();
    setIdentity(stored);
    if (!stored) {
      setRegistered(false);
      setSession(false);
      return;
    }
    // Is this DID already anchored on the ledger? The public verifier route
    // answers without needing a session.
    try {
      await api.verifyStatus(stored.did);
      setRegistered(true);
    } catch {
      setRegistered(false);
    }
    // Do we still hold a valid session cookie?
    try {
      await api.me();
      setSession(true);
    } catch {
      setSession(false);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const wrap = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      setLoading(true);
      try {
        await fn();
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Anchors the DID on the ledger.
   *
   * `signature` is a proof of possession over the DID string. It is what
   * replaces EVM's `msg.sender` binding: the backend submits this transaction
   * on the citizen's behalf, so without it the backend could register a DID
   * against a key it controls. The chaincode verifies it before writing.
   */
  const register = useCallback(async () => {
    await wrap(async () => {
      const stored = await getPublicIdentity();
      if (!stored) throw new Error('Create an identity first.');
      const signature = await signMessage(stored.did);
      await api.registerDid(stored.publicKeyB64, signature);
      setRegistered(true);
    });
  }, [wrap]);

  /** Signed-challenge login. Same pattern as before; different verification target. */
  const login = useCallback(async () => {
    await wrap(async () => {
      const stored = await getPublicIdentity();
      if (!stored) throw new Error('Create an identity first.');
      const { nonce } = await api.authChallenge(stored.did);
      const signature = await signMessage(`TrustMesh DID challenge: ${nonce}`);
      const result = await api.authVerify(stored.did, signature, nonce, getOrCreateDeviceId());
      setSession(true);
      setNewDevice(result.newDevice);
    });
  }, [wrap]);

  const dismissNewDevice = useCallback(() => setNewDevice(false), []);

  const create = useCallback(async () => {
    await wrap(async () => {
      setIdentity(await createIdentity());
      setRegistered(false);
      setSession(false);
    });
  }, [wrap]);

  const createWithBackup = useCallback(
    async (passphrase: string) => {
      let backup = '';
      await wrap(async () => {
        const result = await createIdentityWithBackup(passphrase);
        setIdentity(result.identity);
        setRegistered(false);
        setSession(false);
        backup = result.backup;
      });
      return backup;
    },
    [wrap]
  );

  const restore = useCallback(
    async (backupJson: string, passphrase: string) => {
      await wrap(async () => {
        setIdentity(await restoreFromBackup(backupJson, passphrase));
        await refresh();
      });
    },
    [wrap, refresh]
  );

  const logout = useCallback(async () => {
    await wrap(async () => {
      await api.logout().catch(() => undefined);
      setSession(false);
    });
  }, [wrap]);

  const forget = useCallback(async () => {
    await wrap(async () => {
      await forgetIdentity();
      setIdentity(null);
      setRegistered(false);
      setSession(false);
    });
  }, [wrap]);

  const value = useMemo<IdentityState>(
    () => ({
      identity,
      registered,
      session,
      loading,
      error,
      newDevice,
      dismissNewDevice,
      create,
      createWithBackup,
      restore,
      register,
      login,
      logout,
      forget,
    }),
    [
      identity,
      registered,
      session,
      loading,
      error,
      newDevice,
      dismissNewDevice,
      create,
      createWithBackup,
      restore,
      register,
      login,
      logout,
      forget,
    ]
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityState {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside <IdentityProvider>.');
  return ctx;
}
