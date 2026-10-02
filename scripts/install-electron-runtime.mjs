import { realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isNonEmptyFile(filePath) {
    try {
        const file = statSync(filePath);
        return file.isFile() && file.size > 0;
    } catch {
        return false;
    }
}

function resolveRuntimePaths(root, platform) {
    const electronDirectory = path.join(root, 'electron', 'node_modules', 'electron');
    const ffmpegDirectory = path.join(root, 'electron', 'node_modules', 'ffmpeg-static');
    const electronBinary = platform === 'win32'
        ? 'electron.exe'
        : platform === 'darwin'
            ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
            : 'electron';
    const ffmpegBinary = `ffmpeg${platform === 'win32' ? '.exe' : ''}`;

    return {
        electronDirectory,
        ffmpegDirectory,
        electronExecutable: path.join(electronDirectory, 'dist', electronBinary),
        ffmpegExecutable: path.join(ffmpegDirectory, ffmpegBinary),
    };
}

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

export function createElectronRuntimeSetupPlan({
    root = REPO_ROOT,
    platform = process.platform,
    fileIsUsable = isNonEmptyFile,
} = {}) {
    const { electronDirectory, electronExecutable, ffmpegDirectory, ffmpegExecutable } = resolveRuntimePaths(root, platform);
    const commands = [];

    if (!fileIsUsable(electronExecutable)) {
        commands.push({
            command: process.execPath,
            args: [path.join(electronDirectory, 'install.js')],
            label: 'Electron runtime',
        });
    }
    if (platform === 'win32') {
        commands.push({
            command: 'icacls',
            args: [path.join(electronDirectory, 'dist'), '/setintegritylevel', '(OI)(CI)M', '/T', '/Q'],
            label: 'Electron runtime integrity level',
        });
    }
    if (!fileIsUsable(ffmpegExecutable)) {
        commands.push({
            command: process.execPath,
            args: [path.join(ffmpegDirectory, 'install.js')],
            label: 'FFmpeg runtime',
        });
    }

    return {
        commands,
        requiredPaths: [electronExecutable, ffmpegExecutable],
    };
}

export function runElectronRuntimeSetup({
    root = REPO_ROOT,
    platform = process.platform,
    runCommand = (command, args, options) => spawnSync(command, args, options),
    fileIsUsable = isNonEmptyFile,
    log = console.log,
} = {}) {
    const plan = createElectronRuntimeSetupPlan({ root, platform, fileIsUsable });
    for (const step of plan.commands) {
        log(`Setting up ${step.label}...`);
        const result = runCommand(step.command, step.args, {
            cwd: root,
            stdio: 'inherit',
            windowsHide: true,
        });
        if (result.error) {
            return { code: 1, error: `${step.label} failed: ${result.error.message || result.error}` };
        }
        if (result.status !== 0) {
            return { code: Number.isInteger(result.status) ? result.status : 1, error: `${step.label} failed.` };
        }
    }

    const missingPaths = plan.requiredPaths.filter((requiredPath) => !fileIsUsable(requiredPath));
    if (missingPaths.length > 0) {
        return {
            code: 1,
            error: `Required desktop runtime files are missing: ${missingPaths.join(', ')}`,
        };
    }

    return { code: 0, error: null };
}

if (isMainModule(process.argv[1], import.meta.url)) {
    const result = runElectronRuntimeSetup();
    if (result.error) console.error(result.error);
    process.exitCode = result.code;
}
