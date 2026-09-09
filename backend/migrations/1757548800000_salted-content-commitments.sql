-- CRY-3 — salted content commitments.
--
-- THE PROBLEM
--
-- Asset content was anchored on the ledger as a bare `keccak256(bytes)`. A bare
-- hash of a document is a permanent CONFIRMATION ORACLE: it cannot be inverted,
-- but anyone holding a candidate document can hash it and prove it is the one
-- that was anchored. For structured, low-entropy content — a marksheet is a
-- name, a board, a year and a roll number — the candidate space is small enough
-- to enumerate outright.
--
-- It also quietly falsified the project's DPDP claim. "Erasure" deletes the
-- off-chain record, but the ledger keeps the hash forever, so anyone who later
-- obtains a copy of the document can still prove it was the anchored one. The
-- record was deleted; the ability to confirm it was not.
--
-- THE FIX
--
-- Anchor `sha256(salt || bytes)` with 32 random bytes of salt held only here,
-- off-ledger. Guessing stops working, because the guesser does not have the
-- salt. And deleting this row destroys the salt, which makes the anchored
-- commitment permanently unverifiable against any candidate — so erasure
-- becomes cryptographically real rather than a promise that the copy was
-- thrown away.
--
-- Rows here are keyed by CID and hold no personal data themselves: a salt and a
-- content identifier. The document they commit to lives on the private Kubo
-- node; the commitment lives on the ledger; only the link between them is here.
--
-- LEGACY ANCHORS
--
-- Assets minted before this migration carry an unsalted keccak256 hash and have
-- no row here. verifyContentCommitment() reports those as 'legacy' rather than
-- silently failing or silently passing — they cannot be verified under the new
-- scheme, and pretending otherwise would be worse than saying so.

-- Up Migration

CREATE TABLE IF NOT EXISTS content_commitments (
  cid          TEXT PRIMARY KEY,
  salt         BYTEA NOT NULL,
  algorithm    TEXT NOT NULL DEFAULT 'sha256-salted-v1',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE content_commitments IS
  'CRY-3: per-CID salts backing the commitments anchored on the ledger. Deleting a row permanently destroys the ability to verify that ledger anchor against any candidate document.';

-- Down Migration

DROP TABLE IF EXISTS content_commitments;
