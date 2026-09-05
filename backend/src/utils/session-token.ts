import * as crypto from "crypto";

/// P1.2 (session hardening): session tokens are a CSPRNG-generated random
/// value handed to the client, but only a SHA-256 hash of that value is ever
/// stored server-side. Reading the `sessions` table (e.g. via a DB
/// compromise or a leaked backup) no longer hands over a live, directly
/// usable session token — the attacker would still need to invert the hash.
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
