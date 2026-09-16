import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isProcessAlive, readPlaywrightRunLock, resolvePlaywrightRunLockPath } from './playwright-run-lock.mjs';

// Testlaeufe hinterlassen Ergebnisordner, Temp-Verzeichnisse und abgestuerzte
// Electron-Prozesse. Dieses Werkzeug berichtet standardmaessig nur; geloescht wird
// ausschliesslich unterhalb der bekannten Wegwerf-Wurzeln und nur mit --apply.
export const MIN_FREE_BYTES = 2 * 1024 ** 3;
export const ARTIFACT_MAX_AGE_DAYS = 7;
export const TEMP_MAX_AGE_DAYS = 2;
export const DAY_MS = 86_400_000;
export const ORPHAN_COMMAND_MARKERS = Object.freeze(['--inspect=0', '--remote-debugging-port=0']);

// Jede Wurzel traegt ihre Einschraenkung selbst; so haengt die Temp-Regel nicht an einem
// Stringvergleich mit dem globalen tmpdir(), der bei einem anderen tempRoot stumm entfiele.
export function resolveAllowedRoots(repoRoot = process.cwd(), tempRoot = tmpdir()) {
    return Object.freeze([
        { path: path.resolve(repoRoot, 'test-results'), requiredPrefix: '' },
        { path: path.resolve(repoRoot, 'playwright-report'), requiredPrefix: '' },
        { path: path.resolve(repoRoot, 'tmp', 'playwright'), requiredPrefix: '' },
        { path: path.resolve(repoRoot, 'tmp', 'contract'), requiredPrefix: '' },
        // Unterhalb des Temp-Ordners gehoert uns nur, was wir selbst angelegt haben.
        { path: path.resolve(tempRoot), requiredPrefix: 'curvios-' },
    ]);
}

export function isDeletablePath(candidatePath, allowedRoots) {
    const candidate = String(candidatePath || '').trim();
    if (!candidate) return false;
    const absoluteCandidate = path.resolve(candidate);
    return (allowedRoots || []).some((rawRoot) => {
        const rootPath = typeof rawRoot === 'string' ? rawRoot : rawRoot?.path;
        const requiredPrefix = typeof rawRoot === 'string' ? '' : String(rawRoot?.requiredPrefix || '');
        const root = path.resolve(String(rootPath || ''));
        const relative = path.relative(root, absoluteCandidate);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
        return relative.split(path.sep)[0].startsWith(requiredPrefix);
    });
}

export function selectStaleArtifacts(entries, now = Date.now(), maxAgeDays = ARTIFACT_MAX_AGE_DAYS) {
    const maxAgeMs = Math.max(0, Number(maxAgeDays) || 0) * DAY_MS;
    return (entries || [])
        .filter((entry) => {
            const modifiedAt = Number(entry?.mtimeMs);
            return Number.isFinite(modifiedAt) && now - modifiedAt >= maxAgeMs;
        })
        .map((entry) => ({
            path: String(entry.path),
            ageDays: Math.floor((now - Number(entry.mtimeMs)) / DAY_MS),
        }));
}

function defaultIsProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

export function classifyElectronProcesses(processList, options = {}) {
    const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
    const ownPid = Number(options.ownPid ?? process.pid);
    const orphaned = [];
    const attached = [];
    const ignored = [];

    for (const rawEntry of processList || []) {
        const pid = Number(rawEntry?.pid ?? rawEntry?.ProcessId);
        const parentPid = Number(rawEntry?.parentPid ?? rawEntry?.ParentProcessId);
        const commandLine = String(rawEntry?.commandLine ?? rawEntry?.CommandLine ?? '');
        const entry = { pid, parentPid, commandLine };

        if (!Number.isInteger(pid) || pid <= 0 || pid === ownPid) {
            ignored.push({ ...entry, reason: 'invalid-pid' });
            continue;
        }
        if (!ORPHAN_COMMAND_MARKERS.some((marker) => commandLine.includes(marker))) {
            ignored.push({ ...entry, reason: 'not-a-test-process' });
            continue;
        }
        if (isProcessAlive(parentPid)) {
            attached.push({ ...entry, reason: 'parent-alive' });
            continue;
        }
        orphaned.push({ ...entry, reason: 'parent-gone' });
    }

    return { orphaned, attached, ignored };
}

export function resolveFreeBytes(targetPath, statfs = statfsSync) {
    try {
        const stats = statfs(path.resolve(targetPath));
        return Number(stats.bavail) * Number(stats.bsize);
    } catch {
        return null;
    }
}

export function toGigabytes(bytes) {
    return Number.isFinite(Number(bytes)) ? Math.round((Number(bytes) / 1024 ** 3) * 10) / 10 : null;
}

/** The smaller of two free-space readings; an unknown drive never hides the known one. */
export function minFreeBytes(...values) {
    const known = values.filter((value) => Number.isFinite(Number(value)) && value !== null).map(Number);
    return known.length ? Math.min(...known) : null;
}

/** Report only: a lock file whose holder process is gone (a killed wrapper left it behind). */
export function detectStaleRunLock(lockPath = resolvePlaywrightRunLockPath(), isAlive = isProcessAlive) {
    const holder = readPlaywrightRunLock(lockPath);
    if (!holder) return null;
    return isAlive(holder.pid) ? null : { path: lockPath, pid: Number(holder.pid), label: String(holder.label || '') };
}

export function formatHygieneLine(report) {
    const tempSuffix = Number.isFinite(Number(report?.freeBytesTemp)) && report?.freeBytesTemp !== null
        ? ` freeGbTemp=${toGigabytes(report.freeBytesTemp)}`
        : '';
    const lockSuffix = report?.staleLock ? ' staleLock=1' : '';
    return `[test:hygiene] freeGb=${toGigabytes(report?.freeBytes) ?? 'unknown'}${tempSuffix} `
        + `staleArtifacts=${report?.staleArtifacts?.length ?? 0} `
        + `staleTempDirs=${report?.staleTempDirs?.length ?? 0} `
        + `orphanElectron=${report?.processes?.orphaned?.length ?? 0} `
        + `worktrees=${report?.worktrees?.length ?? 0}${lockSuffix}`;
}

export function assertEnoughFreeSpace(freeBytes, minBytes = MIN_FREE_BYTES) {
    if (freeBytes === null || freeBytes === undefined) {
        return { ok: true, message: '' };
    }
    if (Number(freeBytes) >= Number(minBytes)) {
        return { ok: true, message: '' };
    }
    return {
        ok: false,
        message: `[test:hygiene] only ${toGigabytes(freeBytes)} GB free, need ${toGigabytes(minBytes)} GB `
            + '- run npm run test:hygiene -- --apply before starting the run',
    };
}

function listDirectoryEntries(directoryPath) {
    let names = [];
    try {
        names = readdirSync(directoryPath);
    } catch {
        return [];
    }
    const entries = [];
    for (const name of names) {
        const entryPath = path.join(directoryPath, name);
        try {
            entries.push({ path: entryPath, mtimeMs: statSync(entryPath).mtimeMs });
        } catch {
            // Ein Eintrag, der gerade verschwindet, ist kein Fehler des Berichts.
        }
    }
    return entries;
}

function listCurviosTempEntries(tempRoot) {
    return listDirectoryEntries(tempRoot)
        .filter((entry) => path.basename(entry.path).startsWith('curvios-'));
}

export function readElectronProcessList(spawn = spawnSync, platform = process.platform) {
    if (platform !== 'win32') return [];
    const command = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'electron.exe\' } '
        + '| Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
    const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result?.error || result?.status !== 0) return [];
    try {
        const parsed = JSON.parse(String(result.stdout || '').trim() || 'null');
        if (!parsed) return [];
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

export function listWorktrees(spawn = spawnSync, repoRoot = process.cwd()) {
    const result = spawn('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoRoot,
        encoding: 'utf8',
        windowsHide: true,
    });
    if (result?.error || result?.status !== 0) return [];
    return String(result.stdout || '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);
}

export function collectHygieneReport({ repoRoot = process.cwd(), tempRoot = tmpdir(), now = Date.now() } = {}) {
    const artifactEntries = [
        ...listDirectoryEntries(path.resolve(repoRoot, 'test-results')),
        ...listDirectoryEntries(path.resolve(repoRoot, 'playwright-report')),
        // Contract summaries land in tmp/contract/<timestamp>/ on every run; age them out too.
        ...listDirectoryEntries(path.resolve(repoRoot, 'tmp', 'contract')),
    ];
    const playwrightTempEntries = listDirectoryEntries(path.resolve(repoRoot, 'tmp', 'playwright'));
    const tempEntries = listCurviosTempEntries(tempRoot);
    // The repo may sit on F: while the temp folder (Chromium profiles, recorder scratch) is on C:;
    // the fuller of the two drives is the one that ends a run with ENOSPC.
    const freeBytesRepo = resolveFreeBytes(repoRoot);
    const freeBytesTemp = resolveFreeBytes(tempRoot);

    return {
        repoRoot: path.resolve(repoRoot),
        freeBytes: minFreeBytes(freeBytesRepo, freeBytesTemp),
        freeBytesRepo,
        freeBytesTemp,
        staleLock: detectStaleRunLock(),
        allowedRoots: resolveAllowedRoots(repoRoot, tempRoot),
        staleArtifacts: selectStaleArtifacts(artifactEntries, now, ARTIFACT_MAX_AGE_DAYS),
        staleTempDirs: [
            ...selectStaleArtifacts(playwrightTempEntries, now, TEMP_MAX_AGE_DAYS),
            ...selectStaleArtifacts(tempEntries, now, TEMP_MAX_AGE_DAYS),
        ],
        processes: classifyElectronProcesses(readElectronProcessList()),
        worktrees: listWorktrees(spawnSync, repoRoot),
    };
}

function killOrphanProcess(pid) {
    if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
            stdio: 'ignore',
            windowsHide: true,
        });
        // No SIGKILL fallback on Windows: a failed taskkill almost always means "already gone",
        // and a blind kill would widen the window in which the pid could belong to someone else.
        return !result.error && result.status === 0;
    }
    try {
        process.kill(pid, 'SIGKILL');
        return true;
    } catch {
        return false;
    }
}

function applyHygiene(report) {
    const removed = [];
    for (const entry of [...report.staleArtifacts, ...report.staleTempDirs]) {
        if (!isDeletablePath(entry.path, report.allowedRoots)) {
            console.warn(`[test:hygiene] refused (outside the allowed roots): ${entry.path}`);
            continue;
        }
        try {
            rmSync(entry.path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
            removed.push(entry.path);
        } catch (error) {
            console.warn(`[test:hygiene] could not remove ${entry.path}: ${error?.message || error}`);
        }
    }

    const killed = [];
    for (const orphan of report.processes.orphaned) {
        if (killOrphanProcess(orphan.pid)) killed.push(orphan.pid);
    }

    return { removed, killed };
}

function printReport(report) {
    console.log(formatHygieneLine(report));
    for (const entry of report.staleArtifacts) {
        console.log(`  stale artifact (${entry.ageDays} d): ${entry.path}`);
    }
    for (const entry of report.staleTempDirs) {
        console.log(`  stale temp dir (${entry.ageDays} d): ${entry.path}`);
    }
    for (const orphan of report.processes.orphaned) {
        console.log(`  orphan electron pid=${orphan.pid} parent=${orphan.parentPid} (parent gone)`);
    }
    if (report.staleLock) {
        console.log(`  stale playwright lock (listed only, the next wrapper takes it over): pid=${report.staleLock.pid} ${report.staleLock.label} ${report.staleLock.path}`);
    }
    for (const worktree of report.worktrees) {
        console.log(`  worktree (listed only, never removed): ${worktree}`);
    }
}

export function runTestHygiene(argv = process.argv.slice(2)) {
    const shouldApply = argv.includes('--apply');
    const report = collectHygieneReport();
    printReport(report);

    if (!shouldApply) {
        console.log('[test:hygiene] report only - pass --apply to remove the listed artifacts');
        return 0;
    }

    const applied = applyHygiene(report);
    const freeAfter = minFreeBytes(resolveFreeBytes(report.repoRoot), resolveFreeBytes(tmpdir()));
    console.log(
        `[test:hygiene] removed=${applied.removed.length} killed=${applied.killed.length} `
        + `freeGbBefore=${toGigabytes(report.freeBytes) ?? 'unknown'} freeGbAfter=${toGigabytes(freeAfter) ?? 'unknown'}`
    );
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(runTestHygiene());
}
