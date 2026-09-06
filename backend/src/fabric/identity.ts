import * as crypto from 'crypto';

/**
 * CITIZEN IDENTITY — the §4 "decoupled keypair" design.
 *
 * ============================================================================
 * DECISION RECORD: WebCrypto in-browser keypair, NOT MetaMask-as-signing-tool.
 * ============================================================================
 *
 * The migration proposal's §4 decided that citizens keep an ordinary asymmetric
 * keypair fully decoupled from Fabric, and that Fabric X.509/MSP identities
 * belong only to backend services. It deliberately left ONE sub-choice open:
 * whether that citizen keypair is held by MetaMask (used purely as a signing
 * tool, with no EVM chain involved) or generated in-browser with WebCrypto and
 * stored encrypted in IndexedDB.
 *
 * This implementation takes the WebCrypto branch. Reasons, in order of weight:
 *
 *   1. Zero wallet-extension dependency. §4 names "DigiLocker-style,
 *      non-crypto-native onboarding" as the goal, and the proposal itself says
 *      WebCrypto "fits that better than either MetaMask or a Fabric cert would".
 *      Requiring a browser extension to obtain a government identity is exactly
 *      the barrier that goal rules out.
 *   2. It removes the last vestigial piece of Ethereum from a stack whose whole
 *      point is that it no longer runs on Ethereum. Keeping MetaMask would mean
 *      shipping an EVM wallet in a product with no EVM chain — confusing to
 *      users and to reviewers.
 *   3. Nothing is lost. The self-sovereign property §4 cares about is that the
 *      private key never leaves the citizen's device, and that holds either
 *      way. Only the key's storage location changes.
 *
 * The tradeoff, stated plainly: an IndexedDB-held key is bound to one browser
 * profile, so key loss is more likely than with a wallet the user already
 * backs up. That is precisely what the guardian recovery path exists for, and
 * recovery is now itself a governed, multi-party-approved action (see
 * UPDATE_CONTROLLER in the chaincode), so this is a supported flow rather than
 * an unhandled failure.
 *
 * ============================================================================
 *
 * Concretely: ECDSA on P-256 (WebCrypto's `ECDSA`/`P-256`), SHA-256 digests,
 * and RAW r||s signatures — which is what WebCrypto's `sign()` returns, unlike
 * Node's default DER encoding. Everything below is written to match the
 * browser's output byte-for-byte; the chaincode's verifyPossession() does the
 * same on its side.
 */

// --- base58btc, for did:key's multibase 'z' prefix -------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Buffer): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const b of bytes) {
    if (b === 0) out += B58[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/** multicodec p256-pub (0x1200), varint-encoded. */
const P256_MULTICODEC = Buffer.from([0x80, 0x24]);

/**
 * Derives the did:key identifier for a P-256 public key given as base64 SPKI DER
 * — the exact form `crypto.subtle.exportKey('spki', ...)` produces in a browser.
 *
 * did:key is the DID method decided in §5.1: the identifier IS the key material,
 * so no resolution infrastructure is needed and the ledger anchors only a hash
 * and status.
 */
export function didKeyFromPublicKey(publicKeyB64: string): string {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string; crv?: string };
  if (jwk.crv !== 'P-256') {
    throw new Error(`Expected a P-256 public key, got ${jwk.crv}`);
  }
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  // SEC1 point compression: prefix encodes the parity of Y.
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
  const compressed = Buffer.concat([Buffer.from([prefix]), x]);
  return 'did:key:z' + base58btcEncode(Buffer.concat([P256_MULTICODEC, compressed]));
}

/**
 * The ledger's identifier for a DID.
 *
 * MUST stay identical to the chaincode's sha256Hex(did) — this hash is the
 * primary key that ties a ledger identity anchor to its off-chain Postgres row
 * and its encrypted vault entries.
 */
export function didToHash(did: string): string {
  return crypto.createHash('sha256').update(did, 'utf8').digest('hex');
}

/**
 * Verifies a signature made by a citizen's browser key.
 *
 * `dsaEncoding: 'ieee-p1363'` is load-bearing: WebCrypto emits raw r||s, while
 * Node's crypto defaults to DER. Verifying with the default would reject every
 * genuine browser signature.
 */
export function verifySignature(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

/** True if `value` parses as a P-256 SPKI public key. Used to reject junk early. */
export function isValidPublicKey(publicKeyB64: string): boolean {
  try {
    const jwk = crypto
      .createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
      .export({ format: 'jwk' }) as { crv?: string };
    return jwk.crv === 'P-256';
  } catch {
    return false;
  }
}

export function isDidKey(did: string): boolean {
  return typeof did === 'string' && /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,}$/.test(did);
}

/**
 * Role identifiers, mirroring the EVM stack's ROLE_NAME_TO_HASH.
 *
 * Same constants as the Solidity contracts used ("TRUSTMESH_ADMIN_ROLE" etc.),
 * hashed with SHA-256 rather than keccak256 since there is no EVM here. The
 * chaincode only ever sees the hash — never the words "Admin" or an org label,
 * which would be permanent un-erasable personal data under DPDP.
 */
export const ROLE_NAMES = ['Admin', 'Manager', 'Auditor', 'User'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

function roleHash(constant: string): string {
  return crypto.createHash('sha256').update(constant, 'utf8').digest('hex');
}

export const ROLE_NAME_TO_HASH: Record<RoleName, string> = {
  Admin: roleHash('TRUSTMESH_ADMIN_ROLE'),
  Manager: roleHash('TRUSTMESH_MANAGER_ROLE'),
  Auditor: roleHash('TRUSTMESH_AUDITOR_ROLE'),
  User: roleHash('TRUSTMESH_USER_ROLE'),
};

export const HASH_TO_ROLE_NAME: Record<string, RoleName> = Object.fromEntries(
  Object.entries(ROLE_NAME_TO_HASH).map(([name, hash]) => [hash, name as RoleName])
) as Record<string, RoleName>;

/** The status id shared by the RBAC and revocation registries. Mirrors the chaincode. */
export function statusIdFor(roleId: string, subject: string): string {
  return crypto.createHash('sha256').update(`${roleId}:${subject}`, 'utf8').digest('hex');
}
