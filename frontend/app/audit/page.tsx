import { AuditFeed } from "@/components/AuditFeed";

export default function AuditPage() {
  return (
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
  );
}
