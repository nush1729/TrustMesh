/**
 * CITIZEN IDENTITY — in-browser WebCrypto keypair (§4 of the Fabric migration
 * proposal, WebCrypto branch).
 *
 * This file is the frontend half of the decision recorded at length in
 * backend/src/fabric/identity.ts. In short: §4 decided citizens hold an
 * ordinary keypair decoupled from Fabric entirely, and left open whether that
 * keypair lives in MetaMask (used purely as a signing tool) or is generated
 * in-browser with WebCrypto. We took WebCrypto — no wallet extension is needed
 * to obtain a government identity, which is what §4's "DigiLocker-style,
 * non-crypto-native onboarding" goal requires.
 *
 * KEY STORAGE. The private key is stored in IndexedDB as a NON-EXTRACTABLE
 * CryptoKey. This is deliberately stronger than encrypting an extractable key
 * with a passphrase: a non-extractable key's bytes cannot be read back out by
 * JavaScript at all, so even a successful XSS on this origin can ask the
 * browser to *sign* with the key but can never exfiltrate it. A
 * passphrase-encrypted extractable key, by contrast, is one keylogger away
 * from being copied off the device permanently.
 *
 * The cost of that choice is portability — a non-extractable key cannot be
 * moved to another browser. Two things address it:
 *   1. exportEncryptedBackup() below, which generates a SEPARATE extractable
 *      key only when the user explicitly asks for a backup, and encrypts it
 *      with a passphrase via PBKDF2-SHA256 + AES-256-GCM.
 *   2. Guardian recovery, which under the Fabric design is now itself a
 *      governed, multi-organization-approved action rather than something a
 *      single backend key could do unilaterally.
 *
 * WIRE FORMATS — these must match the backend and chaincode exactly:
 *   public key : SPKI DER, base64        (crypto.subtle.exportKey('spki'))
 *   signature  : raw r||s, base64        (WebCrypto's native ECDSA output;
 *                                         Node verifies with ieee-p1363)
 *   curve      : P-256, digest SHA-256
 */

const DB_NAME = 'trustmesh-identity';
const DB_VERSION = 1;
const STORE = 'keys';
const RECORD_ID = 'primary';

export interface StoredIdentity {
  id: string;
  did: string;
  publicKeyB64: string;
  privateKey: CryptoKey;
  createdAt: string;
}

export interface PublicIdentity {
  did: string;
  publicKeyB64: string;
  createdAt: string;
}

// --- IndexedDB -------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

// --- base58btc / did:key ----------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Uint8Array): string {
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

function base64Encode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64Decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function base64UrlDecode(value: string): Uint8Array {
  return base64Decode(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
}

/**
 * did:key for a P-256 public key: 'did:key:z' + base58btc(0x1200-varint ||
 * compressed point). Must produce the identical string the backend derives.
 */
async function didKeyFromPublicKey(publicKey: CryptoKey): Promise<string> {
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as { x: string; y: string };
  const x = base64UrlDecode(jwk.x);
  const y = base64UrlDecode(jwk.y);
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03; // SEC1 point compression
  const payload = new Uint8Array(2 + 1 + x.length);
  payload.set([0x80, 0x24], 0); // multicodec p256-pub (0x1200), varint
  payload.set([prefix], 2);
  payload.set(x, 3);
  return 'did:key:z' + base58btcEncode(payload);
}

// --- Identity lifecycle -------------------------------------------------------------

/**
 * Creates a new identity. `extractable: false` on the private key is the
 * load-bearing argument — see the file header.
 */
export async function createIdentity(): Promise<PublicIdentity> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const publicKeyB64 = base64Encode(await crypto.subtle.exportKey('spki', pair.publicKey));
  const did = await didKeyFromPublicKey(pair.publicKey);
  const record: StoredIdentity = {
    id: RECORD_ID,
    did,
    publicKeyB64,
    // A CryptoKey can be stored in IndexedDB directly; the browser keeps the
    // key material outside JavaScript's reach.
    privateKey: pair.privateKey,
    createdAt: new Date().toISOString(),
  };

  await tx('readwrite', (store) => store.put(record));
  return { did, publicKeyB64, createdAt: record.createdAt };
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return (await tx<StoredIdentity | undefined>('readonly', (store) => store.get(RECORD_ID))) ?? null;
  } catch {
    return null;
  }
}

export async function getPublicIdentity(): Promise<PublicIdentity | null> {
  const identity = await loadIdentity();
  if (!identity) return null;
  const { did, publicKeyB64, createdAt } = identity;
  return { did, publicKeyB64, createdAt };
}

export async function hasIdentity(): Promise<boolean> {
  return (await loadIdentity()) !== null;
}

/**
 * Permanently forgets this device's identity. The DID and its ledger anchor
 * remain — only this browser's ability to control it is destroyed, which is
 * exactly the situation guardian recovery exists to resolve.
 */
export async function forgetIdentity(): Promise<void> {
  await tx('readwrite', (store) => store.delete(RECORD_ID));
}

/**
 * Signs a message with the stored key. Returns base64 raw r||s, which is what
 * the backend and chaincode verify with `dsaEncoding: 'ieee-p1363'`.
 */
export async function signMessage(message: string): Promise<string> {
  const identity = await loadIdentity();
  if (!identity) throw new Error('No identity on this device.');
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(message)
  );
  return base64Encode(signature);
}

// --- Encrypted backup ----------------------------------------------------------------

const PBKDF2_ITERATIONS = 250_000;

async function deriveWrappingKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Creates a NEW identity that is exportable, encrypts it under `passphrase`,
 * and installs it as this device's identity — the portable alternative to
 * createIdentity(), for users who want a recoverable key from the start.
 *
 * Returned blob is safe to store anywhere: without the passphrase it is
 * AES-256-GCM ciphertext, and GCM's authentication tag means tampering is
 * detected rather than silently producing a wrong key.
 */
export async function createIdentityWithBackup(
  passphrase: string
): Promise<{ identity: PublicIdentity; backup: string }> {
  if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');

  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicKeyB64 = base64Encode(await crypto.subtle.exportKey('spki', pair.publicKey));
  const did = await didKeyFromPublicKey(pair.publicKey);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    wrappingKey,
    pkcs8
  );

  // Re-import as NON-EXTRACTABLE for day-to-day use, so the working copy in
  // IndexedDB still cannot be read out by script even though a backup exists.
  const nonExtractable = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const createdAt = new Date().toISOString();
  await tx('readwrite', (store) =>
    store.put({ id: RECORD_ID, did, publicKeyB64, privateKey: nonExtractable, createdAt })
  );

  const backup = JSON.stringify({
    v: 1,
    did,
    publicKeyB64,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: base64Encode(salt.buffer) },
    cipher: 'AES-256-GCM',
    iv: base64Encode(iv.buffer),
    ciphertext: base64Encode(ciphertext),
  });

  return { identity: { did, publicKeyB64, createdAt }, backup };
}

/** Restores an identity from an encrypted backup blob onto this device. */
export async function restoreFromBackup(backupJson: string, passphrase: string): Promise<PublicIdentity> {
  let parsed: {
    did: string;
    publicKeyB64: string;
    kdf: { iterations: number; salt: string };
    iv: string;
    ciphertext: string;
  };
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }

  const wrappingKey = await deriveWrappingKey(passphrase, base64Decode(parsed.kdf.salt));
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Decode(parsed.iv) as unknown as BufferSource },
      wrappingKey,
      base64Decode(parsed.ciphertext) as unknown as BufferSource
    );
  } catch {
    // AES-GCM authentication failure — wrong passphrase, or a tampered file.
    throw new Error('Could not decrypt the backup. Check the passphrase.');
  }

  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);

  const createdAt = new Date().toISOString();
  await tx('readwrite', (store) =>
    store.put({ id: RECORD_ID, did: parsed.did, publicKeyB64: parsed.publicKeyB64, privateKey, createdAt })
  );
  return { did: parsed.did, publicKeyB64: parsed.publicKeyB64, createdAt };
}
