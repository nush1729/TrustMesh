const ROLE_STYLES: Record<string, string> = {
  Admin: "bg-gold text-black",
  Manager: "bg-white/15 text-white",
  Auditor: "border border-gold/50 text-gold",
  User: "bg-ink-700 text-mist",
};

export function RoleBadge({ role, expiresAt }: { role: string; expiresAt?: string }) {
  const style = ROLE_STYLES[role] ?? "bg-ink-700 text-mist";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      {role}
      {expiresAt && <span className="opacity-70">· expires {expiresAt}</span>}
    </span>
  );
}
