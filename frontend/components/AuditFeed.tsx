"use client";

import { useEffect, useState } from "react";
import { api, AuditEvent } from "@/lib/api";

const TYPE_LABELS: Record<AuditEvent["type"], string> = {
  DID_REGISTERED: "DID Registered",
  ROLE_GRANTED: "Role Granted",
  ROLE_REVOKED: "Role Revoked",
  ASSET_MINTED: "Asset Minted",
  ASSET_TRANSFERRED: "Asset Transferred",
  CREDENTIAL_REVOKED: "Credential Revoked",
};

export function AuditFeed() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .auditFeed()
      .then((res) => !cancelled && setEvents(res.events))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-mist">Loading audit feed…</p>;
  if (error) return <p className="text-sm text-red-400">Could not load audit feed: {error}</p>;
  if (events.length === 0) return <p className="text-sm text-mist">No events yet.</p>;

  return (
    <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-ink-800">
      {events.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <div>
            <p className="font-semibold text-white">{TYPE_LABELS[e.type]}</p>
            <p className="text-xs text-mist">
              {e.actor} → {e.target}
            </p>
          </div>
          <div className="text-right text-xs text-mist">
            <p>{new Date(e.timestamp).toLocaleString()}</p>
            <a
              className="text-gold underline"
              href={`https://amoy.polygonscan.com/tx/${e.txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              view tx
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
