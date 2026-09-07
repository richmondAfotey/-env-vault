/**
 * Process spawner: the only place secrets cross into a child process.
 *
 * Decrypted variables are merged into the child's environment strictly in
 * memory — they are never written to disk. `stdio: 'inherit'` keeps output
 * interactive, and the child's exit code is propagated to the CLI's exit code.
 */
import { spawn } from 'node:child_process';
import { CommandNotFoundError } from './errors.js';
/**
 * Spawn a command with decrypted secrets merged over the current environment.
 * Resolves with the child's exit code, or rejects on spawn failure.
 */
export function spawnWithEnv(command, args, secrets) {
    return new Promise((resolve, reject) => {
        // `process.env` can contain `undefined` values on some platforms; spawining
        // with them throws, so strip them before merging in the secrets.
        const mergedEnv = { ...process.env };
        for (const [key, value] of Object.entries(secrets)) {
            mergedEnv[key] = value;
        }
        for (const key of Object.keys(mergedEnv)) {
            if (mergedEnv[key] === undefined) {
                delete mergedEnv[key];
            }
        }
        let child;
        try {
            child = spawn(command, args, {
                stdio: 'inherit',
                env: mergedEnv,
            });
        }
        catch (err) {
            reject(err);
            return;
        }
        child.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(new CommandNotFoundError(command));
            }
            else {
                reject(err);
            }
        });
        child.on('exit', (code, signal) => {
            if (code !== null) {
                resolve(code);
            }
            else {
                // Killed by a signal: no useful code; treat as non-zero.
                reject(new Error(`Command was terminated${signal ? ` by signal ${signal}` : ''}.`));
            }
        });
    });
}
