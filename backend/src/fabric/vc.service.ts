import * as crypto from 'crypto';
import { ES256KSigner } from 'did-jwt';
import { createVerifiableCredentialJwt, Issuer, verifyCredential } from 'did-jwt-vc';
import { Resolver } from 'did-resolver';
import KeyResolver from 'key-did-resolver';
import { fabricConfig } from './config';

/**
 * Verifiable Credentials — replaces services/vc.service.ts.
 *
 * §1.3 of the migration proposal notes this file is "largely reusable, pointed
 * at a different resolver", and that is what happened: the issuance and
 * verification logic is unchanged, and only two things moved.
 *
 *   1. Resolver: ethr-did-resolver (which resolves by querying an Ethereum
 *      registry contract, and is meaningless without an EVM chain) is replaced
 *      by key-did-resolver. did:key resolves purely by decoding the identifier
 *      itself, so credential verification no longer depends on any chain being
 *      reachable at all — a verifier can check a credential offline.
 *   2. Issuer DID: did:ethr:amoy:<address> becomes did:key:zQ3s... derived from
 *      the same kind of secp256k1 key, so ES256K signing is unchanged.
 *
 * Credential claims still never contain raw PII — only attestations. Underlying
 * personal data goes to the encrypted Postgres vault (untouched by this
 * migration) and is referenced here at most by a content hash.
 */

const resolver = new Resolver(KeyResolver.getResolver());

/** multicodec secp256k1-pub (0xe7), varint-encoded. */
const SECP256K1_MULTICODEC = Buffer.from([0xe7, 0x01]);

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

/**
 * did:key for the issuer's secp256k1 key.
 *
 * The compressed public key is derived with Node's own ECDH rather than an
 * Ethereum library — this backend has no reason to depend on ethers any more.
 */
export function issuerDidFromPrivateKey(privateKeyHex: string): string {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex'));
  const compressed = ecdh.getPublicKey(null, 'compressed'); // 33 bytes
  return 'did:key:z' + base58btcEncode(Buffer.concat([SECP256K1_MULTICODEC, compressed]));
}

function getIssuer(): Issuer {
  const key = fabricConfig.vcIssuerPrivateKey;
  if (!key) {
    throw new Error('VC_ISSUER_PRIVATE_KEY not set — cannot issue Verifiable Credentials.');
  }
  const privateKeyHex = key.replace(/^0x/, '');
  return {
    did: issuerDidFromPrivateKey(privateKeyHex),
    signer: ES256KSigner(Buffer.from(privateKeyHex, 'hex')),
    alg: 'ES256K',
  };
}

export type VcSubject = { id: string; [claim: string]: unknown };

/**
 * Issues a W3C Verifiable Credential JWT for `subjectDid` (a did:key).
 * `claims` are attestations — e.g. { role: "Manager" }, { documentType: "..." } —
 * never raw personal data.
 */
export async function issueCredential(
  subjectDid: string,
  credentialType: string,
  claims: Record<string, unknown>
) {
  const issuer = getIssuer();
  const vcPayload = {
    sub: subjectDid,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', credentialType],
      credentialSubject: { id: subjectDid, ...claims } as VcSubject,
    },
  };
  const jwt = await createVerifiableCredentialJwt(vcPayload, issuer);
  return { jwt, issuerDid: issuer.did };
}

export async function verifyCredentialJwt(jwt: string) {
  // Same cross-package did-resolver version duplication the EVM version
  // documented: did-jwt-vc bundles an older did-resolver whose types do not
  // nominally match the top-level v5 types, while the runtime resolve()
  // contract is identical.
  const result = await verifyCredential(jwt, resolver as unknown as Parameters<typeof verifyCredential>[1]);
  return {
    valid: result.verified,
    issuer: result.issuer,
    subject: result.payload.vc.credentialSubject,
  };
}
