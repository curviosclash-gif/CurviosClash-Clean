import path from 'node:path';

// Electron-Testlaeufe bekommen ein eigenes Profil (CURVIOS_USER_DATA_ROOT), damit sie
// weder das echte Spielerprofil noch die Profile anderer Sitzungen beschreiben. Die
// Aufraeumregel bleibt bewusst eng: geloescht wird nur ein echter Unterordner von
// <repo>/tmp/playwright/, niemals dieser Ordner selbst und nichts ausserhalb.
const USER_DATA_DIR_NAME = 'user-data';
const PLAYWRIGHT_TMP_SEGMENTS = Object.freeze(['tmp', 'playwright']);

export function resolveClusterUserDataRoot(repoRoot, runTag) {
    const normalizedTag = String(runTag || '').trim() || 'local';
    return path.join(path.resolve(repoRoot), ...PLAYWRIGHT_TMP_SEGMENTS, normalizedTag, USER_DATA_DIR_NAME);
}

export function resolveRemovableUserDataRoot(candidatePath, repoRoot) {
    const candidate = String(candidatePath || '').trim();
    if (!candidate) return null;
    const absoluteCandidate = path.resolve(candidate);
    const playwrightRoot = path.join(path.resolve(repoRoot), ...PLAYWRIGHT_TMP_SEGMENTS);
    const relative = path.relative(playwrightRoot, absoluteCandidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }
    return absoluteCandidate;
}
