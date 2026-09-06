'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Item 2 (QR-code verifier flow), portal half.
 *
 * Generates entirely client-side via the `qrcode` npm package — no external
 * QR-generation service, no API key. Encodes a full verifier URL
 * (`${origin}/verify/<did>`) rather than the bare DID, so scanning it with
 * ANY phone camera app (not just this frontend's own scanner) opens straight
 * to this DID's verify result.
 */
export function DidQrCode({ did }: { did: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/verify/${encodeURIComponent(did)}`;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b0d12', light: '#f5c518' } })
      .then((u) => !cancelled && setDataUrl(u))
      .catch(() => !cancelled && setDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [did]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-ink-800 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-mist">Show this to a verifier</p>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR code encoding your DID verify link" width={220} height={220} className="rounded-lg" />
      ) : (
        <div className="flex h-[220px] w-[220px] items-center justify-center text-xs text-mist">Generating…</div>
      )}
      <p className="max-w-xs text-center text-[11px] text-mist">
        Scanning this opens your public verify page — active roles and asset ownership only, never PII from the
        vault.
      </p>
    </div>
  );
}
