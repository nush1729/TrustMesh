"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { RequireWallet } from "@/components/WalletConnect";
import { RoleBadge } from "@/components/RoleBadge";
import { AssetCard, Asset } from "@/components/AssetCard";
import { api } from "@/lib/api";

export default function PortalPage() {
  return (
    <RequireWallet>
      <PortalView />
    </RequireWallet>
  );
}

function PortalView() {
  const { address } = useAccount();
  const [roles, setRoles] = useState<string[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    api
      .verifyStatus(address)
      .then((res) => setRoles(res.roles))
      .finally(() => setLoading(false));
    // Asset fetching would hit a dedicated /portal/assets route in the full
    // backend; left as an empty array here since this is a starter scaffold.
    setAssets([]);
  }, [address]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Your Portal</h1>

      <section>
        <h2 className="mb-3 font-semibold text-white">Roles</h2>
        {loading ? (
          <p className="text-sm text-mist">Loading…</p>
        ) : roles.length === 0 ? (
          <p className="text-sm text-mist">No active roles.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <RoleBadge key={r} role={r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-white">Assets Held</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-mist">No assets yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {assets.map((a) => (
              <AssetCard key={a.tokenId} asset={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
