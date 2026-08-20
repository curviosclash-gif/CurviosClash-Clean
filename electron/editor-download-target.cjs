const path = require('node:path');
const { existsSync } = require('node:fs');

const EDITOR_DOWNLOAD_EXTENSIONS = new Set(['.json']);
// Pfadtrenner und Windows-Sonderzeichen. Als Codepoint-Liste statt als
// Zeichenklasse, weil ein maskierter Backslash in einer Regex leicht still
// verlorengeht und die Absicherung dann wirkungslos waere.
const UNSAFE_FILE_NAME_CODES = new Set(
    ['<', '>', ':', '"', '/', '|', '?', '*']
        .map((character) => character.charCodeAt(0))
        .concat([0x5c])
);
const HIGHEST_CONTROL_CODE = 0x1f;
const LEADING_NOISE = /^[.\s-]+/;
const MAX_NAME_ATTEMPTS = 50;

/**
 * Macht aus einer beliebigen Vorgabe einen einzelnen, sicheren Dateinamen.
 * Trennzeichen werden zu Bindestrichen, bevor der Name als Pfad gelesen werden
 * kann; damit kann ein Download den Zielordner nicht verlassen.
 * @param {string} rawName
 * @returns {string}
 */
function sanitizeDownloadFileName(rawName) {
    const flattened = [...String(rawName || '').trim()]
        .map((character) => (
            UNSAFE_FILE_NAME_CODES.has(character.charCodeAt(0))
            || character.charCodeAt(0) <= HIGHEST_CONTROL_CODE
                ? '-'
                : character
        ))
        .join('');
    const cleaned = path.basename(flattened).replace(LEADING_NOISE, '');
    return cleaned || 'export.json';
}

/**
 * Sucht einen freien Dateinamen im Zielordner: "name.json", "name (2).json", ...
 * @param {string} directory
 * @param {string} fileName
 * @returns {string}
 */
function resolveFreeTargetPath(directory, fileName) {
    const extension = path.extname(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    let candidate = path.join(directory, fileName);
    for (let attempt = 2; existsSync(candidate) && attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
        candidate = path.join(directory, `${stem} (${attempt})${extension}`);
    }
    return candidate;
}

/**
 * Gibt Downloads aus den Autorenwerkzeugen ein festes Ziel im Download-Ordner.
 *
 * Ohne gesetzten Zielpfad bleibt ein Blob-Download in Electron im Zustand
 * "pending" haengen und hinterlaesst nur eine namenlose .tmp-Datei. Betroffen
 * sind ausschliesslich Fenster aus `isTrustedEditorUrl` und nur die dort
 * erzeugten JSON-Exporte; alles andere behaelt das Standardverhalten.
 *
 * @param {object} downloadSession Electron-Session
 * @param {object} options
 * @param {(url: string) => boolean} options.isTrustedEditorUrl
 * @param {() => string} options.getDownloadsDirectory
 * @param {(entry: object) => void} [options.onCompleted]
 * @returns {() => void} Abmeldefunktion
 */
function installEditorDownloadTarget(downloadSession, {
    isTrustedEditorUrl,
    getDownloadsDirectory,
    onCompleted,
} = {}) {
    const handler = (event, item, webContents) => {
        let sourceUrl = '';
        try {
            sourceUrl = webContents?.getURL?.() || '';
        } catch {
            sourceUrl = '';
        }
        if (!sourceUrl || !isTrustedEditorUrl(sourceUrl)) return;

        const fileName = sanitizeDownloadFileName(item.getFilename());
        if (!EDITOR_DOWNLOAD_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return;

        let targetPath = '';
        try {
            targetPath = resolveFreeTargetPath(getDownloadsDirectory(), fileName);
            item.setSavePath(targetPath);
        } catch {
            // Ohne gueltigen Zielordner bleibt der Standardweg mit Dialog.
            return;
        }

        item.once('done', (doneEvent, state) => {
            onCompleted?.({ state, savePath: item.getSavePath() || targetPath, fileName });
        });
    };

    downloadSession.on('will-download', handler);
    return () => downloadSession.removeListener('will-download', handler);
}

module.exports = {
    installEditorDownloadTarget,
    resolveFreeTargetPath,
    sanitizeDownloadFileName,
};
