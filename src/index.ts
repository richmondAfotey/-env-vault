#!/usr/bin/env node
/**
 * env-vault — encrypted .env profile manager.
 *
 * Entry point: routes commands, parses options with the zero-dependency
 * `node:util` parser, and maps errors to clean messages + exit codes.
 */
import * as fs from 'node:fs';
import { parseArgs } from 'node:util';
import { exportCommand } from './commands/export.js';
import { init } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { setCommand } from './commands/set.js';
import { switchCommand } from './commands/switch.js';
import { DEFAULT_PROFILE } from './storage/vault.js';
import { UsageError, VaultError } from './utils/errors.js';

const OPTIONS = {
  profile: { type: 'string' },
  out: { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

function usage(): string {
  return `env-vault — encrypted .env profile manager

Usage: env-vault <command> [options]

Commands:
  init                            Create .envvault/, safe .gitignore rules, and .env.example
  set KEY=VALUE [--profile name]  Encrypt a value into a profile (default: development)
  switch <profile>                Set the active profile used by run/export
  run -- <command> [args...]      Run a command with the profile injected in-memory
  export [--profile name] --out <file> [--force]
                                  Write a plain-text copy of a profile (legacy debugging)

Options:
  --profile <name>  Which profile to operate on
  --out <file>      Output file path (export)
  --force           Skip the export plain-text warning (data to disk!)
  -h, --help        Show this help
  -v, --version     Print version

Examples:
  env-vault init
  env-vault set DATABASE_URL=postgres://prod:5432/db --profile production
  env-vault switch production
  env-vault run -- npm start
  env-vault export --profile development --out .env.local --force`;
}

/**
 * `run` passes EVERYTHING after `--` to the child verbatim, so it is handled
 * before option parsing to avoid parseArgs choking on flags like `-e`.
 */
function splitAtDoubleDash(argv: string[]): { before: string[]; after: string[] } {
  const idx = argv.indexOf('--');
  if (idx === -1) {
    return { before: argv, after: [] };
  }
  return { before: argv.slice(0, idx), after: argv.slice(idx + 1) };
}

/** Injected at bundle time by scripts/bundle.mjs; absent in the tsc build. */
declare const __ENV_VAULT_VERSION__: string | undefined;

function readVersion(): string {
  // SEA binaries don't ship package.json on disk, so prefer the build-time
  // embedded version. `typeof` keeps this safe when the constant is not
  // defined (e.g. the uncompiled tsc build).
  if (typeof __ENV_VAULT_VERSION__ === 'string' && __ENV_VAULT_VERSION__) {
    return `env-vault ${__ENV_VAULT_VERSION__}`;
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return `env-vault ${pkg.version ?? 'unknown'}`;
  } catch {
    return 'env-vault unknown';
  }
}

async function main(argv: string[]): Promise<number> {
  // `run` fast path: keep the post-`--` slice verbatim.
  if (argv[0] === 'run') {
    return runCommand(splitAtDoubleDash(argv).after);
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (values.version) {
    console.log(readVersion());
    return 0;
  }

  const command = positionals[0];

  switch (command) {
    case undefined:
      if (argv.length === 0) {
        console.log(usage());
        return 0;
      }
      throw new UsageError('No command given. Run `env-vault --help` for usage.');
    case 'init':
      init();
      return 0;
    case 'set': {
      const pair = positionals[1];
      if (!pair) {
        throw new UsageError('Usage: env-vault set KEY=VALUE [--profile name]');
      }
      await setCommand(pair, values.profile ?? DEFAULT_PROFILE);
      return 0;
    }
    case 'switch': {
      const profile = positionals[1];
      if (!profile) {
        throw new UsageError('Usage: env-vault switch <profile>');
      }
      switchCommand(profile);
      return 0;
    }
    case 'export':
      await exportCommand({
        profile: values.profile,
        out: values.out,
        force: values.force,
      });
      return 0;
    default:
      throw new UsageError(
        `Unknown command '${command}'. Run \`env-vault --help\` for usage.`,
      );
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof VaultError) {
      console.error(`env-vault: ${err.message}`);
    } else if (err instanceof Error && /Unknown option/i.test(err.message)) {
      console.error(`env-vault: ${err.message}`);
      console.error('Run `env-vault --help` for usage.');
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });