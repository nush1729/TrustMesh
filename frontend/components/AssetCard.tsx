import { AssetRecord } from '@/lib/api';

/**
 * `tokenId` became `assetId`: the ledger assigns a monotonic string id rather
 * than an ERC-721 token id, and `owner` is a DID hash rather than an 0x address.
 */
export function AssetCard({ asset }: { asset: AssetRecord }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Asset #{asset.assetId}</h3>
        <span className="rounded bg-ink-700 px-2 py-0.5 text-xs text-mist">TrustMesh Asset</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Owner (DID hash)" value={asset.owner} />
        <Row label="IPFS CID" value={asset.ipfsCID} />
        <Row label="Content Hash" value={asset.contentHash} />
        <Row label="Minted" value={new Date(asset.mintedAt).toLocaleString()} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-mist">{label}</dt>
      <dd className="truncate text-right font-mono text-xs text-gold-soft" title={value}>
        {value}
      </dd>
    </div>
  );
}
