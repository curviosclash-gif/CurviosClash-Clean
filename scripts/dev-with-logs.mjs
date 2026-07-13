import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const HELP_TEXT = `
Usage:
  npm run dev:logged
  npm run dev:logged -- --host 127.0.0.1 --port 4173

Environment:
  DEV_HOST   Default host (fallback: 127.0.0.1)
  DEV_PORT   Default port (fallback: 4173)
`.trim();

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

function toTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function readOptionValue(args, optionName) {
  const index = args.indexOf(optionName);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) return null;
  return value.trim();
}

function hasFlag(args, ...flags) {
  return flags.some((flag) => args.includes(flag));
}

function sanitizeLogChunk(chunk) {
  const asText = String(chunk ?? '');
  const withoutAnsi = asText.replace(ANSI_ESCAPE_PATTERN, '');
  return withoutAnsi.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

const cliArgs = process.argv.slice(2);
if (hasFlag(cliArgs, '-h', '--help')) {
  process.stdout.write(`${HELP_TEXT}\n`);
  process.exit(0);
}

const resolvedHost = (
  readOptionValue(cliArgs, '--host')
  || String(process.env.DEV_HOST || '').trim()
  || '127.0.0.1'
);

const resolvedPort = (
  readOptionValue(cliArgs, '--port')
  || String(process.env.DEV_PORT || '').trim()
  || '4173'
);

const logDirectory = path.resolve(process.cwd(), 'tmp', 'dev-logs');
const timestamp = toTimestampForFilename();
const runId = `vite-dev-${resolvedPort}-${timestamp}`;
const stdoutPath = path.resolve(logDirectory, `${runId}.out.log`);
const stderrPath = path.resolve(logDirectory, `${runId}.err.log`);
const metadataPath = path.resolve(logDirectory, `${runId}.meta.json`);
const viteBinPath = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

await mkdir(logDirectory, { recursive: true });

const metadata = {
  runId,
  host: resolvedHost,
  port: resolvedPort,
  startedAt: new Date().toISOString(),
  command: ['vite', '--host', resolvedHost, '--port', resolvedPort, '--strictPort'],
  cwd: process.cwd(),
  logFiles: {
    stdout: path.relative(process.cwd(), stdoutPath),
    stderr: path.relative(process.cwd(), stderrPath),
  },
};

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

const stdoutStream = createWriteStream(stdoutPath, { flags: 'a' });
const stderrStream = createWriteStream(stderrPath, { flags: 'a' });

const forwardedArgs = [
  viteBinPath,
  '--host',
  resolvedHost,
  '--port',
  resolvedPort,
  '--strictPort',
  ...cliArgs,
];

const child = spawn(process.execPath, forwardedArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FORCE_COLOR: process.env.FORCE_COLOR || '0',
    NO_COLOR: process.env.NO_COLOR || '1',
  },
  stdio: ['inherit', 'pipe', 'pipe'],
});

process.stdout.write(`[dev:logged] out=${path.relative(process.cwd(), stdoutPath)}\n`);
process.stdout.write(`[dev:logged] err=${path.relative(process.cwd(), stderrPath)}\n`);

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  stdoutStream.write(sanitizeLogChunk(chunk));
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  stderrStream.write(sanitizeLogChunk(chunk));
});

let signalForwarded = false;
function forwardSignal(signal) {
  if (signalForwarded) return;
  signalForwarded = true;
  child.kill(signal);
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  stdoutStream.end();
  stderrStream.end();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
