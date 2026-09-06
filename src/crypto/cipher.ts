/**
 * Encryption engine for env-vault.
 *
 * Scheme: AES-256-GCM, keyed from a master password via PBKDF2-HMAC-SHA256.
 *
 * File format (binary, big-endian):
 *
 *   +--------+---------+-----+------------+---------+---------+-------------+---------+
 *   | MAGIC  | version | KDF | iterations |  salt   |    IV   |  ciphertext | authTag |
 *   | 8 bytes|  1 byte | 1   |   4 bytes  |16 bytes |12 bytes |   (varies)  |16 bytes |
 *   +--------+---------+-----+------------+---------+---------+-------------+---------+
 *
 *   HEADER_BYTES = 8 + 1 + 1 + 4 + 16 + 12 = 42
 *   Total file   = 42 + len(ciphertext) + 16
 *
 * Security properties:
 *   - GCM authenticates the ciphertext; a wrong password or any tampering
 *     fails the authTag check and surfaces as one uniform `PasswordError`.
 *   - The salt (16 B) and IV (12 B) are fresh per encryption (randomBytes).
 *   - Raw secrets never touch disk; only this encrypted blob is persisted.
 */
import * as crypto from 'node:crypto';
import { PasswordError } from '../utils/errors.js';

export const MAGIC = 'ENVVAULT';

/** Format version: bump when the layout below changes. */
export const VERSION = 1;
/** KDF identifier: 1 = PBKDF2-HMAC-SHA256. */
export const KDF_PBKDF2_SHA256 = 1;

/** Iteration count when values are written (OWASP-aligned for SHA-256). */
export const DEFAULT_ITERATIONS = 600_000;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

export const HEADER_BYTES =
  Buffer.byteLength(MAGIC) + 1 + 1 + 4 + SALT_BYTES + IV_BYTES;

/** Upper bound on header iteration counts, guards against DoS on decrypt. */
const MAX_ITERATIONS = 10_000_000;

/** A vault's contents: an ordered map of environment variable name -> value. */
export type SecretMap = Record<string, string>;

interface Header {
  version: number;
  kdf: number;
  iterations: number;
  salt: Buffer;
  iv: Buffer;
}

/** Derive a 32-byte AES key from the master password (blocking, by design). */
export function deriveKey(
  password: string,
  salt: Buffer,
  iterations: number,
): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_BYTES, 'sha256');
}

function encodeHeader(header: Header): Buffer {
  const buf = Buffer.alloc(HEADER_BYTES);
  buf.write(MAGIC, 0, 'utf8');
  buf.writeUInt8(header.version, 8);
  buf.writeUInt8(header.kdf, 9);
  buf.writeUInt32BE(header.iterations, 10);
  header.salt.copy(buf, 14);
  header.iv.copy(buf, 14 + SALT_BYTES);
  return buf;
}

function decodeHeader(data: Buffer): Header {
  if (data.length < HEADER_BYTES + TAG_BYTES) {
    throw new PasswordError();
  }
  const magic = data.subarray(0, Buffer.byteLength(MAGIC)).toString('utf8');
  if (magic !== MAGIC) {
    throw new PasswordError();
  }
  const iterations = data.readUInt32BE(10);
  if (iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new PasswordError();
  }
  return {
    version: data.readUInt8(8),
    kdf: data.readUInt8(9),
    iterations,
    salt: data.subarray(14, 14 + SALT_BYTES),
    iv: data.subarray(14 + SALT_BYTES, 14 + SALT_BYTES + IV_BYTES),
  };
}

function isSecretMap(value: unknown): value is SecretMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/**
 * Encrypt a profile into an on-disk blob.
 *
 * @param profile   ordered map of KEY -> VALUE
 * @param password  master password (never persisted)
 * @param iterations PBKDF2 rounds; only tests override this
 */
export function encryptVault(
  profile: SecretMap,
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Buffer {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt, iterations);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(profile), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const header = encodeHeader({
    version: VERSION,
    kdf: KDF_PBKDF2_SHA256,
    iterations,
    salt,
    iv,
  });

  return Buffer.concat([header, ciphertext, authTag]);
}

/**
 * Decrypt a blob back into a profile. Throws `PasswordError` on wrong
 * password, unsupported format, tampered data, or a too-large iteration count.
 */
export function decryptVault(data: Buffer, password: string): SecretMap {
  const header = decodeHeader(data);
  if (header.version !== VERSION || header.kdf !== KDF_PBKDF2_SHA256) {
    throw new PasswordError();
  }

  let key: Buffer;
  try {
    key = deriveKey(password, header.salt, header.iterations);
  } catch {
    throw new PasswordError();
  }

  const authTag = data.subarray(data.length - TAG_BYTES);
  const ciphertext = data.subarray(HEADER_BYTES, data.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    if (!isSecretMap(parsed)) {
      throw new Error('vault payload is not a flat string map');
    }
    return parsed;
  } catch {
    throw new PasswordError();
  }
}