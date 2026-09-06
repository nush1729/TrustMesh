'use client';

import { useIdentity } from '@/lib/identity-context';

/**
 * Item 3 (session/device-change alert) UI. `newDevice` is set for exactly one
 * login response — the one where the backend saw a fingerprint (User-Agent +
 * this browser's localStorage device id, see lib/device.ts) it had never
 * recorded for this DID before. The login itself is never blocked; this is
 * purely a "you should know about this" banner, dismissible and not shown
 * again until the next such login.
 */
export function NewDeviceBanner() {
  const { newDevice, dismissNewDevice } = useIdentity();
  if (!newDevice) return null;

  return (
    <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-sm text-amber-200">
      <span className="font-semibold">New device detected.</span> This sign-in came from a browser we haven&apos;t
      seen before for your identity. If this wasn&apos;t you, guardian recovery is the way to move to a new key.
      <button onClick={dismissNewDevice} className="ml-3 underline hover:text-amber-100">
        Dismiss
      </button>
    </div>
  );
}
