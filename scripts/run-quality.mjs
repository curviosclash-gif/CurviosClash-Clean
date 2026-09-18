import { spawn as spawnChild, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Das vollstaendige Gate. Aufruf: `npm run quality`, Abbruch nach roter Phase 1 mit
// `node scripts/run-quality.mjs --fail-fast`, `npm run quality -- fail-fast` oder
// CURVIOS_QUALITY_FAIL_FAST=1.
//
// Die Aufgabenliste steht nur hier. Sie ersetzt die frühere `&&`-Kette in package.json;
// jede Prüfung von damals ist weiter dabei (tests/run-quality.contract.test.mjs haelt das fest).
// Phase 1 haengt nicht voneinander ab und laeuft nebeneinander, Phase 2 bleibt seriell:
// die Contract-Laeufe nehmen sich selbst schon fast alle Kerne.
// Reihenfolge in Phase 1 ist Startreihenfolge: die beiden langen zuerst (lint ~9 s,
// typecheck:architecture ~11 s), damit sie sich ueberlappen statt nacheinander zu warten.
export const QUALITY_TASKS = [
    { name: 'lint', script: 'lint', phase: 1 },
    { name: 'typecheck:architecture', script: 'typecheck:architecture', phase: 1 },
    { name: 'council:check', script: 'council:check', phase: 1 },
    { name: 'typecheck:contracts', script: 'typecheck:contracts', phase: 1 },
    { name: 'check:architecture', script: 'check:architecture', phase: 1 },
    { name: 'check:parcours', script: 'check:parcours', phase: 1 },
    { name: 'test:contract:coverage', script: 'test:contract:coverage', phase: 2 },
    { name: 'test:dev:training', script: 'test:dev:training', phase: 2 },
    { name: 'test:contract:dist', script: 'test:contract:dist', phase: 2 },
];

// Der Rechner hat 6 Kerne. eslint und tsc nehmen sich selbst mehr als einen, deshalb ist
// die Grenze 3 und nicht 6: darueber verdraengen sich die Aufgaben gegenseitig.
export const QUALITY_PHASE1_LIMIT = 3;

const TASK_NAME_COLUMN = 24;

// npm 12 lehnt unbekannte Flags auch hinter `--` ab (EUNKNOWNCONFIG), reicht aber
// Positionsargumente durch. Deshalb zaehlt `fail-fast` genauso wie `--fail-fast`, und
// CURVIOS_QUALITY_FAIL_FAST=1 wirkt dort, wo gar keine Argumente ankommen.
export function parseQualityArgs(argv = [], env = process.env) {
    let failFast = /^(?:1|true|yes)$/i.test(String(env?.CURVIOS_QUALITY_FAIL_FAST ?? '').trim());
    for (const value of argv) {
        const argument = String(value);
        if (argument === '--fail-fast' || argument === 'fail-fast') {
            failFast = true;
            continue;
        }
        throw new Error(`Unbekanntes Argument: ${argument} (bekannt ist nur --fail-fast)`);
    }
    return { failFast };
}

export function selectPhaseTasks(phase, tasks = QUALITY_TASKS) {
    return tasks.filter((task) => task.phase === phase);
}

// npm run setzt npm_execpath auf npm-cli.js. Wird dieses Skript direkt mit `node` gestartet,
// fehlt die Variable - dann liegt npm neben der node-Binary (Windows) bzw. eine Ebene
// darueber in lib/ (POSIX). Eine .cmd-Datei wird bewusst verworfen: Node weigert sich seit
// der Batch-Injection-Luecke, .cmd ohne shell zu starten, und shell:true mit
// zusammengesetzten Zeichenketten ist genau das, was hier nicht passieren soll.
export function resolveNpmCliPath(env = process.env, execPath = process.execPath, fileExists = existsSync) {
    const fromEnv = String(env?.npm_execpath || '').trim();
    if (/\.(?:js|cjs|mjs)$/i.test(fromEnv)) return fromEnv;

    const nodeDirectory = path.dirname(execPath);
    const candidates = [
        path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    const found = candidates.find((candidate) => fileExists(candidate));
    if (found) return found;
    throw new Error(`npm-cli.js nicht gefunden (gesucht: ${candidates.join(', ')}); starte das Gate ueber npm run quality.`);
}

export function resolveNpmRunArgs(scriptName, {
    env = process.env,
    execPath = process.execPath,
    fileExists = existsSync,
} = {}) {
    return {
        command: execPath,
        args: [resolveNpmCliPath(env, execPath, fileExists), 'run', scriptName],
    };
}

function toSeconds(durationMs) {
    return `${(Math.max(0, Number(durationMs) || 0) / 1000).toFixed(1)}s`;
}

export function formatTaskLines(results) {
    return results.map((result) => {
        const status = result.status === 'ok' ? 'ok' : (result.status === 'failed' ? 'FAILED' : 'skipped');
        const duration = result.status === 'skipped' ? '-' : toSeconds(result.durationMs);
        return `[quality] ${String(result.name).padEnd(TASK_NAME_COLUMN)} ${status.padEnd(8)} ${duration}`;
    });
}

// Letzte Zeile des Laufs und bewusst maschinenlesbar, wie [contract:summary] und
// [playwright:summary]. failedTasks bleibt leer, wenn nichts rot war.
export function formatQualitySummaryLine(results, durationMs) {
    const countOf = (status) => results.filter((result) => result.status === status).length;
    const failedTasks = results.filter((result) => result.status === 'failed').map((result) => result.name);
    return `[quality:summary] passed=${countOf('ok')} failed=${countOf('failed')} skipped=${countOf('skipped')}`
        + ` durationMs=${Math.round(Number(durationMs) || 0)} failedTasks=${failedTasks.join(',')}`;
}

// Gruen ist nur, was nachweislich gruen war: ein leerer Lauf, ein uebersprungener Lauf oder
// ein unbekannter Status duerfen das Gate nicht bestehen. `skipped` entsteht nur nach roter
// Phase 1, dort ist der Lauf ohnehin rot.
export function resolveQualityExitCode(results) {
    return results.length > 0 && results.every((result) => result.status === 'ok') ? 0 : 1;
}

// Entscheidung: Phase 2 laeuft auch nach roter Phase 1. Ein Lauf soll alle Befunde auf
// einmal zeigen; die alte Kette brach beim ersten Fehler ab und verlangte so viele Laeufe,
// wie es Fehler gab. Wer den schnellen Abbruch will (CI, kurze Schleife), nimmt --fail-fast:
// nach roter Phase 1 spart das die teuren Contract-Laeufe samt dist-Build.
export function shouldRunSecondPhase(phaseOneResults, { failFast = false } = {}) {
    if (!failFast) return true;
    return !phaseOneResults.some((result) => result.status === 'failed');
}

function skippedResult(task) {
    return { name: task.name, status: 'skipped', code: null, durationMs: 0 };
}

// Feste Zahl an Arbeitern statt Nachruecken per Zaehler: mehr als `limit` Aufgaben koennen
// so gar nicht erst starten, und die Liste wird von vorne abgearbeitet (lange zuerst).
export async function runTasksWithLimit(tasks, runTask, limit = QUALITY_PHASE1_LIMIT) {
    const results = new Array(tasks.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < tasks.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = await runTask(tasks[index]);
            } catch (error) {
                // Ein Wurf darf die anderen Arbeiter nicht mitreissen, sonst haengt die Phase.
                results[index] = {
                    name: tasks[index].name,
                    status: 'failed',
                    code: null,
                    durationMs: 0,
                    error: String(error?.message || error),
                };
            }
        }
    };

    const workerCount = Math.max(1, Math.min(Number(limit) || 1, tasks.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

// Phase 1 puffert und druckt am Stueck, sonst mischen drei gleichzeitige eslint-/tsc-Ausgaben
// ihre Zeilen. Phase 2 reicht direkt durch (stdio inherit), damit ein langer Lauf sichtbar
// bleibt statt minutenlang stumm zu sein.
export function createTaskRunner({
    spawn = spawnChild,
    env = process.env,
    execPath = process.execPath,
    fileExists = existsSync,
    log = console.log,
    now = () => Date.now(),
    activeChildren = new Set(),
} = {}) {
    return (task) => new Promise((resolve) => {
        const startedAt = now();
        const buffered = task.phase === 1;
        let settled = false;
        let spawnError = null;
        const chunks = [];

        const finish = (code) => {
            if (settled) return;
            settled = true;
            const status = !spawnError && code === 0 ? 'ok' : 'failed';
            const durationMs = now() - startedAt;
            const header = `[quality] ${task.name} - ${status === 'ok' ? 'ok' : 'FAILED'} in ${toSeconds(durationMs)}`;
            const body = chunks.join('').replace(/\s+$/, '');
            if (buffered) log(body ? `${header}\n${body}` : header);
            else log(header);
            resolve({
                name: task.name,
                status,
                code: typeof code === 'number' ? code : null,
                durationMs,
                ...(spawnError ? { error: spawnError } : {}),
            });
        };

        let child;
        try {
            const { command, args } = resolveNpmRunArgs(task.script, { env, execPath, fileExists });
            if (!buffered) log(`[quality] ${task.name} - running`);
            child = spawn(command, args, {
                stdio: buffered ? ['ignore', 'pipe', 'pipe'] : 'inherit',
                env,
                windowsHide: true,
            });
        } catch (error) {
            spawnError = String(error?.message || error);
            chunks.push(`${spawnError}\n`);
            finish(null);
            return;
        }

        activeChildren.add(child);
        // Ohne festes Encoding wird jeder Puffer einzeln umgewandelt; ein Umlaut oder das
        // eslint-Kreuz, das auf einer Chunk-Grenze liegt, kaeme als Ersatzzeichen an.
        child.stdout?.setEncoding?.('utf8');
        child.stderr?.setEncoding?.('utf8');
        child.stdout?.on('data', (chunk) => chunks.push(String(chunk)));
        child.stderr?.on('data', (chunk) => chunks.push(String(chunk)));
        child.on('error', (error) => {
            // ENOENT meldet sich ueber 'error'; ein 'close' folgt nicht zwingend, deshalb
            // wird hier sofort abgeschlossen statt auf ein zweites Ereignis zu warten.
            spawnError = String(error?.message || error);
            chunks.push(`${spawnError}\n`);
            activeChildren.delete(child);
            finish(null);
        });
        child.on('close', (code) => {
            activeChildren.delete(child);
            finish(typeof code === 'number' ? code : null);
        });
    });
}

export async function runQuality(argv = [], {
    runTask,
    log = console.log,
    now = () => Date.now(),
    tasks = QUALITY_TASKS,
    limit = QUALITY_PHASE1_LIMIT,
    env = process.env,
} = {}) {
    const { failFast } = parseQualityArgs(argv, env);
    const startedAt = now();
    const phaseOneTasks = selectPhaseTasks(1, tasks);
    const phaseTwoTasks = selectPhaseTasks(2, tasks);

    const phaseOneStartedAt = now();
    const phaseOneResults = await runTasksWithLimit(phaseOneTasks, runTask, limit);
    const phaseOneMs = now() - phaseOneStartedAt;
    const phaseOneSerialMs = phaseOneResults.reduce((total, result) => total + (Number(result.durationMs) || 0), 0);
    log(`[quality] phase 1 done in ${toSeconds(phaseOneMs)} (serial would be ${toSeconds(phaseOneSerialMs)})`);

    const runPhaseTwo = shouldRunSecondPhase(phaseOneResults, { failFast });
    if (!runPhaseTwo) log('[quality] --fail-fast: phase 1 was red, phase 2 is skipped');
    const phaseTwoResults = runPhaseTwo
        ? await runTasksWithLimit(phaseTwoTasks, runTask, 1)
        : phaseTwoTasks.map(skippedResult);

    const results = [...phaseOneResults, ...phaseTwoResults];
    for (const line of formatTaskLines(results)) log(line);
    log(formatQualitySummaryLine(results, now() - startedAt));
    return resolveQualityExitCode(results);
}

// Ein Vergleich der URL-Zeichenketten scheitert, sobald der Ordner hinter einer Junction, einem
// Symlink oder einem subst-Laufwerk liegt: Node loest import.meta.url auf den echten Pfad auf,
// argv[1] aber nicht. Das Gate liefe dann gar nicht und endete still mit Exit 0.
export function isMainModule(entryPath, moduleUrl, {
    realpath = realpathSync,
    platform = process.platform,
} = {}) {
    if (!entryPath) return false;
    const resolve = (value) => {
        try {
            return realpath(value);
        } catch {
            return path.resolve(value);
        }
    };
    const normalize = (value) => (platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));
    return normalize(entryPath) === normalize(fileURLToPath(moduleUrl));
}

// Windows kennt keine Signale: child.kill() beendet dort nur den npm-Prozess, eslint, tsc,
// der Node-Testlauf oder ein Vite-Build darunter liefen weiter. Nur taskkill /T nimmt den
// ganzen Baum mit (siehe tests/desktop-process-teardown.mjs).
export function stopChildTree(child, { platform = process.platform, spawnSyncFn = spawnSync } = {}) {
    const pid = Number(child?.pid);
    if (platform === 'win32' && Number.isInteger(pid) && pid > 0) {
        const result = spawnSyncFn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        if (!result?.error && result?.status === 0) return;
    }
    try {
        child?.kill?.();
    } catch {
        // Der Prozess war schon weg; das Beenden der uebrigen darf daran nicht scheitern.
    }
}

if (isMainModule(process.argv[1], import.meta.url)) {
    const activeChildren = new Set();
    // Strg+C erreicht in einer Konsole meist die ganze Prozessgruppe; wird der Runner aber von
    // aussen beendet, blieben die Kindprozesse sonst als Waisen zurueck.
    const stop = (signal) => {
        for (const child of activeChildren) stopChildTree(child);
        process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));

    try {
        // exitCode statt exit(): eine lange rote Ausgabe wird unter Windows asynchron
        // geschrieben, ein harter Exit koennte die Summenzeile abschneiden.
        process.exitCode = await runQuality(process.argv.slice(2), { runTask: createTaskRunner({ activeChildren }) });
    } catch (error) {
        console.error(error?.message || error);
        process.exitCode = 2;
    }
}
