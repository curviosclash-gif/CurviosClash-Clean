'use strict';

const path = require('node:path');
const fsPromises = require('node:fs/promises');

/**
 * Folder FFmpeg writes its intermediate video into.
 *
 * An FFmpeg binary that inherits a low integrity label - every file in a checkout that a
 * sandbox marked low does - runs as a low integrity process on Windows and may only create
 * files in low integrity folders. Next to the user's chosen target (Videos, Documents) it
 * fails with "Permission denied". %USERPROFILE%\AppData\LocalLow is the folder Windows keeps
 * writable for such processes, so the encoder works there and the medium integrity main
 * process moves the finished file to its target. Other platforms keep the given fallback.
 *
 * @param {{ getPath?: (name: string) => string }} app
 * @param {{ platform?: string, fallback?: string }} [options]
 * @returns {string}
 */
function resolveEncoderStagingDirectory(app, { platform = process.platform, fallback = '' } = {}) {
    if (platform !== 'win32') return fallback;
    let home = '';
    try {
        home = String(app?.getPath?.('home') || '');
    } catch {
        home = '';
    }
    return home ? path.join(home, 'AppData', 'LocalLow', 'CurviosClash', 'export') : fallback;
}

/**
 * Moves a staged file to its target. A rename is atomic on one volume; across volumes
 * (LocalLow on C:, target elsewhere) the file is copied next to the target first and then
 * renamed, so the target never holds a half-written video.
 * @param {string} stagedPath
 * @param {string} targetPath
 * @param {{ rename: Function, copyFile: Function, rm: Function, mkdir: Function }} [fsImpl]
 */
async function publishStagedFile(stagedPath, targetPath, fsImpl = fsPromises) {
    await fsImpl.mkdir(path.dirname(targetPath), { recursive: true });
    try {
        await fsImpl.rename(stagedPath, targetPath);
        return;
    } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
    }
    const partPath = `${targetPath}.part`;
    try {
        await fsImpl.copyFile(stagedPath, partPath);
        await fsImpl.rename(partPath, targetPath);
    } catch (error) {
        await fsImpl.rm(partPath, { force: true }).catch(() => {});
        throw error;
    }
    await fsImpl.rm(stagedPath, { force: true }).catch(() => {});
}

module.exports = { resolveEncoderStagingDirectory, publishStagedFile };
