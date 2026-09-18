import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, rmSync, statfsSync } from 'node:fs';
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
export const ARTIFACT_ROOT_KIND = 'artifact';
export const TEMP_ROOT_KIND = 'temp';
// Grounds on which an entry is reported instead of removed.
export const SKIP_OUTSIDE_ROOTS = 'outside-the-allowed-roots';
export const SKIP_ENTRY_IS_LINK = 'entry-is-a-link (never followed)';
export const SKIP_ROOT_IS_LINK = 'root-is-a-link (never followed)';
export const SKIP_LEAVES_ROOT = 'resolves-outside-its-root';
export const SKIP_GONE = 'already-gone';

// Jede Wurzel traegt ihre Einschraenkung selbst; so haengt die Temp-Regel nicht an einem
// Stringvergleich mit dem globalen tmpdir(), der bei einem anderen tempRoot stumm entfiele.
export function resolveAllowedRoots(repoRoot = process.cwd(), tempRoot = tmpdir()) {
    return Object.freeze([
        { path: path.resolve(repoRoot, 'test-results'), requiredPrefix: '', kind: ARTIFACT_ROOT_KIND },
        { path: path.resolve(repoRoot, 'playwright-report'), requiredPrefix: '', kind: ARTIFACT_ROOT_KIND },
        { path: path.resolve(repoRoot, 'tmp', 'playwright'), requiredPrefix: '', kind: TEMP_ROOT_KIND },
        // Contract summaries land in tmp/contract/<timestamp>/ on every run; age them out too.
        { path: path.resolve(repoRoot, 'tmp', 'contract'), requiredPrefix: '', kind: ARTIFACT_ROOT_KIND },
        // Unterhalb des Temp-Ordners gehoert uns nur, was wir selbst angelegt haben.
        { path: path.resolve(tempRoot), requiredPrefix: 'curvios-', kind: TEMP_ROOT_KIND },
    ]);
}

function normalizeRoot(rawRoot) {
    const rootPath = typeof rawRoot === 'string' ? rawRoot : rawRoot?.path;
    return {
        path: path.resolve(String(rootPath || '')),
        requiredPrefix: typeof rawRoot === 'string' ? '' : String(rawRoot?.requiredPrefix || ''),
        kind: typeof rawRoot === 'string' ? ARTIFACT_ROOT_KIND : String(rawRoot?.kind || ARTIFACT_ROOT_KIND),
    };
}

/** True when child sits strictly below parent (path.relative compares case-insensitively on win32). */
function isInside(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function findOwningRoot(absoluteCandidate, allowedRoots) {
    for (const rawRoot of allowedRoots || []) {
        const root = normalizeRoot(rawRoot);
        if (!isInside(root.path, absoluteCandidate)) continue;
        const firstSegment = path.relative(root.path, absoluteCandidate).split(path.sep)[0];
        if (firstSegment.startsWith(root.requiredPrefix)) return root;
    }
    return null;
}

export function isDeletablePath(candidatePath, allowedRoots) {
    const candidate = String(candidatePath || '').trim();
    if (!candidate) return false;
    return Boolean(findOwningRoot(path.resolve(candidate), allowedRoots));
}

function lstatOrNull(targetPath) {
    try {
        return lstatSync(targetPath);
    } catch {
        return null;
    }
}

// Both sides of the containment check go through the same realpathSync. On Windows os.tmpdir()
// may be an 8.3 short name (C:\Users\GUNDAB~1\...), which realpathSync keeps while
// realpathSync.native expands it; switching only one side to .native would refuse every temp entry.
function realpathOrNull(targetPath) {
    try {
        return realpathSync(path.resolve(targetPath));
    } catch {
        return null;
    }
}

/**
 * Letzte Pruefung unmittelbar vor dem Loeschen. Eine Verknuepfung (Symlink oder Junction)
 * wird nie betreten: weder als Eintrag noch als Wurzel. Zusaetzlich muessen Wurzel und
 * Eintrag aufgeloest noch ineinander liegen: das faengt einen Link ZWISCHEN Wurzel und
 * Eintrag ab (wurzel/link/kind). Ein Link OBERHALB der Wurzel ist bewusst erlaubt - beide
 * Seiten laufen durch ihn, und sonst fiele jedes Repo aus, das selbst ueber eine Junction
 * erreicht wird.
 */
export function classifyRemovalTarget(entryPath, allowedRoots) {
    const absolute = path.resolve(String(entryPath || '').trim() || '.');
    const root = findOwningRoot(absolute, allowedRoots);
    if (!root) return { ok: false, reason: SKIP_OUTSIDE_ROOTS };

    const rootStats = lstatOrNull(root.path);
    if (!rootStats) return { ok: false, reason: SKIP_GONE };
    if (rootStats.isSymbolicLink()) return { ok: false, reason: SKIP_ROOT_IS_LINK };

    const entryStats = lstatOrNull(absolute);
    if (!entryStats) return { ok: false, reason: SKIP_GONE };
    if (entryStats.isSymbolicLink()) return { ok: false, reason: SKIP_ENTRY_IS_LINK };

    const realRoot = realpathOrNull(root.path);
    const realEntry = realpathOrNull(absolute);
    if (!realRoot || !realEntry || !isInside(realRoot, realEntry)) {
        return { ok: false, reason: SKIP_LEAVES_ROOT };
    }
    return { ok: true, reason: '', root: root.path };
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
    // Links are the exception, not the rule: they only show up in the line when there are any.
    const skippedRootCount = report?.skippedRoots?.length ?? 0;
    const skippedLinkCount = report?.skippedLinks?.length ?? 0;
    const linkSuffix = (skippedRootCount ? ` skippedRoots=${skippedRootCount}` : '')
        + (skippedLinkCount ? ` skippedLinks=${skippedLinkCount}` : '');
    return `[test:hygiene] freeGb=${toGigabytes(report?.freeBytes) ?? 'unknown'}${tempSuffix} `
        + `staleArtifacts=${report?.staleArtifacts?.length ?? 0} `
        + `staleTempDirs=${report?.staleTempDirs?.length ?? 0} `
        + `orphanElectron=${report?.processes?.orphaned?.length ?? 0} `
        + `worktrees=${report?.worktrees?.length ?? 0}${lockSuffix}${linkSuffix}`;
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
        // lstat, nie stat: eine Junction wird nach sich selbst beurteilt, nicht nach ihrem Ziel.
        const stats = lstatOrNull(entryPath);
        // Ein Eintrag, der gerade verschwindet, ist kein Fehler des Berichts.
        if (!stats) continue;
        entries.push({ path: entryPath, mtimeMs: stats.mtimeMs, isLink: stats.isSymbolicLink() });
    }
    return entries;
}

/**
 * Listet eine Wegwerf-Wurzel auf. Ist die Wurzel selbst eine Verknuepfung, bleibt sie
 * komplett aussen vor - sonst stuende dahinter ein fremder Ordner, dessen Kinder wir
 * rekursiv loeschen wuerden. Verknuepfte Kinder werden gemeldet, nie angefasst.
 */
function listRootEntries(rawRoot) {
    const root = normalizeRoot(rawRoot);
    const rootStats = lstatOrNull(root.path);
    if (!rootStats) return { entries: [], links: [], skippedRoot: null };
    if (rootStats.isSymbolicLink()) {
        return { entries: [], links: [], skippedRoot: { path: root.path, reason: SKIP_ROOT_IS_LINK } };
    }
    const listed = listDirectoryEntries(root.path)
        .filter((entry) => path.basename(entry.path).startsWith(root.requiredPrefix));
    return {
        entries: listed.filter((entry) => !entry.isLink),
        links: listed.filter((entry) => entry.isLink).map((entry) => ({ path: entry.path, reason: SKIP_ENTRY_IS_LINK })),
        skippedRoot: null,
    };
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

export function collectHygieneReport({
    repoRoot = process.cwd(),
    tempRoot = tmpdir(),
    now = Date.now(),
    readProcessList = readElectronProcessList,
    listWorktreePaths = listWorktrees,
} = {}) {
    const allowedRoots = resolveAllowedRoots(repoRoot, tempRoot);
    const artifactEntries = [];
    const tempEntries = [];
    const skippedRoots = [];
    const skippedLinks = [];
    for (const root of allowedRoots) {
        const listing = listRootEntries(root);
        if (listing.skippedRoot) {
            skippedRoots.push(listing.skippedRoot);
            continue;
        }
        skippedLinks.push(...listing.links);
        (root.kind === TEMP_ROOT_KIND ? tempEntries : artifactEntries).push(...listing.entries);
    }
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
        allowedRoots,
        staleArtifacts: selectStaleArtifacts(artifactEntries, now, ARTIFACT_MAX_AGE_DAYS),
        staleTempDirs: selectStaleArtifacts(tempEntries, now, TEMP_MAX_AGE_DAYS),
        skippedRoots,
        skippedLinks,
        processes: classifyElectronProcesses(readProcessList()),
        worktrees: listWorktreePaths(spawnSync, repoRoot),
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

export function applyHygiene(report) {
    const removed = [];
    const skipped = [];
    for (const entry of [...report.staleArtifacts, ...report.staleTempDirs]) {
        const verdict = classifyRemovalTarget(entry.path, report.allowedRoots);
        if (!verdict.ok) {
            console.warn(`[test:hygiene] skipped (${verdict.reason}): ${entry.path}`);
            skipped.push({ path: entry.path, reason: verdict.reason });
            continue;
        }
        try {
            // Nachgemessen auf Node 24 / Windows: rmSync haengt eine enthaltene Junction nur aus,
            // es laeuft nicht in sie hinein - das Ziel behaelt seinen Inhalt.
            rmSync(entry.path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
            removed.push(entry.path);
        } catch (error) {
            console.warn(`[test:hygiene] could not remove ${entry.path}: ${error?.message || error}`);
            skipped.push({ path: entry.path, reason: `error: ${error?.code || error?.message || error}` });
        }
    }

    const killed = [];
    for (const orphan of report.processes.orphaned) {
        if (killOrphanProcess(orphan.pid)) killed.push(orphan.pid);
    }

    return { removed, skipped, killed };
}

function printReport(report) {
    console.log(formatHygieneLine(report));
    for (const entry of report.staleArtifacts) {
        console.log(`  stale artifact (${entry.ageDays} d): ${entry.path}`);
    }
    for (const entry of report.staleTempDirs) {
        console.log(`  stale temp dir (${entry.ageDays} d): ${entry.path}`);
    }
    for (const root of report.skippedRoots || []) {
        console.log(`  root skipped, nothing behind it is touched (${root.reason}): ${root.path}`);
    }
    for (const link of report.skippedLinks || []) {
        console.log(`  entry skipped, left as it is (${link.reason}): ${link.path}`);
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
        `[test:hygiene] removed=${applied.removed.length} skipped=${applied.skipped.length} killed=${applied.killed.length} `
        + `freeGbBefore=${toGigabytes(report.freeBytes) ?? 'unknown'} freeGbAfter=${toGigabytes(freeAfter) ?? 'unknown'}`
    );
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(runTestHygiene());
}
