-- TrustMesh off-chain schema.
-- Everything in this file is DELIBERATELY off-chain: it holds the
-- human-readable role<->org mapping and any PII, both of which must stay
-- correctable/erasable under India's DPDP Act — something an immutable
-- public ledger cannot provide.

CREATE TABLE IF NOT EXISTS users (
  did_hash        TEXT PRIMARY KEY,          -- keccak256(did), matches DIDRegistry
  did             TEXT NOT NULL UNIQUE,      -- did:ethr:80002:0x...
  wallet_address  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Human-readable role <-> organization mapping. The chain only ever sees a
-- role hash bound to a wallet address; this table is what lets an admin
-- correct "Manager, Dept X" -> "Manager, Dept Y" or erase it outright
-- without touching the immutable on-chain grant/expiry/revocation state.
CREATE TABLE IF NOT EXISTS role_labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash        TEXT NOT NULL REFERENCES users(did_hash),
  role_hash       TEXT NOT NULL,             -- bytes32 role hash, matches AccessControlRegistry
  role_name       TEXT NOT NULL,             -- 'Admin' | 'Manager' | 'Auditor' | 'User'
  org_label       TEXT,                      -- free-text, e.g. "Dept of Computer Science"
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

-- Encrypted PII vault. `ciphertext` holds AES-256-GCM output; `dek_wrapped`
-- holds the per-record data-encryption-key, itself wrapped with
-- PII_VAULT_MASTER_KEY. "Erasure" (DPDP Right to Erasure) = deleting the
-- row here, which orphans any on-chain/IPFS hash that pointed at this data
-- — the chain itself is never touched or rewritten.
CREATE TABLE IF NOT EXISTS pii_vault (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash        TEXT NOT NULL REFERENCES users(did_hash),
  field_name      TEXT NOT NULL,             -- e.g. 'aadhaar_number', 'full_name'
  ciphertext      BYTEA NOT NULL,
  iv              BYTEA NOT NULL,
  auth_tag        BYTEA NOT NULL,
  dek_wrapped     BYTEA NOT NULL,
  content_hash    TEXT,                      -- optional link to an on-chain/IPFS pointer this data backs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardians (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash        TEXT NOT NULL REFERENCES users(did_hash),
  guardian_address TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash        TEXT NOT NULL REFERENCES users(did_hash),
  proposed_by     TEXT NOT NULL,
  new_controller  TEXT NOT NULL,
  votes           TEXT[] NOT NULL DEFAULT '{}',
  threshold       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | executed | expired
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token           TEXT PRIMARY KEY,
  wallet_address  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce           TEXT PRIMARY KEY,
  wallet_address  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  used            BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_role_labels_did_hash ON role_labels(did_hash);
CREATE INDEX IF NOT EXISTS idx_pii_vault_did_hash ON pii_vault(did_hash);

-- P0.3 fix: ungoverned, unaudited DPDP erasure. `/vault/erase` used to
-- destroy a citizen's PII on a single Admin session with no second approval
-- and no audit record — the one truly irreversible action in the system was
-- the one action NOT gated behind the same 2-of-3 approval every other
-- destructive action goes through. This table implements an off-chain
-- 2-approval record (erasure is a DB operation, not a contract call, so it
-- is not a Gnosis Safe transaction) gating the actual key-destruction call
-- in vault.service.ts (untouched — see erasure.service.ts, which only ever
-- CALLS eraseAllForUser once the threshold below is met).
CREATE TABLE IF NOT EXISTS erasure_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash        TEXT NOT NULL REFERENCES users(did_hash),
  requested_by    TEXT NOT NULL,
  reason          TEXT,
  approvals       TEXT[] NOT NULL DEFAULT '{}',
  threshold       INTEGER NOT NULL DEFAULT 2,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | executed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at     TIMESTAMPTZ
);

-- Append-only trail of who requested/approved/executed an erasure, and why
-- — written BEFORE the key is destroyed, since after destruction the event
-- that caused it is by definition unrecoverable from the vault itself.
CREATE TABLE IF NOT EXISTS erasure_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erasure_request_id  UUID NOT NULL REFERENCES erasure_requests(id),
  actor               TEXT NOT NULL,
  action              TEXT NOT NULL, -- requested | approved | executed
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erasure_requests_did_hash ON erasure_requests(did_hash);

-- Guardian-notification feature: alerts the actual DID owner when a recovery
-- is proposed/voted for their identity, and when a login is seen from a
-- device that has never authenticated for that DID before.
--
-- DELIVERY IS MOCKED. There is no SendGrid/Twilio/etc. configured in this
-- project (by design — no new paid external dependencies), so "sending" a
-- notification means writing a durable row here that a real provider would
-- otherwise have delivered as an email/SMS. See
-- backend/src/fabric/notifications.service.ts for where a real provider
-- would plug in (one function, `dispatchNotification`).
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_hash    TEXT NOT NULL REFERENCES users(did_hash), -- the DID this notification is ABOUT/FOR
  type        TEXT NOT NULL,   -- 'RECOVERY_PROPOSED' | 'RECOVERY_VOTE' | 'RECOVERY_EXECUTED' | 'NEW_DEVICE_LOGIN'
  channel     TEXT NOT NULL DEFAULT 'mock', -- always 'mock' until a real provider is wired in
  subject     TEXT NOT NULL,   -- what a real email's subject line / SMS preview would say
  body        TEXT NOT NULL,   -- the full mocked message body
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_did_hash ON notifications(did_hash, created_at DESC);
