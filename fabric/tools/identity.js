#!/usr/bin/env node
/**
 * TrustMesh — citizen identity helper for CLI testing (Phase 2).
 *
 * Generates the exact key material the browser will generate under the §4
 * identity design: an ECDSA P-256 keypair, its did:key identifier, and a
 * proof-of-possession signature in the raw r||s form WebCrypto produces.
 *
 * This is the CLI-side mirror of what the frontend does with WebCrypto and
 * what the backend verifies. It exists so Phase 2's chaincode verification can
 * use real signatures rather than fixtures. (Phase 3 adds a typed backend
 * module for the same primitives.)
 *
 * Usage:
 *   node fabric/tools/identity.js new                  -> JSON: {did, didHash, publicKeyB64, privateKeyPem, signatureB64}
 *   node fabric/tools/identity.js sign <keyfile> <msg> -> base64 r||s signature
 *   node fabric/tools/identity.js rolehash <NAME>      -> sha256 of a role constant
 */

const crypto = require('crypto');
const fs = require('fs');

// --- base58btc (Bitcoin alphabet), as did:key's multibase 'z' prefix requires ---
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58btc(bytes) {
  let digits = [0];
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

/**
 * did:key for a P-256 key = 'did:key:z' + base58btc(multicodec || compressedPoint).
 * multicodec p256-pub is 0x1200, varint-encoded as [0x80, 0x24].
 */
function didKeyFromPublicKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03; // compressed point parity
  const compressed = Buffer.concat([Buffer.from([prefix]), x]);
  return 'did:key:z' + base58btc(Buffer.concat([Buffer.from([0x80, 0x24]), compressed]));
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** WebCrypto-compatible: ECDSA P-256 / SHA-256, raw r||s (not DER). */
function sign(privateKey, message) {
  return crypto
    .sign('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64');
}

function newIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const did = didKeyFromPublicKey(publicKey);
  return {
    did,
    didHash: sha256Hex(did),
    publicKeyB64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    // Proof of possession over the DID string, which is what RegisterDID verifies.
    signatureB64: sign(privateKey, did),
  };
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'new':
    console.log(JSON.stringify(newIdentity(), null, 2));
    break;
  case 'sign': {
    const key = crypto.createPrivateKey(fs.readFileSync(args[0], 'utf8'));
    console.log(sign(key, args[1]));
    break;
  }
  case 'rolehash':
    console.log(sha256Hex(args[0]));
    break;
  default:
    console.error('usage: identity.js new | sign <keyfile> <msg> | rolehash <NAME>');
    process.exit(1);
}
