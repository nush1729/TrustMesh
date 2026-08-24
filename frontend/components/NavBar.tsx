"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  { href: "/onboard", label: "Onboard" },
  { href: "/portal", label: "Portal" },
  { href: "/admin/roles", label: "Admin · Roles" },
  { href: "/admin/assets", label: "Admin · Assets" },
  { href: "/verify", label: "Verify" },
  { href: "/audit", label: "Audit" },
];

export function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-wide text-white">
          Trust<span className="text-gold">Mesh</span>
        </Link>
        <nav className="hidden gap-5 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-mist transition hover:text-gold">
              {l.label}
            </Link>
          ))}
        </nav>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
