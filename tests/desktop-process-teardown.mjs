import { spawnSync } from 'node:child_process';

// Der Abbau der Desktop-Harness haengt regelmaessig: `app.close()` kehrt nicht zurueck
// und Playwright bricht erst nach dem Test-Timeout ab ("Tearing down exceeded 240000ms").
// Deshalb bekommt der Abbau ein eigenes, kurzes Zeitbudget und danach einen harten Kill.
export const DEFAULT_TEARDOWN_DEADLINE_MS = 20000;
export const FORCED_KILL_EXIT_GRACE_MS = 5000;
export const RENDER_TAG = '@render';

export function resolveShowWindow(env = {}, titlePath = []) {
    if (String(env?.PW_SHOW_WINDOW || '').trim() === '1') return true;
    // Same reading as electron/main.cjs: anything set that is not '0' shows the window, so a
    // value like 'true' that used to work keeps working instead of silently hiding it (1 fps).
    const electronSwitch = String(env?.CURVIOS_ELECTRON_SHOW_WINDOW ?? '').trim();
    if (electronSwitch && electronSwitch !== '0') return true;
    const titles = Array.isArray(titlePath) ? titlePath : [titlePath];
    return titles.some((entry) => String(entry || '').includes(RENDER_TAG));
}

// Ein `show: false`-Fenster bekommt von Windows rund ein Bild pro Sekunde. Solange
// niemand ausdruecklich ein sichtbares Fenster verlangt, starten Testlaeufe deshalb
// im Render-Modus: gezeigt, aber weit ausserhalb des Bildschirms und ohne Fokus.
export function resolveTestRenderMode(env = {}) {
    // Notschalter, falls eine Umgebung (z. B. CI ohne echten Bildschirm) damit nicht klarkommt.
    if (String(env?.PW_TEST_RENDER || '').trim() === '0') return 'off';
    if (String(env?.PW_SHOW_WINDOW || '').trim() === '1') return 'off';
    const electronSwitch = String(env?.CURVIOS_ELECTRON_SHOW_WINDOW ?? '').trim();
    if (electronSwitch && electronSwitch !== '0') return 'off';
    return 'inactive';
}

// `electron/main.cjs` beantwortet jedes Schliessen des Hauptfensters mit einem
// Handschlag: Es schickt 'request-graceful-close' und wartet bis zu 30 s auf
// 'graceful-close-ready'. Diese Antwort kommt nur vom laufenden Spiel
// (`src/core/AppInitializerLifecycle.js` veroeffentlicht `GAME_INSTANCE` und
// haengt im selben Schritt die Shell-Bruecke an). Tests, die das Hauptfenster per
// `page.goto` auf das Vehicle Lab, den 3D-Karteneditor oder die Hangar-Seite
// schicken, lassen niemanden zurueck, der antworten kann -- `app.close()` laeuft
// dann in die Abbaufrist und der Prozess wird hart beendet.
export function shouldForceDesktopWindowTeardown({
    pageClosed = false,
    gameInstancePresent = null,
    probeError = null,
} = {}) {
    // Nur eine gelesene Seite ohne Spiel rechtfertigt das Ueberspringen; bei
    // Unwissen (nicht gelesen, Lesefehler, geschlossene Seite) bleibt der
    // bisherige Weg samt Frist bestehen.
    if (pageClosed) return false;
    if (probeError) return false;
    return gameInstancePresent === false;
}

// Laeuft per `electronApp.evaluate` im Electron-Hauptprozess und macht genau das,
// was die Shell nach ihrer eigenen Frist ohnehin tut (`finish({ force: true })`):
// `destroy()` statt `close()`, also ohne Handschlag und ohne `beforeunload`-Sperre
// des Editors. Danach greift der normale Ausstieg (`window-all-closed` -> `app.quit`).
// Playwright serialisiert die Funktion per toString(): keine Closures, keine Importe.
export function destroyAllElectronWindows({ BrowserWindow }) {
    const windows = BrowserWindow.getAllWindows();
    let destroyed = 0;
    for (const browserWindow of windows) {
        if (browserWindow?.isDestroyed?.() === true) continue;
        browserWindow.destroy();
        destroyed += 1;
    }
    return destroyed;
}

export function isProcessRunning(childProcess) {
    if (!childProcess) return false;
    return childProcess.exitCode === null && !childProcess.signalCode;
}

// Windows kennt keine Signale: nur `taskkill /T` beendet auch die Renderer- und
// GPU-Kindprozesse von Electron. SIGKILL bleibt der Notnagel fuer alles andere.
export function forceKillProcess(childProcess, platform = process.platform) {
    const pid = Number(childProcess?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (platform === 'win32') {
        const result = spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
            stdio: 'ignore',
            windowsHide: true,
        });
        if (!result.error && result.status === 0) return true;
    }
    try {
        childProcess.kill('SIGKILL');
        return true;
    } catch {
        return false;
    }
}

export function waitForProcessExit(childProcess, timeoutMs = FORCED_KILL_EXIT_GRACE_MS) {
    if (!isProcessRunning(childProcess)) return Promise.resolve(true);
    return new Promise((resolve) => {
        let settled = false;
        const finish = (exited) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            childProcess.removeListener('exit', onExit);
            resolve(exited);
        };
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(!isProcessRunning(childProcess)), timeoutMs);
        timer.unref?.();
        childProcess.once('exit', onExit);
    });
}

export async function closeElectronAppWithDeadline({
    app,
    childProcess = null,
    deadlineMs = DEFAULT_TEARDOWN_DEADLINE_MS,
    exitGraceMs = FORCED_KILL_EXIT_GRACE_MS,
    now = () => Date.now(),
    killProcess = forceKillProcess,
} = {}) {
    const startedAt = now();
    let closeError = null;
    let deadlineTimer = null;

    const closePromise = (async () => {
        try {
            await app?.close?.();
        } catch (error) {
            closeError = String(error?.message || error || 'close_failed');
        }
        return 'closed';
    })();
    const deadlinePromise = new Promise((resolve) => {
        deadlineTimer = setTimeout(() => resolve('deadline'), deadlineMs);
        deadlineTimer.unref?.();
    });

    const outcome = await Promise.race([closePromise, deadlinePromise]);
    clearTimeout(deadlineTimer);

    if (outcome !== 'deadline') {
        return {
            forcedKill: false,
            killed: false,
            exited: !isProcessRunning(childProcess),
            afterMs: Math.max(0, now() - startedAt),
            deadlineMs,
            closeError,
        };
    }

    const killed = isProcessRunning(childProcess) ? killProcess(childProcess) : false;
    const exited = await waitForProcessExit(childProcess, exitGraceMs);

    return {
        forcedKill: true,
        killed,
        exited,
        afterMs: Math.max(0, now() - startedAt),
        deadlineMs,
        closeError,
    };
}
