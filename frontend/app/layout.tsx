import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "@/components/NavBar";
import { NewDeviceBanner } from "@/components/NewDeviceBanner";

export const metadata: Metadata = {
  title: "TrustMesh",
  description: "Privacy-preserving, DPDP-compliant identity, RBAC & digital-asset custody platform — Team Aegis, SIH PS 26125",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-ink-950">
      <body className="min-h-screen bg-ink-950 text-white">
        <Providers>
          <NavBar />
          <NewDeviceBanner />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
