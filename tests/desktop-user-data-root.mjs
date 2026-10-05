import path from 'node:path';
import { createHash } from 'node:crypto';

// Ohne eigenen Profilpfad schreiben alle Desktop-Tests in %APPDATA%\curviosclash-app,
// also in dasselbe Verzeichnis wie die echte App des Nutzers. Ein Lauf bekommt deshalb
// einen eigenen Ordner. Darunter bekommt jede Spec-Datei ein eigenes Profil: Specs legen
// Profile an, aendern Spielerzahl, Geraete und Fahrzeuge, und die Menues merken sich das.
// Ein gemeinsames Profil liess solche Reste in fremde Specs lecken (Profilliste,
// Split-Spielerzahl, Geraetezuordnung). Tests derselben Datei teilen das Profil weiter,
// damit aufeinander aufbauende Ablaeufe in einer Datei funktionieren.
// PW_FRESH_PROFILE=1 gibt zusaetzlich jedem einzelnen Test ein eigenes Profil.

const SLUG_MAX_LENGTH = 48;

function slugify(value, fallback) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '') || fallback;
}

export function resolveRunTag(env = {}) {
    // Same slug rule as the cluster runner, so a hand-set tag can never leave tmp/playwright.
    return slugify(env?.PW_RUN_TAG, 'local');
}

/**
 * Stable, short folder name for one spec file. The hash keeps two files with the same
 * basename in different folders apart; the slug keeps the folder readable.
 */
export function resolveSpecProfileSlug(specFile, cwd = process.cwd()) {
    const absolute = String(specFile || '').trim();
    if (!absolute) return 'spec';
    const relative = path.relative(path.resolve(cwd), path.resolve(cwd, absolute)).split(path.sep).join('/');
    const hash = createHash('sha1').update(relative).digest('hex').slice(0, 8);
    const name = slugify(path.posix.basename(relative), 'spec').slice(0, SLUG_MAX_LENGTH);
    return `${name}-${hash}`;
}

export function resolveDesktopUserDataRoot({ env = process.env, cwd = process.cwd(), testInfo = null } = {}) {
    const configuredRoot = String(env?.CURVIOS_USER_DATA_ROOT || '').trim();
    const baseRoot = configuredRoot
        ? path.resolve(configuredRoot)
        : path.resolve(cwd, 'tmp', 'playwright', resolveRunTag(env), 'user-data');
    if (String(env?.PW_FRESH_PROFILE || '').trim() === '1') {
        return path.join(baseRoot, String(testInfo?.testId || 'test'));
    }
    return path.join(baseRoot, resolveSpecProfileSlug(testInfo?.file, cwd));
}
