import { execSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DRY_RUN = process.argv.includes('--dry-run');
const IS_WINDOWS = process.platform === 'win32';

const INCLUDE_PATTERNS = Object.freeze([
    /scripts[\\/]+verify-lock\.mjs/i,
    /@playwright[\\/]+test[\\/]+cli\.js.*\btest-server\b/i,
    /@playwright[\\/]+test[\\/]+cli\.js.*\btest\b/i,
    /\bplaywright\s+test\b/i,
    /node_modules[\\/]+vite[\\/]+bin[\\/]+vite\.js.*--strictPort/i,
    /\bnpx\s+vite\b.*--strictPort/i,
]);

const EXCLUDE_PATTERNS = Object.freeze([
    /@playwright[\\/]+mcp/i,
    /@modelcontextprotocol/i,
]);

const LOCK_FILES = Object.freeze([
    '.playwright-start.lock',
    '.playwright-suite.lock',
    '.playwright-suite.lock.codex',
]);

function toProcessRecord(raw) {
    const pid = Number(raw?.ProcessId || raw?.pid || 0);
    const name = String(raw?.Name || raw?.name || '');
    const commandLine = String(raw?.CommandLine || raw?.commandLine || raw?.cmd || '');
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, name, commandLine };
}

function listWindowsProcesses() {
    const command = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"';
    const raw = String(execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((entry) => toProcessRecord(entry)).filter(Boolean);
}

function listPosixProcesses() {
    const raw = String(execSync('ps -eo pid,comm,args', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '');
    const lines = raw.split(/\r?\n/).slice(1);
    const records = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!match) continue;
        const [, pidRaw, name, cmd] = match;
        const pid = Number(pidRaw);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        records.push({ pid, name, commandLine: cmd });
    }
    return records;
}

function listProcesses() {
    return IS_WINDOWS ? listWindowsProcesses() : listPosixProcesses();
}

function shouldKillProcess(proc) {
    if (!proc || proc.pid === process.pid) return false;
    const commandLine = String(proc.commandLine || '');
    const name = String(proc.name || '');
    const looksLikeNode = /node(\.exe)?/i.test(name) || /node(\.exe)?/i.test(commandLine);
    if (!looksLikeNode) return false;
    if (!commandLine) return false;
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(commandLine))) return false;
    return INCLUDE_PATTERNS.some((pattern) => pattern.test(commandLine));
}

function killProcessTree(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (IS_WINDOWS) {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        return;
    }
    process.kill(pid, 'SIGKILL');
}

async function removeLockFiles() {
    const removed = [];
    for (const lockFile of LOCK_FILES) {
        const fullPath = path.resolve(process.cwd(), lockFile);
        await rm(fullPath, { force: true });
        removed.push(lockFile);
    }
    return removed;
}

function printProcess(proc) {
    return `[pid=${proc.pid}] ${proc.commandLine || proc.name}`;
}

async function main() {
    const allProcesses = listProcesses();
    const targets = allProcesses.filter((proc) => shouldKillProcess(proc));

    console.log(`[test:cleanup] mode=${DRY_RUN ? 'dry-run' : 'apply'}`);
    console.log(`[test:cleanup] detected_targets=${targets.length}`);
    for (const target of targets) {
        console.log(`[test:cleanup] target ${printProcess(target)}`);
    }

    if (!DRY_RUN) {
        for (const target of targets) {
            try {
                killProcessTree(target.pid);
                console.log(`[test:cleanup] killed pid=${target.pid}`);
            } catch (error) {
                console.warn(`[test:cleanup] failed to kill pid=${target.pid}: ${error?.message || error}`);
            }
        }
        const removedLocks = await removeLockFiles();
        console.log(`[test:cleanup] removed_locks=${removedLocks.join(', ')}`);
    }
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
