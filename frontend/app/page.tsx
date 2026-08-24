import Link from "next/link";
import { TextType } from "@/components/effects/TextType";
import { DecryptedText } from "@/components/effects/DecryptedText";
import { SpotlightCard } from "@/components/effects/SpotlightCard";
import { FadeIn } from "@/components/effects/FadeIn";

const PILLARS = [
  {
    eyebrow: "IDENTITY",
    title: "DID + Verifiable Credentials",
    body: "Identity is a self-sovereign W3C DID, never a raw NFT or wallet address — the private key never leaves the user's device.",
  },
  {
    eyebrow: "ACCESS CONTROL",
    title: "Lifecycle RBAC",
    body: "Admin / Manager / Auditor / User roles are on-chain role hashes with expiry and revocation — not a permanent, un-erasable grant.",
  },
  {
    eyebrow: "GOVERNANCE",
    title: "Multi-Sig Only",
    body: "Every mint, transfer, and role change is proposed to a Gnosis Safe. No single admin key can act alone.",
  },
  {
    eyebrow: "PRIVACY",
    title: "DPDP by Design",
    body: "PII lives off-chain, encrypted. Erasure destroys the key — the chain stays immutable, the personal data doesn't.",
  },
  {
    eyebrow: "ASSETS",
    title: "Governed NFTs",
    body: "ERC-721 tokens represent real assets only — certificates, equipment, licenses — metadata on IPFS, hash on-chain.",
  },
  {
    eyebrow: "RESILIENCE",
    title: "Guardian Recovery",
    body: "An M-of-N guardian vote re-binds a lost key to a DID. No admin reset, no single point of failure.",
  },
];

const NAV_CARDS = [
  { href: "/onboard", title: "Onboard", desc: "Create your DID and import a verified document." },
  { href: "/portal", title: "User Portal", desc: "View your credentials, roles, and assets." },
  { href: "/admin/roles", title: "Admin · Roles", desc: "Grant or revoke RBAC roles via multi-sig." },
  { href: "/admin/assets", title: "Admin · Assets", desc: "Mint or transfer asset NFTs via multi-sig." },
  { href: "/verify", title: "Verifier Portal", desc: "Check role / ownership / credential status — no raw PII." },
  { href: "/audit", title: "Audit Trail", desc: "Live, PII-free, tamper-evident event feed." },
];

export default function Home() {
  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-glow-gold bg-ink-900 px-6 py-20 text-center sm:px-12 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-glow-gold-soft" />
        <div className="relative">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Team Aegis &middot; SIH PS 26125
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
            <TextType text="Identity and assets," />
            <br />
            <span className="text-gold">
              <TextType text="verified without exposure." startDelayMs={1400} />
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-sm text-mist sm:text-base">
            A reusable, privacy-preserving, DPDP-compliant identity, role-based access control, and NFT
            digital-asset custody platform. The chain stores proofs — never people.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/onboard" className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90">
              Get Started
            </Link>
            <Link
              href="/audit"
              className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white hover:border-gold hover:text-gold"
            >
              View Live Audit Trail
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-24">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-mist">Core Design</p>
        <DecryptedText
          as="h2"
          text="Built for trust without a blast radius"
          className="mt-3 block text-center text-2xl font-bold sm:text-3xl"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <FadeIn key={p.title} delayMs={i * 80}>
              <SpotlightCard className="h-full p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold/80">{p.eyebrow}</p>
                <h3 className="mt-2 font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{p.body}</p>
              </SpotlightCard>
            </FadeIn>
          ))}
        </div>
      </section>

      <section className="mt-24">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-mist">Explore the Platform</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NAV_CARDS.map((c, i) => (
            <FadeIn key={c.href} delayMs={i * 60}>
              <Link href={c.href} className="block h-full">
                <SpotlightCard className="h-full p-5 hover:bg-ink-700">
                  <h3 className="font-semibold text-white">{c.title}</h3>
                  <p className="mt-1 text-sm text-mist">{c.desc}</p>
                </SpotlightCard>
              </Link>
            </FadeIn>
          ))}
        </div>
      </section>

      <footer className="mt-24 border-t border-white/10 pt-8 text-center text-xs text-mist">
        Polygon Amoy Testnet &middot; Prototype (TRL 3&ndash;4) &middot; Built for Smart India Hackathon 2026
      </footer>
    </div>
  );
}
