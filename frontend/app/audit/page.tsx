import { AuditFeed } from "@/components/AuditFeed";
import { RequireIdentity } from "@/components/IdentityGate";

/**
 * Overnight-pass fix (item 3): unlike every other protected page (portal,
 * admin/roles, admin/assets, admin/governance), this page rendered AuditFeed
 * directly with no identity gate. A signed-out visitor — no local identity,
 * an unregistered DID, or a registered DID with no active session — hit
 * GET /audit/feed straight away, got a 401, and AuditFeed's generic error
 * branch surfaced the raw backend string ("No session. Complete the
 * signed-DID challenge first.") as a red error line instead of a prompt to
 * actually do that. RequireIdentity is the existing, already-tested
 * component every other gated page uses for exactly this: it shows the
 * right one of "create an identity" / "register your DID" / "sign in"
 * depending on which step the visitor is missing, then renders children only
 * once a real session exists. The Admin/Auditor role check itself still
 * happens where it belongs, server-side — AuditFeed's existing 403 handling
 * (forbidden state) is unchanged and still covers a signed-in plain User.
 */
export default function AuditPage() {
  return (
    <RequireIdentity>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Trail</h1>
          <p className="mt-1 text-sm text-mist">
            Every identity, role, and asset event, indexed directly from on-chain events. PII-free by construction —
            the chain never stores it in the first place.
          </p>
        </div>
        <AuditFeed />
      </div>
    </RequireIdentity>
  );
}
