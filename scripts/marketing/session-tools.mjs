import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

export const root = path.resolve(import.meta.dirname, '../..');
const requireElectron = createRequire(path.join(root, 'electron/package.json'));
export const electron = requireElectron('electron');
export const ffmpeg = process.env.FFMPEG_PATH || requireElectron('ffmpeg-static') || 'ffmpeg';
export const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

// Matroska supplies complete packets and timestamps. Bypass redundant parser
// duration inference (FFmpeg 8.0's Opus parser reports an error on empty EOF
// flush; fixed upstream in 618fc15e65). The actual decoders still run strictly.
export function sourceDecodeArgs(file) {
    return ['-v', 'error', '-xerror', '-err_detect', 'explode', '-fflags', '+noparse+nofillin',
        '-i', file, '-fps_mode', 'passthrough', '-enc_time_base:v', '1:1000', '-f', 'null', '-'];
}

export function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...options.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(command, args, { cwd: root, windowsHide: true, ...options, env,
            stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-2_000_000); });
        child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2_000_000); });
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve({ stdout, stderr })
            : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.slice(-3000)}`)));
    });
}

export async function hashFile(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

export async function hashBuild(directory) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
    const hash = createHash('sha256');
    for (const file of files) hash.update(path.relative(directory, file)).update(await hashFile(file));
    return hash.digest('hex');
}
