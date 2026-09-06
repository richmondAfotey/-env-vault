import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAGIC,
  decryptVault,
  encryptVault,
} from '../src/crypto/cipher.js';
import { PasswordError } from '../src/utils/errors.js';

/** Low iteration count keeps tests fast; correctness is independent of it. */
const ITER = 1_024;

test('round-trips a profile', () => {
  const blob = encryptVault({ API_KEY: 'secret', DB_URL: 'postgres://x' }, 'hunter2', ITER);
  assert.deepEqual(decryptVault(blob, 'hunter2'), {
    API_KEY: 'secret',
    DB_URL: 'postgres://x',
  });
});

test('throws PasswordError on the wrong password', () => {
  const blob = encryptVault({ A: '1' }, 'right', ITER);
  assert.throws(() => decryptVault(blob, 'wrong'), PasswordError);
});

test('throws PasswordError on a tampered authTag', () => {
  const blob = encryptVault({ A: '1' }, 'pw', ITER);
  const tampered = Buffer.from(blob);
  const tagByte = tampered.length - 5;
  tampered.writeUInt8(tampered.readUInt8(tagByte) ^ 0xff, tagByte); // flip a byte inside the 16-byte tag
  assert.throws(() => decryptVault(tampered, 'pw'), PasswordError);
});

test('throws PasswordError on data that is not a vault', () => {
  assert.throws(
    () => decryptVault(Buffer.from('definitely not an env-vault blob'), 'pw'),
    PasswordError,
  );
});

test('rejects an absurd iteration count in the header (DoS guard)', () => {
  const blob = encryptVault({ A: '1' }, 'pw', ITER);
  const evil = Buffer.from(blob);
  evil.writeUInt32BE(2_000_000_000, 10);
  assert.throws(() => decryptVault(evil, 'pw'), PasswordError);
});

test('blob exposes the magic tag but never the plaintext', () => {
  const blob = encryptVault({ SECRET_TOKEN: 'abc' }, 'pw', ITER);
  assert.equal(blob.subarray(0, MAGIC.length).toString('utf8'), MAGIC);
  assert.ok(!blob.toString('utf8').includes('SECRET_TOKEN'));
  assert.ok(!blob.toString('utf8').includes('abc'));
});

test('two encryptions of the same profile differ (fresh salt + IV)', () => {
  const a = encryptVault({ A: '1' }, 'pw', ITER);
  const b = encryptVault({ A: '1' }, 'pw', ITER);
  assert.notDeepEqual(a, b);
});

test('round-trips an empty profile', () => {
  const blob = encryptVault({}, 'pw', ITER);
  assert.deepEqual(decryptVault(blob, 'pw'), {});
});