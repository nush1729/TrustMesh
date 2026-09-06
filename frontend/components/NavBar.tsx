'use client';

import Link from 'next/link';
import { IdentityButton } from '@/components/IdentityGate';

const links = [
  { href: '/onboard', label: 'Onboard' },
  { href: '/portal', label: 'Portal' },
  { href: '/recovery', label: 'Recovery' },
  { href: '/admin/roles', label: 'Admin · Roles' },
  { href: '/admin/assets', label: 'Admin · Assets' },
  { href: '/admin/governance', label: 'Admin · Approvals' },
  { href: '/verify', label: 'Verify' },
  { href: '/audit', label: 'Audit' },
];

export function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-wide text-white">
          Trust<span className="text-gold">Mesh</span>
        </Link>
        <nav className="hidden gap-4 text-sm lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-mist transition hover:text-gold">
              {l.label}
            </Link>
          ))}
        </nav>
        {/* Replaces RainbowKit's <ConnectButton /> — there is no wallet to connect. */}
        <IdentityButton />
      </div>
    </header>
  );
}
