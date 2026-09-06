'use client';

import { useEffect, useState } from 'react';
import { RequireIdentity } from '@/components/IdentityGate';
import { RoleBadge } from '@/components/RoleBadge';
import { AssetCard } from '@/components/AssetCard';
import { api, AssetRecord } from '@/lib/api';
import { useIdentity } from '@/lib/identity-context';

export default function PortalPage() {
  return (
    <RequireIdentity>
      <PortalView />
    </RequireIdentity>
  );
}

function PortalView() {
  const { identity } = useIdentity();
  const [roles, setRoles] = useState<string[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    (async () => {
      const status = await api.verifyStatus(identity.did);
      if (cancelled) return;
      setRoles(status.roles);
      // The EVM version left this empty with a comment that a real backend
      // would need a dedicated route, because AssetNFT.sol was not
      // enumerable. With CouchDB rich queries the ledger answers "all assets
      // owned by X" directly, so the portal can actually show them.
      const owned = await api.assetsFor(status.didHash);
      if (!cancelled) setAssets(owned.assets);
    })()
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [identity]);

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
        {loading ? (
          <p className="text-sm text-mist">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-mist">No assets yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {assets.map((a) => (
              <AssetCard key={a.assetId} asset={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
