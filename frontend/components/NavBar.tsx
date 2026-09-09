'use client';

import Link from 'next/link';
import { IdentityButton } from '@/components/IdentityGate';
import { NotificationBell } from '@/components/NotificationBell';
import { useIdentity } from '@/lib/identity-context';

// Citizen-facing links: relevant to every visitor, in the order a brand-new
// user would actually use them (Onboard first, then Portal). Shown to
// everyone regardless of role.
const citizenLinks = [
  { href: '/onboard', label: 'Onboard' },
  { href: '/portal', label: 'Portal' },
  { href: '/recovery', label: 'Recovery' },
  { href: '/verify', label: 'Verify' },
  { href: '/transparency', label: 'Transparency' },
];

// Admin-only links: the backend already 403s these for non-Admins
// (requireRole('Admin')), so this is a UX fix, not a security boundary —
// hide what a plain User can't act on rather than let them click into a
// dead end.
const adminLinks = [
  { href: '/admin/roles', label: 'Roles' },
  { href: '/admin/assets', label: 'Assets' },
  { href: '/admin/governance', label: 'Approvals' },
];

export function NavBar() {
  const { isAdmin, isAuditor, loading } = useIdentity();
  // Before the role check resolves (first paint, or no identity yet), show
  // nothing role-gated rather than flashing Admin links a plain User would
  // then see disappear.
  const showAdmin = !loading && isAdmin;
  const showAudit = !loading && (isAdmin || isAuditor);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-wide text-white">
          Trust<span className="text-gold">Mesh</span>
        </Link>
        <nav className="hidden items-center gap-4 text-sm lg:flex">
          {citizenLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-mist transition hover:text-gold">
              {l.label}
            </Link>
          ))}
          {/* Audit requires an active Admin or Auditor role server-side (see
              backend/src/routes/fabric/misc.routes.ts) — kept separate from
              the Admin group below since Auditors, who aren't Admins, can
              also reach it. */}
          {showAudit && (
            <Link href="/audit" className="text-mist transition hover:text-gold">
              Audit
            </Link>
          )}
          {showAdmin && (
            <div className="flex items-center gap-4 border-l border-white/10 pl-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-mist/60">Admin</span>
              {adminLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-mist transition hover:text-gold">
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <NotificationBell />
          {/* Replaces RainbowKit's <ConnectButton /> — there is no wallet to connect. */}
          <IdentityButton />
        </div>
      </div>
    </header>
  );
}
