"use client";

import { useState } from "react";
import { RequireWallet } from "@/components/WalletConnect";
import { MultiSigApprovalModal, SafeTxStatus } from "@/components/MultiSigApprovalModal";
import { api } from "@/lib/api";

const ROLES = ["Admin", "Manager", "Auditor", "User"];

export default function AdminRolesPage() {
  return (
    <RequireWallet>
      <RoleAdminFlow />
    </RequireWallet>
  );
}

function RoleAdminFlow() {
  const [role, setRole] = useState(ROLES[1]);
  const [account, setAccount] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [modalOpen, setModalOpen] = useState(false);
  const [safeTxHash, setSafeTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<SafeTxStatus>("pending");

  async function handleGrant() {
    if (!account) return;
    setModalOpen(true);
    setStatus("pending");
    const expiry = Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60;
    const { safeTxHash: hash } = await api.grantRole(role, account, expiry);
    setSafeTxHash(hash);
    setStatus("awaiting-cosigner");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin · Roles</h1>
      <p className="text-sm text-mist">
        Every grant/revoke below is proposed to the Gnosis Safe (multi-sig) — it never executes on a single admin
        key.
      </p>

      <div className="space-y-4 rounded-xl border border-white/10 bg-ink-800 p-5">
        <label className="block text-sm text-mist">
          Role
          <select
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-white focus:border-gold focus:outline-none"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-mist">
          Wallet Address
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
            placeholder="0x..."
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>

        <label className="block text-sm text-mist">
          Expiry (days)
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded-lg border border-white/15 bg-ink-700 p-2 text-white focus:border-gold focus:outline-none"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
          />
        </label>

        <button
          className="w-full rounded-full bg-gold py-2 text-sm font-semibold text-black hover:opacity-90"
          onClick={handleGrant}
        >
          Propose Role Grant
        </button>
      </div>

      <MultiSigApprovalModal
        open={modalOpen}
        safeTxHash={safeTxHash}
        status={status}
        requiredSignatures={2}
        collectedSignatures={status === "executed" ? 2 : 1}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
