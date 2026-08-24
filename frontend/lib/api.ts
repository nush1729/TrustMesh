const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  authChallenge: (address: string) =>
    request<{ nonce: string }>("/auth/challenge", { method: "POST", body: JSON.stringify({ address }) }),

  authVerify: (address: string, signature: string, nonce: string) =>
    request<{ sessionToken: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address, signature, nonce }),
    }),

  createDID: (address: string) => request<{ did: string; didHash: string }>("/identity/did", {
    method: "POST",
    body: JSON.stringify({ address }),
  }),

  digilockerImport: (didHash: string, documentType: string) =>
    request<{ credentialId: string }>("/identity/digilocker-import", {
      method: "POST",
      body: JSON.stringify({ didHash, documentType }),
    }),

  grantRole: (role: string, account: string, expiry: number) =>
    request<{ safeTxHash: string }>("/roles/grant", {
      method: "POST",
      body: JSON.stringify({ role, account, expiry }),
    }),

  revokeRole: (role: string, account: string) =>
    request<{ safeTxHash: string }>("/roles/revoke", {
      method: "POST",
      body: JSON.stringify({ role, account }),
    }),

  mintAsset: (to: string, file: File, description: string) => {
    const formData = new FormData();
    formData.append("to", to);
    formData.append("file", file);
    formData.append("description", description);
    return fetch(`${BACKEND_URL}/assets/mint`, { method: "POST", body: formData, credentials: "include" }).then(
      (r) => r.json()
    ) as Promise<{ safeTxHash: string; tokenId: string }>;
  },

  verifyStatus: (did: string) =>
    request<{ roles: string[]; assets: string[]; credentialsValid: boolean }>(`/verify/${encodeURIComponent(did)}`),

  eraseVault: (did: string) => request<{ erased: boolean }>("/vault/erase", { method: "POST", body: JSON.stringify({ did }) }),

  auditFeed: () => request<{ events: AuditEvent[] }>("/audit/feed"),
};

export type AuditEvent = {
  id: string;
  type: "DID_REGISTERED" | "ROLE_GRANTED" | "ROLE_REVOKED" | "ASSET_MINTED" | "ASSET_TRANSFERRED" | "CREDENTIAL_REVOKED";
  actor: string;
  target: string;
  timestamp: string;
  txHash: string;
};
