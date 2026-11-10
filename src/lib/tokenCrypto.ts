import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encryption for the sign-in tokens Anchor keeps for connected tools
// (Google, Microsoft, Slack, Zoom, HubSpot, Salesforce, Dropbox, LinkedIn).
// Applied by the `encryptedText` column type in src/db/schema.ts, so every
// insert/update encrypts and every select decrypts with no change to the
// code that uses the tokens.
//
// AES-256-GCM. Stored form: "enc:v1:" + base64(iv | tag | ciphertext).
//
// The key comes from TOKEN_ENCRYPTION_KEY, or, when that isn't set, from
// AUTH_SECRET (already required in production), so encryption is on without
// any extra setup. Decryption tries both, so setting TOKEN_ENCRYPTION_KEY
// later keeps the tokens saved under AUTH_SECRET readable; they're
// re-encrypted under the new key at the next start (encryptStoredTokens).
//
// Values without the prefix (saved before encryption existed) are read as
// they are, and encrypted by encryptStoredTokens on the next start.

export const ENCRYPTED_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKeys: Buffer[] | null = null;

function keys(): Buffer[] {
  if (cachedKeys) return cachedKeys;
  const secrets = [process.env.TOKEN_ENCRYPTION_KEY, process.env.AUTH_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  cachedKeys = secrets.map((s) => createHash("sha256").update(`anchor-token-encryption:${s}`).digest());
  return cachedKeys;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptToken(plain: string): string {
  const [key] = keys();
  // No secret at all only happens in a bare local setup; keep working.
  if (!key || plain === "" || isEncrypted(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

let warned = false;

// Decrypts with whichever known key fits. Returns the stored text unchanged
// if it isn't encrypted, or if no key fits (the provider then rejects it and
// the person is asked to reconnect, rather than the page crashing).
export function decryptToken(stored: string): string {
  return decryptWithKeyIndex(stored).value;
}

export function decryptWithKeyIndex(stored: string): { value: string; keyIndex: number } {
  if (!isEncrypted(stored)) return { value: stored, keyIndex: -1 };
  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const all = keys();
  for (let i = 0; i < all.length; i++) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", all[i], iv);
      decipher.setAuthTag(tag);
      return { value: Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"), keyIndex: i };
    } catch {
      // wrong key, try the next
    }
  }
  if (!warned) {
    warned = true;
    console.error("[tokenCrypto] a stored token couldn't be decrypted with TOKEN_ENCRYPTION_KEY or AUTH_SECRET");
  }
  return { value: stored, keyIndex: -1 };
}

// True when a stored value should be rewritten: still plain text, or
// encrypted under a key other than the current one.
export function needsReencrypt(stored: string | null): boolean {
  if (!stored || keys().length === 0) return false;
  if (!isEncrypted(stored)) return true;
  const { keyIndex } = decryptWithKeyIndex(stored);
  return keyIndex > 0;
}
