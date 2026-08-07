// PostToolUse hook: lint a single edited file under src/ right after the edit.
// Catches max-lines, boundaries and innerHTML violations while the context is fresh
// instead of at the next `npm run lint`.
// Exit 2 = blocking error, stderr is fed back to Claude. Any other failure stays silent.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ESLINT_BIN = path.join('node_modules', 'eslint', 'bin', 'eslint.js');

function readStdin() {
    return new Promise((resolve) => {
        let raw = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { raw += chunk; });
        process.stdin.on('end', () => resolve(raw));
        process.stdin.on('error', () => resolve(''));
    });
}

const raw = await readStdin();
let payload = null;
try {
    payload = JSON.parse(raw);
} catch {
    process.exit(0);
}

const filePath = String(
    payload?.tool_input?.file_path
    || payload?.tool_response?.filePath
    || ''
).trim();
if (!filePath) process.exit(0);

const relative = path.relative(process.cwd(), filePath).split(path.sep).join('/');
if (relative.startsWith('..')) process.exit(0);
if (!relative.startsWith('src/') || !relative.endsWith('.js')) process.exit(0);
if (!existsSync(ESLINT_BIN)) process.exit(0);

const result = spawnSync(process.execPath, [ESLINT_BIN, relative, '--max-warnings', '0'], {
    encoding: 'utf8',
    windowsHide: true,
});
if (result.error || result.status === 0) process.exit(0);

process.stderr.write(`eslint failed for ${relative}:\n${result.stdout || ''}${result.stderr || ''}`);
process.exit(2);
