/**
 * Interactive prompts using only the Node standard library (`node:readline`).
 *
 * A single shared readline interface serves every prompt in a process. This
 * matters: creating a fresh interface per prompt causes the first one to
 * buffer piped stdin and drop the next line on close, silently breaking
 * sequential prompts (e.g. `export`'s confirmation followed by the password).
 *
 * `promptPassword` masks input by swapping readline's echo hook to stars (the
 * same technique npm uses). Masking only applies on a real TTY.
 */
import * as readline from 'node:readline';
function isTTY() {
    return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
let shared = null;
/** Answers received but not yet claimed by a question. */
const answers = [];
/** Question resolvers waiting for an answer. */
const waiters = [];
function iface() {
    if (!shared) {
        shared = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: isTTY(),
        });
        // Lines can arrive back-to-back in a single buffered chunk (e.g. piped
        // stdin), so they are queued and dispensed in order — one readline
        // interface serves every prompt in the process.
        shared.on('line', (line) => {
            const respond = waiters.shift();
            if (respond) {
                respond(line);
            }
            else {
                answers.push(line);
            }
        });
        shared.on('SIGINT', () => {
            process.stdout.write('\n');
            process.exit(130);
        });
        // EOF (piped stdin runs dry): resolve any pending prompt with an empty
        // answer instead of hanging the process forever.
        shared.on('close', () => {
            while (waiters.length > 0) {
                const respond = waiters.shift();
                if (respond) {
                    respond('');
                }
            }
        });
    }
    return shared;
}
function readLine(label, masked) {
    const rl = iface();
    // Swap readline's echo hook for this question.
    rl._writeToOutput = masked
        ? (s) => rl.output.write('*'.repeat(s.length))
        : (s) => rl.output.write(s);
    process.stdout.write(label);
    return new Promise((resolve) => {
        const ready = answers.shift();
        if (ready !== undefined) {
            resolve(ready);
        }
        else {
            waiters.push(resolve);
        }
    });
}
/** Prompt for input with echo suppressed. Ctrl+C exits 130. */
export function promptPassword(label) {
    return readLine(label, isTTY());
}
/** Ask a yes/no question; resolves true only for a leading y. */
export function promptConfirm(question) {
    return readLine(question, false).then((answer) => {
        const a = answer.trim().toLowerCase();
        return a === 'y' || a === 'yes';
    });
}
