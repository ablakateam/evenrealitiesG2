import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

let masterKey: Buffer | null = null;

/**
 * Initialize crypto. Validates MASTER_KEY shape.
 * Call once on server boot before encrypt/decrypt.
 */
export async function initCrypto(): Promise<void> {
  const key = Buffer.from(env.MASTER_KEY, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Regenerate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  masterKey = key;
}

function key(): Buffer {
  if (!masterKey) throw new Error('crypto not initialized — call initCrypto() first');
  return masterKey;
}

/**
 * Encrypt a plaintext string with AES-256-GCM under the master key.
 * Returns a base64 string of `<iv(12)||tag(16)||ciphertext>`.
 * Each call uses a fresh random IV.
 */
export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt a string previously produced by encryptString.
 * Throws if the auth tag does not verify.
 */
export function decryptString(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Constant-time byte comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return nodeTimingSafeEqual(ab, bb);
}
