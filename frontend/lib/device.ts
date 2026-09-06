/**
 * Item 3 (session/device-change alert) — client half.
 *
 * A stable, per-browser random id, generated once and kept in localStorage.
 * Deliberately NOT a real device-fingerprinting library: it identifies "this
 * browser storage", nothing about the underlying hardware, and carries no
 * PII. Combined server-side with the User-Agent header into one fingerprint
 * (backend/src/routes/fabric/auth.routes.ts), it lets the backend tell
 * "this DID has signed in from this browser before" apart from "it hasn't" —
 * without needing anything invasive.
 *
 * Clearing this value (as the live-verification steps for this feature do)
 * is indistinguishable, from the backend's point of view, from actually
 * switching to a new device/browser — which is the point: it is the only
 * thing that makes the fingerprint change.
 */

const STORAGE_KEY = 'trustmesh_device_id';

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    let id = window.localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Storage disabled/unavailable (private mode, etc.) — every login will
    // read as "new device" server-side, which fails safe rather than crashing.
    return '';
  }
}
