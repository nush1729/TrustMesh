'use client';

import { useEffect, useState } from 'react';
import { api, NotificationRecord } from '@/lib/api';
import { useIdentity } from '@/lib/identity-context';

/**
 * Item 1 (guardian notifications) + item 3 (new-device alerts) UI.
 *
 * Polls `GET /notifications` — session-scoped, so this only ever shows the
 * signed-in user's OWN notifications — every 10s while a session exists.
 * Delivery of the underlying notification is mocked (see
 * backend/src/fabric/notifications.service.ts); this bell is how a real user
 * in a live demo actually sees "a recovery was proposed for your identity"
 * appear, without needing a real email/SMS provider wired up.
 */
export function NotificationBell() {
  const { session } = useIdentity();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session) {
      setNotifications([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const { notifications: n } = await api.notifications();
        if (!cancelled) setNotifications(n);
      } catch {
        /* not signed in / transient error — leave the last known list */
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session]);

  if (!session) return null;

  const unread = notifications.filter((n) => !n.read_at).length;

  async function handleOpen() {
    setOpen((v) => !v);
    if (unread > 0) {
      await api.markNotificationsRead().catch(() => undefined);
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative rounded-full border border-white/15 px-2.5 py-1.5 text-mist transition hover:border-gold hover:text-gold"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-ink-800 p-3 text-left shadow-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mist">
            Notifications <span className="normal-case text-mist/60">(mocked delivery — demo channel)</span>
          </p>
          {notifications.length === 0 ? (
            <p className="text-xs text-mist">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li key={n.id} className="rounded-lg border border-white/10 bg-ink-700 p-2">
                  <p className="text-xs font-semibold text-white">{n.subject}</p>
                  <p className="mt-1 text-[11px] leading-snug text-mist">{n.body}</p>
                  <p className="mt-1 text-[10px] text-mist/50">{new Date(n.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
