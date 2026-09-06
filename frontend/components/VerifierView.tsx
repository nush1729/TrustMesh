'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

type VerifyResult = Awaited<ReturnType<typeof api.verifyStatus>>;

/**
 * Item 2 (QR-code verifier flow).
 *
 * Shared by /verify (manual entry + scan) and /verify/[did] (landed on
 * directly from a decoded QR / shared link). A QR code generated on the
 * portal encodes `${origin}/verify/<did>` (see components/DidQrCode.tsx) —
 * scanning it with any phone camera, not just this app's own scanner, opens
 * this exact page. The in-app scanner below is a convenience for a verifier
 * who doesn't want to leave the app.
 *
 * SCANNING: no external API/service. `jsqr` decodes frames from a
 * `getUserMedia` camera stream entirely client-side. Camera access is often
 * impractical in headless/CI environments, so an "upload a QR image" fallback
 * (also decoded locally with jsqr, via an offscreen canvas) covers the same
 * path without needing a live camera — and is what a verifier without camera
 * permission would use anyway.
 */
export function VerifierView({ initialDid }: { initialDid?: string }) {
  const router = useRouter();
  const [did, setDid] = useState(initialDid ?? '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  async function handleVerify(target?: string) {
    const value = (target ?? did).trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.verifyStatus(value));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-verify when landed on directly via /verify/<did> (from a scanned QR
  // or a shared link) rather than making the verifier retype it.
  useEffect(() => {
    if (initialDid) handleVerify(initialDid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDid]);

  function stopScan() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function onDecoded(text: string) {
    stopScan();
    // A scanned QR may be a bare DID, or the full verifier URL it encodes —
    // accept either.
    const match = text.match(/\/verify\/([^/?#]+)/);
    const decodedDid = decodeURIComponent(match ? match[1] : text);
    setDid(decodedDid);
    router.push(`/verify/${encodeURIComponent(decodedDid)}`);
  }

  async function startCameraScan() {
    setScanError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const tick = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code) {
              onDecoded(code.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setScanError('Camera unavailable: ' + (e as Error).message + ' — use "Upload QR image" instead.');
      setScanning(false);
    }
  }

  async function handleFileUpload(file: File) {
    setScanError(null);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) {
      setScanError('Could not read that file as an image.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (!code) {
      setScanError('No QR code found in that image.');
      return;
    }
    onDecoded(code.data);
  }

  useEffect(() => () => stopScan(), []);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Verifier Portal</h1>
      <p className="text-sm text-mist">
        Checks role and asset ownership directly against ledger state. This endpoint never returns raw personal data
        from the encrypted vault — only status and identifiers.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-white/15 bg-ink-800 p-2 font-mono text-xs text-white placeholder:text-mist/50 focus:border-gold focus:outline-none"
          placeholder="did:key:z… or a 64-character DID hash"
          value={did}
          onChange={(e) => setDid(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
        />
        <button
          className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          onClick={() => handleVerify()}
        >
          Verify
        </button>
      </div>

      <div className="space-y-2 rounded-xl border border-dashed border-white/15 bg-ink-800 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-mist">Or scan a QR code</p>
        <div className="flex flex-wrap items-center gap-2">
          {!scanning ? (
            <button
              onClick={startCameraScan}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-mist hover:border-gold hover:text-gold"
            >
              Scan with camera
            </button>
          ) : (
            <button
              onClick={stopScan}
              className="rounded-full border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:border-red-300"
            >
              Stop scanning
            </button>
          )}
          <label className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-xs text-mist hover:border-gold hover:text-gold">
            Upload QR image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        {scanning && (
          <video ref={videoRef} muted playsInline className="mt-2 w-full max-w-xs rounded-lg border border-white/10" />
        )}
        <canvas ref={canvasRef} className="hidden" />
        {scanError && <p className="text-xs text-red-400">{scanError}</p>}
      </div>

      {loading && <p className="text-sm text-mist">Checking…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-ink-800 p-5 text-sm">
          <p>
            <span className="font-semibold text-white">DID hash:</span>{' '}
            <span className="break-all font-mono text-xs text-gold-soft">{result.didHash}</span>
          </p>
          <p>
            <span className="font-semibold text-white">Active roles:</span>{' '}
            <span className="text-mist">{result.roles.length ? result.roles.join(', ') : 'none'}</span>
          </p>
          <div>
            <span className="font-semibold text-white">Assets owned:</span>{' '}
            {result.assets.length === 0 ? (
              <span className="text-mist">none</span>
            ) : (
              <ul className="mt-2 space-y-1">
                {result.assets.map((a) => (
                  <li key={a.assetId} className="rounded bg-ink-700 p-2 text-xs">
                    <span className="text-white">Asset #{a.assetId}</span>
                    <span className="ml-2 break-all font-mono text-gold-soft">{a.ipfsCID}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
