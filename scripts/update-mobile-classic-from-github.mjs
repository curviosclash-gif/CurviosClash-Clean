#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);

function hasFlag(name) {
  return rawArgs.includes(name);
}

function readOption(name, fallback = '') {
  const withEquals = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (withEquals) {
    return withEquals.slice(name.length + 1);
  }
  const index = rawArgs.indexOf(name);
  if (index >= 0 && rawArgs[index + 1] && !rawArgs[index + 1].startsWith('--')) {
    return rawArgs[index + 1];
  }
  return fallback;
}

const remote = String(readOption('--remote', 'origin')).trim() || 'origin';
const requestedBranch = String(readOption('--branch', '')).trim();
const dryRun = hasFlag('--dry-run');
const skipPull = hasFlag('--skip-pull');
const allowNonGithub = hasFlag('--allow-non-github');

function formatCommand(command, args = []) {
  return [command, ...args]
    .map((part) => {
      const text = String(part);
      return /\s/.test(text) ? `"${text}"` : text;
    })
    .join(' ');
}

async function execBuffered(command, args, options = {}) {
  return execFile(command, args, {
    cwd: repoRoot,
    windowsHide: true,
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
  });
}

async function readStdout(command, args, options = {}) {
  const { stdout } = await execBuffered(command, args, options);
  return String(stdout || '').trim();
}

async function runCommand(command, args, options = {}) {
  const label = formatCommand(command, args);
  if (dryRun) {
    process.stdout.write(`[dry-run] ${label}\n`);
    return;
  }
  process.stdout.write(`[run] ${label}\n`);
  const { stdout, stderr } = await execBuffered(command, args, options);
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

async function readGit(args, options = {}) {
  return readStdout('git', args, options);
}

function isGithubRemoteUrl(value = '') {
  const url = String(value || '').trim().toLowerCase();
  return /^https:\/\/github\.com\//.test(url)
    || /^git@github\.com:/.test(url)
    || /^ssh:\/\/git@github\.com\//.test(url);
}

async function ensureGithubRemote() {
  const remoteUrl = await readGit(['config', '--get', `remote.${remote}.url`], {
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (!remoteUrl) {
    throw new Error(`Git remote "${remote}" is not configured.`);
  }
  if (!allowNonGithub && !isGithubRemoteUrl(remoteUrl)) {
    throw new Error(`Git remote "${remote}" is not a GitHub URL. Use --allow-non-github to override.`);
  }
  return remoteUrl;
}

async function resolveBranch() {
  if (requestedBranch) {
    return requestedBranch;
  }
  const branch = await readGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot resolve current branch. Pass --branch <name>.');
  }
  return branch;
}

async function ensureCleanWorkingTree() {
  const status = await readGit(['status', '--porcelain'], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (status) {
    throw new Error('Working tree has uncommitted changes; clean or commit them before pulling from GitHub.');
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: npm run app:classic:android:update:github -- [options]',
    '',
    'Options:',
    '  --remote <name>       Git remote to fetch from (default: origin)',
    '  --branch <name>       Branch to fast-forward from remote/<branch>',
    '  --skip-pull           Build/install the current checkout without fetching',
    '  --allow-non-github    Allow a non-GitHub remote URL',
    '  --dry-run             Print commands without running them',
    '',
  ].join('\n'));
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }

  if (!skipPull) {
    await ensureGithubRemote();
    const branch = await resolveBranch();
    const upstream = `${remote}/${branch}`;
    if (!dryRun) {
      await ensureCleanWorkingTree();
    }
    await runCommand('git', ['fetch', remote], { timeout: 180_000 });
    await runCommand('git', ['merge', '--ff-only', upstream], { timeout: 180_000 });
  }

  await runCommand(process.execPath, [
    path.join(repoRoot, 'scripts', 'capacitor-mobile-classic.mjs'),
    'install',
  ], {
    timeout: 1_200_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

main().catch((error) => {
  if (error.stdout) {
    process.stderr.write(`${error.stdout}\n`);
  }
  if (error.stderr) {
    process.stderr.write(`${error.stderr}\n`);
  }
  process.stderr.write(`mobile-classic-github-update: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
