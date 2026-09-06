const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

/**
 * Backend API client, updated for the Fabric stack.
 *
 * The frontend now talks ONLY to the backend — never to the ledger directly.
 * Under §4 the Fabric Gateway connection and MSP identities live entirely in
 * backend services, so there is no browser-side chain client, no ABIs and no
 * RPC endpoint. lib/contracts.ts (1,600 lines of Hardhat-extracted ABIs) and
 * lib/wagmi.ts are deleted accordingly.
 *
 * API CONTRACT CHANGES from the EVM client, all inherited from the backend:
 *   authChallenge/authVerify  take a did:key, not an 0x address
 *   registerDid               new: submits the DID anchor with proof of possession
 *   grantRole/revokeRole      take `subject` (DID hash); return { proposalId }
 *   mintAsset                 takes a DID hash; returns { proposalId }
 *   approve/execute           new: governance surface that used to live in the
 *                             Safe web UI
 */

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type RoleName = 'Admin' | 'Manager' | 'Auditor' | 'User';

export type Approval = { mspId: string; signer: string; approvedAt: string };

export type Proposal = {
  proposalId: string;
  actionType: string;
  params: Record<string, string>;
  proposedBy: string;
  proposedByMsp: string;
  proposedAt: string;
  threshold: number;
  approvals: Approval[];
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
};

export type AssetRecord = {
  assetId: string;
  owner: string;
  ipfsCID: string;
  contentHash: string;
  mintedAt: string;
};

export type AuditEvent = {
  id: string;
  type:
    | 'DID_REGISTERED'
    | 'CONTROLLER_UPDATED'
    | 'ROLE_GRANTED'
    | 'ROLE_REVOKED'
    | 'ASSET_MINTED'
    | 'ASSET_TRANSFERRED'
    | 'CREDENTIAL_REVOKED'
    | 'PROPOSAL_CREATED'
    | 'PROPOSAL_APPROVED';
  actor: string;
  target: string;
  timestamp: string;
  txHash: string;
  blockNumber: string;
  governance?: { proposalId?: string; proposedBy?: string; approvals?: Approval[] };
};

export const api = {
  // --- identity and session ---------------------------------------------------
  registerDid: (publicKey: string, signature: string) =>
    request<{ did: string; didHash: string; onChainConfirmed: boolean }>('/identity/did', {
      method: 'POST',
      body: JSON.stringify({ publicKey, signature }),
    }),

  authChallenge: (did: string) =>
    request<{ nonce: string }>('/auth/challenge', { method: 'POST', body: JSON.stringify({ did }) }),

  authVerify: (did: string, signature: string, nonce: string) =>
    request<{ sessionToken: string; did: string; didHash: string }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ did, signature, nonce }),
    }),

  me: () => request<{ didHash: string; did: string | null }>('/identity/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  digilockerImport: (documentType: string) =>
    request<{ credentialJwt: string; issuerDid: string }>('/identity/digilocker-import', {
      method: 'POST',
      body: JSON.stringify({ documentType }),
    }),

  // --- roles -------------------------------------------------------------------
  grantRole: (role: RoleName, subject: string, expiry: number, orgLabel?: string) =>
    request<{ proposalId: string; status: string; approvals: Approval[] }>('/roles/grant', {
      method: 'POST',
      body: JSON.stringify({ role, subject, expiry, orgLabel }),
    }),

  revokeRole: (role: RoleName, subject: string) =>
    request<{ proposalId: string; status: string; approvals: Approval[] }>('/roles/revoke', {
      method: 'POST',
      body: JSON.stringify({ role, subject }),
    }),

  rolesFor: (didHash: string) =>
    request<{ roles: Array<{ roleId: string; subject: string; expiry: string; granted: boolean }> }>(
      `/roles/subject/${didHash}`
    ),

  // --- assets -------------------------------------------------------------------
  mintAsset: (to: string, file: File) => {
    const formData = new FormData();
    formData.append('to', to);
    formData.append('file', file);
    return fetch(`${BACKEND_URL}/assets/mint`, { method: 'POST', body: formData, credentials: 'include' }).then(
      async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
        return r.json();
      }
    ) as Promise<{ proposalId: string; ipfsCID: string; contentHash: string }>;
  },

  transferAsset: (from: string, to: string, assetId: string) =>
    request<{ proposalId: string; status: string }>('/assets/transfer', {
      method: 'POST',
      body: JSON.stringify({ from, to, assetId }),
    }),

  assetsFor: (didHash: string) => request<{ assets: AssetRecord[] }>(`/assets/owner/${didHash}`),

  assetHistory: (assetId: string) =>
    request<{ history: Array<{ txId: string; timestamp: string; value: AssetRecord | null }> }>(
      `/assets/${assetId}/history`
    ),

  // --- governance (replaces the Safe web UI) --------------------------------------
  pendingProposals: () => request<{ proposals: Proposal[] }>('/governance/pending'),

  governanceSigners: () =>
    request<{ threshold: number; organizations: Array<{ org: string; mspId: string; role: string }> }>(
      '/governance/signers'
    ),

  proposal: (proposalId: string) => request<Proposal>(`/governance/${proposalId}`),

  approveProposal: (proposalId: string, org: string) =>
    request<Proposal>('/governance/approve', { method: 'POST', body: JSON.stringify({ proposalId, org }) }),

  executeProposal: (proposalId: string) =>
    request<Proposal>('/governance/execute', { method: 'POST', body: JSON.stringify({ proposalId }) }),

  // --- verification and audit -------------------------------------------------------
  verifyStatus: (did: string) =>
    request<{
      did: string;
      didHash: string;
      roles: string[];
      assets: Array<{ assetId: string; ipfsCID: string; contentHash: string }>;
      credentialsValid: boolean;
    }>(`/verify/${encodeURIComponent(did)}`),

  auditFeed: () => request<{ events: AuditEvent[] }>('/audit/feed'),

  // P0.3: /vault/erase is a governed 2-approval request — the first Admin call
  // creates a pending request, a second, distinct Admin session executes it.
  eraseVault: (didHash: string, reason?: string) =>
    request<{
      erased: boolean;
      id: string;
      status: 'pending' | 'executed';
      approvals: number;
      threshold: number;
      erasedRows?: number;
    }>('/vault/erase', { method: 'POST', body: JSON.stringify({ didHash, reason }) }),
};
