import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnWithEnv } from '../src/utils/process.js';
import { CommandNotFoundError } from '../src/utils/errors.js';
const MARKER = '__ENVVAULT_TEST__';
afterEach(() => {
    delete process.env[MARKER];
});
test('injects decrypted secrets into the child env and propagates exit code', async () => {
    const code = await spawnWithEnv(process.execPath, ['-e', `if (process.env.INJECTED === "v1") process.exit(7); process.exit(9);`], { INJECTED: 'v1' });
    assert.equal(code, 7);
});
test('secrets override the parent env', async () => {
    process.env[MARKER] = 'parent';
    const code = await spawnWithEnv(process.execPath, ['-e', `if (process.env.${MARKER} === "child") process.exit(0); process.exit(2);`], { [MARKER]: 'child' });
    assert.equal(code, 0);
});
test('rejects with CommandNotFoundError for a missing binary', async () => {
    await assert.rejects(() => spawnWithEnv('env-vault-no-such-binary-xyz', [], {}), CommandNotFoundError);
});
