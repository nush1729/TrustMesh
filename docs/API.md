# TrustMesh Backend API Reference — Hyperledger Fabric stack

Base URL: `http://localhost:4000` (dev, `backend/src/server.fabric.ts` /
`npm run dev:fabric`). All request/response bodies are JSON unless noted.
Session auth uses an httpOnly cookie (`trustmesh_session`) set by
`POST /auth/verify` — no bearer tokens, no passwords.

The EVM/Amoy version of this API (`backend/src/server.ts`) still exists as a
parallel fallback with its own route tree and its own `.env` — see
`docs/ARCHITECTURE.md`. This document describes only the current Fabric
routes (`backend/src/routes/fabric/*`).

**Identifier change across every route below**: the EVM API took `0x...`
wallet addresses. Every Fabric route below takes a **DID hash** — the
lowercase-hex SHA-256 of a `did:key:z...` identifier — instead. A DID itself
(`did:key:z...`) is used only where the route explicitly needs the full
identifier (e.g. `/auth/challenge`).

---

## Auth

### `POST /auth/challenge`
Request: `{ "did": "did:key:z..." }`
Response: `{ "nonce": "TrustMesh login nonce: ..." }`

### `POST /auth/verify`
Request: `{ "did": "did:key:z...", "signature": "<base64 raw r||s>", "nonce": "..." }`
`signature` is the browser's WebCrypto ECDSA (P-256, SHA-256) signature over
`TrustMesh DID challenge: <nonce>`, verified against whichever public key the
**ledger** currently records as `did`'s controller — not a caller-supplied key.
Response: `{ "sessionToken": "...", "did": "...", "didHash": "..." }`, and sets
the `trustmesh_session` cookie.

### `POST /auth/logout`
Deletes the session row server-side (not just the cookie) so a captured token
cannot be replayed after logout. Response: `{ "ok": true }`.

---

## Identity

### `POST /identity/did` — unauthenticated (a session cannot exist before a DID does)
Request: `{ "publicKey": "<base64 SPKI DER>", "signature": "<base64 raw r||s over the did:key string>" }`
Submits the ledger registration (`DIDRegistry.RegisterDID`). The chaincode
itself verifies the proof-of-possession signature — this is what stands in
for a wallet's `msg.sender` on the EVM stack.
Response: `{ "did": "did:key:z...", "didHash": "..." }`

### `GET /identity/me` — session required
Response: `{ "didHash": "...", "did": "did:key:z..." }`

### `POST /identity/digilocker-import` — session required
Request: `{ "documentType": "10th Marksheet" }` (see `MOCK_DOCUMENT_TYPES` in
`backend/src/services/digilocker.mock.ts`)
Response: `{ "credentialJwt": "...", "issuerDid": "did:key:z..." }`
Field values are written to the encrypted PII vault; the credential itself
only attests document type + verified-field count, never raw values.

---

## Credentials

### `POST /credentials/issue` — session + Manager role required
Request: `{ "subjectDid": "did:key:z...", "credentialType": "RoleAttestation", "claims": { ... } }`
Response: `{ "credentialJwt": "...", "issuerDid": "did:key:z..." }`

### `POST /credentials/revoke` — session + Admin role required
Request: `{ "credentialId": "..." }`
Response: `{ "proposalId": "...", "status": "PENDING", "statusId": "..." }` —
proposed to the governance chaincode (`SET_CREDENTIAL_STATUS`), not executed
directly; see `/governance/approve` and `/governance/execute`.

---

## Roles (RBAC)

### `POST /roles/grant` — session + Admin role required
Request: `{ "role": "Manager", "subject": "<did hash>", "expiry": 1735689600, "orgLabel": "Dept of CS" }`
Response: `{ "proposalId": "...", "status": "PENDING", "approvals": 1 }`

### `POST /roles/revoke` — session + Admin role required
Request: `{ "role": "Manager", "subject": "<did hash>" }`
Response: `{ "proposalId": "...", "status": "PENDING", "approvals": 1 }`

### `GET /roles/status/:proposalId`
Response: current proposal state (see `/governance/:proposalId` below — same shape).

### `GET /roles/subject/:didHash`
Every role currently held by an identity (CouchDB rich query — not possible
against the EVM contracts, which had no indexed reverse lookup).
Response: `{ "roles": [{ "role": "Admin", "expiry": 1735689600, ... }] }`

### `GET /roles/holders/:role`
Everyone currently holding `:role` (`Admin`/`Manager`/`Auditor`/`User`) — the
admin console's roster view.
Response: `{ "holders": ["<did hash>", ...] }`

---

## Governance (new route group — did not exist on the EVM stack)

The EVM equivalent of this lived **outside** the application: co-signers
approved Gnosis Safe transactions in the Safe{Wallet} web UI. Fabric has no
hosted approval UI, so the approval step is first-class API surface here.
Every mutating action anywhere in this API — role grant/revoke, asset
mint/transfer, credential revocation, controller rotation — goes through this
propose → approve → execute lifecycle, requiring 2 of the 3 governance
organizations.

### `GET /governance/pending`
Response: `{ "proposals": [{ "proposalId": "...", "actionType": "GRANT_ROLE", "proposer": "...", "approvals": ["Org1MSP"], "payload": {...}, "createdAt": "..." }, ...] }`

### `GET /governance/signers`
Response: `{ "threshold": 2, "organizations": [{ "org": "org1", "mspId": "Org1MSP", "role": "IssuingDept" }, { "org": "org2", "mspId": "Org2MSP", "role": "AuditOrg" }, { "org": "org3", "mspId": "Org3MSP", "role": "IndependentVerifier" }] }`

### `GET /governance/:proposalId`
Response: full proposal record including approval trail and final status
(`PENDING` / `EXECUTED` / `CANCELLED`).

### `POST /governance/approve` — session + Admin role required
Request: `{ "proposalId": "..." }` — **no `org` field.**

**V1 security fix (was: governance quorum bypass).** This endpoint used to
accept a client-supplied `org` field and use it to pick which of the three
colocated organizations' MSP identities signed the approval — meaning a
single authenticated Admin session could call this endpoint twice with two
different `org` values and single-handedly satisfy the whole 2-of-3 quorum.
That was proven exploitable live (security audit §11/V1).

The organization is now derived **only** from the caller's own session
(`req.didHash`), looked up in the `org_admins` table (Postgres): every
identity permitted to approve governance proposals is assigned to exactly
one organization when it is bootstrapped (see `fabric/bootstrap.ts` and
"Bootstrapping org-affiliated admins for local dev" in `ENV_SETUP.md`). Any
`org` field in the request body is ignored entirely.

- If the caller has no recorded affiliation: `403` — `{ "error": "... no
  organization affiliation assigned — contact an existing admin to assign one
  via bootstrap." }`
- If the caller's own organization has already approved this proposal (e.g.
  the same identity that proposed it, or a repeat call): `400`, from the
  chaincode's own per-org dedup check.
- Otherwise: the caller's affiliated organization's approval is recorded.

In production, each organization would run its own backend holding only its
own identity, and no organization selection would exist on this endpoint at
all — this fix makes the single-process prototype behave equivalently (one
identity, one organization, no way to act as another) rather than waiting for
that split.

Response: updated proposal record.

### `POST /governance/execute` — session + Admin role required
Request: `{ "proposalId": "..." }`. Fails with `ENDORSEMENT_POLICY_FAILURE` if
fewer than 2 organizations have approved — enforced twice over, by the
chaincode's own quorum check and independently by the channel's Fabric
endorsement policy.
Response: the executed action's result (varies by `actionType`).

### `POST /governance/cancel` — session + Admin role required
Request: `{ "proposalId": "..." }`

---

## Assets

### `POST /assets/mint` — session + Admin role required, `multipart/form-data`
Fields: `to` (DID hash), `file` (binary), `encrypted` (`"true"` or `"false"`,
required — an explicit caller declaration of intent, kept for audit-trail
hygiene; see the V2 note below for why it is no longer load-bearing for
security).

**V3 security fix (was: no upload validation).** The uploaded file's actual
bytes are sniffed against an explicit magic-byte allowlist — PDF, PNG, JPEG,
and Office Open XML (`.docx`/`.xlsx`/`.pptx`) — never the client-declared
`Content-Type` or filename extension. Anything else (HTML/SVG/script-
executable content included — this is exactly what the audit's live exploit
used) is rejected with `400`:
```json
{ "error": "Unrecognized or disallowed file type.", "allowed": ["pdf", "png", "jpg", "docx", "xlsx", "pptx"] }
```

**V2 security fix (was: documents uploaded unencrypted).** The file is
**always** encrypted server-side (AES-256-GCM, random per-file key, wrapped
by `PII_VAULT_MASTER_KEY`) before it is ever uploaded to IPFS — regardless of
the `encrypted` field's value above, which a caller cannot be trusted to have
acted on honestly. Audit §9/§V2 proved a PII-marked file minted through this
exact endpoint was retrievable in plaintext directly from Kubo, bypassing the
backend entirely; that is no longer possible; only ciphertext ever reaches
IPFS. The on-chain `contentHash` is computed over that ciphertext (the actual
retrievable bytes), so it stays consistent with `/assets/:assetId/history`
and every other place that treats it as an integrity anchor. The wrapped
per-file key is stored server-side in Postgres (`asset_encryption_keys`,
keyed by the IPFS CID — see `GET /assets/:assetId/document` below for how to
get the plaintext back).

Uploads to the private, self-hosted Kubo IPFS node (Stage 1 P3.1), then
proposes `MINT_ASSET` to governance.
Response: `{ "proposalId": "...", "status": "PENDING", "ipfsCID": "Qm...", "contentHash": "0x..." }`

### `POST /assets/transfer` — session + Admin role required
Request: `{ "from": "<did hash>", "to": "<did hash>", "assetId": "12" }`
Response: `{ "proposalId": "...", "status": "PENDING" }`

### `GET /assets/status/:proposalId`
### `GET /assets/owner/:didHash`
Response: `{ "assets": [{ "assetId": "12", "ipfsCID": "Qm...", "contentHash": "0x...", "owner": "...", "mintedAt": "..." }] }`

### `GET /assets/:assetId`
### `GET /assets/:assetId/history`
Immutable custody provenance straight from the ledger's key history.
Response: `{ "history": [{ "owner": "...", "at": "..." }, ...] }`

### `GET /assets/:assetId/document` — session required (new, V2 fix)
Fetches the asset's ciphertext from Kubo by its stored CID, decrypts it
server-side with the wrapped per-file key, and streams the **plaintext**
original file back (`Content-Type: application/octet-stream`,
`Content-Disposition: attachment`).

Access is restricted to the asset's **current owner**, or a caller holding an
active **Admin** or **Auditor** role — anyone else gets `403`. Unknown
`assetId` is `404`; an asset minted before this fix (no recorded encryption
key) is also `404`.

---

## Verify

### `GET /verify/:did` — public, no session
`:did` accepts either a `did:key:z...` identifier or a raw 64-character DID
hash.
Response: `{ "did": "...", "didHash": "...", "roles": ["Manager"], "assets": [{ "assetId": "12", "ipfsCID": "...", "contentHash": "..." }], "credentialsValid": true }`
Never touches the PII vault, and never imports `vault.service` at all — reads
ledger role/asset state only. A direct CouchDB state query, not a replay of
cached mint/transfer events (the EVM contract had no indexed reverse-owner
map and had to reconstruct ownership from event history).

---

## Recovery

### `POST /recovery/guardians` — session required
Request: `{ "guardianId": "..." }` — adds a guardian for the **caller's own**
DID only (Stage 1 P0.1 fix, preserved exactly); the caller must also still be
the DID's current ledger-recorded controller.

### `POST /recovery/propose` — session required (caller must be a registered guardian)
Request: `{ "didHash": "...", "newControllerPublicKey": "<base64 SPKI DER>" }`
Response: `{ "requestId": "...", "threshold": 2, "votes": 1 }`

### `POST /recovery/vote` — session required (caller must be a registered guardian)
Request: `{ "requestId": "..." }`
Response: `{ "status": "pending" | "executed", "votes": 2 }` — once the
guardian threshold is met, this itself becomes a governed `UPDATE_CONTROLLER`
proposal executed through the same 2-of-3 organization approval as every
other mutation, not a unilateral backend write.

---

## Vault (DPDP Erasure)

**Unchanged by this migration** — same route semantics, same
`erasure.service.ts`, only the auth middleware and the actor identifier
(DID hash instead of wallet address) differ.

### `POST /vault/erase` — session + Admin role required
Request: `{ "didHash": "...", "reason"?: "..." }`
Response: `{ "erased": boolean, "id": "...", "status": "pending" | "executed", "approvals": number, "threshold": number, "erasedRows"?: number }`
A governed, 2-approval request (Stage 1 P0.3): the first Admin session's call
returns `status: "pending"`; only a second, distinct Admin session calling it
for the same `didHash` executes the erasure. On execution, permanently
deletes every PII row for the DID; on-chain/IPFS pointers become orphaned but
untouched.

---

## Audit

### `GET /audit/feed`
Response: `{ "events": [{ "id": "...", "type": "ASSET_MINTED", "actor": "...", "target": "...", "approvedBy": ["Org1MSP", "Org2MSP"], "timestamp": "...", "block": 372, "txId": "..." }] }`
Served from the durable, checkpointed event indexer
(`backend/src/fabric/indexer.service.ts`), not replayed per request. PII-free
by construction — the chain never stores PII in the first place. Unlike the
EVM feed, governed events additionally show **who proposed and who
approved** each action (Safe approvals happened in a separate system the EVM
indexer had no visibility into).

---

## Health

### `GET /health`
### `GET /health/chain`
Reaches the real peer, channel, and chaincode (`pingChaincode()`), not a
static health flag. Returns `503` if the Fabric Gateway connection or a real
chaincode query fails.
