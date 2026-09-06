'use client';

import { useParams } from 'next/navigation';
import { VerifierView } from '@/components/VerifierView';

/**
 * Item 2 (QR-code verifier flow): the landing target a scanned QR points at.
 * `[did]` is URL-encoded by whoever generated the QR (components/DidQrCode.tsx
 * on the portal) and decoded here before being handed to the verify API.
 */
export default function VerifyDidPage() {
  const params = useParams<{ did: string }>();
  const did = decodeURIComponent(params.did);
  return <VerifierView initialDid={did} />;
}
