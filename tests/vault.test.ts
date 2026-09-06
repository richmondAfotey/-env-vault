import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_PROFILE,
  Vault,
  atomicWrite,
} from '../src/storage/vault.js';
import {
  PasswordError,
  ProfileNotFoundError,
  UsageError,
} from '../src/utils/errors.js';

const PW = 'test-master-password';

let root: string;
let vault: Vault;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-vault-test-'));
  vault = new Vault(root);
});

test('set then read a profile round-trips', () => {
  vault.updateProfile('development', { API_KEY: 'abc' }, PW);
  assert.deepEqual(vault.readProfile('development', PW), { API_KEY: 'abc' });
});

test('update merges new keys without dropping existing ones', () => {
  vault.updateProfile('dev', { A: '1' }, PW);
  vault.updateProfile('dev', { B: '2' }, PW);
  assert.deepEqual(vault.readProfile('dev', PW), { A: '1', B: '2' });
});

test('update overwrites the value of an existing key', () => {
  vault.updateProfile('dev', { A: '1' }, PW);
  vault.updateProfile('dev', { A: '2' }, PW);
  assert.deepEqual(vault.readProfile('dev', PW), { A: '2' });
});

test('readProfile throws for a missing profile', () => {
  assert.throws(() => vault.readProfile('ghost', PW), ProfileNotFoundError);
});

test('readProfile throws PasswordError for a wrong password', () => {
  vault.updateProfile('dev', { A: '1' }, 'right');
  assert.throws(() => vault.readProfile('dev', 'wrong'), PasswordError);
});

test('active profile defaults to development when config is absent', () => {
  assert.equal(vault.readActiveProfile(), DEFAULT_PROFILE);
});

test('setActiveProfile persists the pointer and enforces existence', () => {
  vault.updateProfile('staging', { A: '1' }, PW);
  vault.setActiveProfile('staging');
  assert.equal(vault.readActiveProfile(), 'staging');
  // Switching to a profile with no vault is a mistake, not a lazy promise.
  assert.throws(() => vault.setActiveProfile('ghost'), ProfileNotFoundError);
});

test('profile names are validated to prevent path traversal', () => {
  assert.throws(() => vault.updateProfile('../evil', { A: '1' }, PW), UsageError);
  assert.throws(() => vault.updateProfile('a b', { A: '1' }, PW), UsageError);
});

test('readProfile rejects traversal names before touching the filesystem', () => {
  assert.throws(() => vault.readProfile('../evil', PW), UsageError);
});

test('writes are atomic: no leftover temp files', () => {
  vault.updateProfile('dev', { A: '1' }, PW);
  const leftovers = fs
    .readdirSync(vault.vaultDir)
    .filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('encrypted vaults are not plain-text env files', () => {
  vault.updateProfile('dev', { SECRET: 'topsecret' }, PW);
  const bytes = fs.readFileSync(vault.profilePath('dev'));
  assert.ok(!bytes.toString('utf8').includes('topsecret'));
  assert.ok(!bytes.toString('utf8').includes('SECRET'));
});

test('atomicWrite replaces file contents and applies restrictive mode', () => {
  const file = path.join(root, 'secret.out');
  atomicWrite(file, 'first');
  assert.equal(fs.readFileSync(file, 'utf8'), 'first');
  atomicWrite(file, 'second');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  const readonlyBits = fs.statSync(file).mode & 0o600;
  assert.equal(readonlyBits, 0o600, 'expect owner read/write permissions');
});