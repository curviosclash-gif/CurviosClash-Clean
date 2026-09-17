import path from 'node:path';

// Electron-Testlaeufe bekommen ein eigenes Profil (CURVIOS_USER_DATA_ROOT), damit sie
// weder das echte Spielerprofil noch die Profile anderer Sitzungen beschreiben. Der Runner
// löscht Profile nicht: auch ein Pfad unter tmp/playwright kann von einem Aufrufer stammen
// oder noch für Diagnosezwecke gebraucht werden.
const USER_DATA_DIR_NAME = 'user-data';
const PLAYWRIGHT_TMP_SEGMENTS = Object.freeze(['tmp', 'playwright']);

export function resolveClusterUserDataRoot(repoRoot, runTag) {
    const normalizedTag = String(runTag || '').trim() || 'local';
    return path.join(path.resolve(repoRoot), ...PLAYWRIGHT_TMP_SEGMENTS, normalizedTag, USER_DATA_DIR_NAME);
}
