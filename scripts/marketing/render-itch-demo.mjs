import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = process.cwd();
const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
let bundledFfmpeg;
try {
    bundledFfmpeg = requireElectron('ffmpeg-static');
} catch {
    // The system FFmpeg is enough when Electron dependencies are unavailable.
}
const ffmpeg = process.env.FFMPEG_PATH || bundledFfmpeg || 'ffmpeg';
const manifestPath = process.argv[2] && path.resolve(process.argv[2]);
const outputDir = process.argv[3] && path.resolve(process.argv[3]);
const formats = [
    { name: 'landscape', width: 1920, height: 1080, captionSize: 53, captionY: 'h-text_h-90' },
    { name: 'portrait', width: 1080, height: 1920, captionSize: 64, captionY: 'h-text_h-240' },
];

function fail(message) {
    throw new Error(`[marketing:render] ${message}`);
}

function seconds(value, name, min = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < min || numeric > 120) fail(`${name} must be ${min}–120 seconds`);
    return numeric;
}

function textValue(value, name, maxLength = 90) {
    const valueText = String(value || '').trim();
    if (!valueText || valueText.length > maxLength || /[\r\n]/.test(valueText)) {
        fail(`${name} must be one line with 1–${maxLength} characters`);
    }
    return valueText;
}

async function readManifest(filename) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
        fail(`cannot read manifest: ${error.message}`);
    }
    if (!Array.isArray(parsed.shots) || parsed.shots.length < 1 || parsed.shots.length > 12) {
        fail('manifest needs 1–12 shots');
    }
    const shots = await Promise.all(parsed.shots.map(async (shot, index) => {
        const file = path.resolve(path.dirname(filename), textValue(shot.file, `shots[${index}].file`, 500));
        await access(file).catch(() => fail(`video file does not exist: ${file}`));
        const start = seconds(shot.start, `shots[${index}].start`);
        const duration = seconds(shot.duration, `shots[${index}].duration`, 0.5);
        if (duration > 15) fail(`shots[${index}].duration must be at most 15 seconds`);
        const stillAt = shot.stillAt === undefined
            ? start + duration * 0.65
            : seconds(shot.stillAt, `shots[${index}].stillAt`);
        if (stillAt < start || stillAt > start + duration) {
            fail(`shots[${index}].stillAt must fall inside the selected shot`);
        }
        return {
            file,
            start,
            duration,
            stillAt,
            caption: textValue(shot.caption, `shots[${index}].caption`, 65),
            audio: shot.audio === true,
        };
    }));
    if (shots.reduce((sum, shot) => sum + shot.duration, 0) > 90) fail('total shot duration must be at most 90 seconds');
    const coverShot = Number.isInteger(parsed.coverShot) ? parsed.coverShot : 0;
    if (coverShot < 0 || coverShot >= shots.length) fail('coverShot is outside the shot list');
    return {
        shots,
        coverShot,
        title: textValue(parsed.title || 'CURVIOSCLASH', 'title', 35),
        callToAction: textValue(parsed.callToAction || 'DEMO ON ITCH.IO', 'callToAction', 55),
    };
}

function runFfmpeg(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...args], {
            cwd,
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let errors = '';
        child.stderr.on('data', (chunk) => { errors += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg exited ${code}: ${errors.trim()}`));
        });
    });
}

function captionFilter(textFile, format) {
    return `drawtext=font=Arial:textfile=${textFile}:fontcolor=white:fontsize=${format.captionSize}`
        + `:box=1:boxcolor=0x071522@0.82:boxborderw=24:x=(w-text_w)/2:y=${format.captionY}`;
}

function videoFilter(format, captionFile) {
    return `fps=30,scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,`
        + `pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2:color=0x071522,setsar=1,`
        + captionFilter(captionFile, format);
}

function portraitFilter(captionFile, format) {
    return '[0:v]fps=30,split=2[front-source][back-source];'
        + '[back-source]scale=360:640:force_original_aspect_ratio=increase,'
        + 'crop=360:640,boxblur=18:1,scale=1080:1920[back];'
        + '[front-source]scale=1080:-2,setsar=1[front];'
        + '[back][front]overlay=(W-w)/2:(H-h)/2,'
        + captionFilter(captionFile, format) + '[video]';
}

async function renderShot(shot, index, format, directory) {
    const number = String(index + 1).padStart(2, '0');
    const segment = `segments/${format.name}-${number}.mp4`;
    const captionFile = `captions/${number}.txt`;
    const args = ['-ss', String(shot.start), '-i', shot.file];
    if (!shot.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    if (format.name === 'portrait') {
        args.push('-filter_complex', portraitFilter(captionFile, format));
    } else {
        args.push('-vf', videoFilter(format, captionFile));
    }
    args.push(
        '-t', String(shot.duration), '-map', format.name === 'portrait' ? '[video]' : '0:v:0',
        '-map', shot.audio ? '0:a:0' : '1:a:0',
        '-af', 'aresample=async=1:first_pts=0,apad',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', segment,
    );
    await runFfmpeg(args, directory);
    return segment;
}

async function renderEndCard(format, directory) {
    const segment = `segments/${format.name}-end.mp4`;
    const titleSize = format.name === 'portrait' ? 91 : 112;
    const ctaSize = format.name === 'portrait' ? 53 : 62;
    const filters = [
        `drawtext=font=Arial:textfile=captions/title.txt:fontcolor=white:fontsize=${titleSize}:x=(w-text_w)/2:y=(h-text_h)/2-105`,
        `drawtext=font=Arial:textfile=captions/cta.txt:fontcolor=0x76e7ff:fontsize=${ctaSize}:x=(w-text_w)/2:y=(h-text_h)/2+75`,
    ].join(',');
    await runFfmpeg([
        '-f', 'lavfi', '-i', `color=c=0x071522:s=${format.width}x${format.height}:r=30:d=2.5`,
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t', '2.5', '-vf', filters, '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', segment,
    ], directory);
    return segment;
}

async function concatSegments(segments, format, directory) {
    const listFile = `segments/${format.name}-list.txt`;
    await writeFile(path.join(directory, listFile), segments.map((segment) => (
        `file '${path.basename(segment)}'`
    )).join('\n') + '\n');
    await runFfmpeg([
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c', 'copy', '-movflags', '+faststart', `curviosclash-${format.name}.mp4`,
    ], directory);
}

async function renderStill(shot, index, directory) {
    const name = `screenshots/scene-${String(index + 1).padStart(2, '0')}.png`;
    await runFfmpeg([
        '-ss', String(shot.stillAt), '-i', shot.file,
        '-frames:v', '1', '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,setsar=1', name,
    ], directory);
    return name;
}

async function renderCover(shot, directory) {
    await runFfmpeg([
        '-ss', String(shot.stillAt), '-i', shot.file,
        '-i', path.join(root, 'assets', 'branding', 'curviosclash-icon.png'),
        '-frames:v', '1', '-filter_complex', [
            '[0:v]scale=630:358:force_original_aspect_ratio=decrease,',
            'pad=630:358:(ow-iw)/2:(oh-ih)/2:color=0x071522,',
            'pad=630:500:0:142:color=0x071522[background];',
            '[1:v]scale=110:110[logo];',
            '[background][logo]overlay=x=16:y=16,',
            'drawtext=font=Arial:textfile=captions/title.txt:fontcolor=white:fontsize=51:x=140:y=24,',
            'drawtext=font=Arial:textfile=captions/demo.txt:fontcolor=0x76e7ff:fontsize=30:x=143:y=87[cover]',
        ].join(''),
        '-map', '[cover]',
        'itch-cover-630x500.png',
    ], directory);
}

if (!manifestPath || !outputDir) {
    fail('usage: node scripts/marketing/render-itch-demo.mjs <manifest.json> <new-output-directory>');
}
const manifest = await readManifest(manifestPath);
await runFfmpeg(['-version'], root);
await mkdir(path.dirname(outputDir), { recursive: true });
await mkdir(outputDir).catch((error) => {
    if (error?.code === 'EEXIST') fail(`output directory already exists: ${outputDir}`);
    throw error;
});
await mkdir(path.join(outputDir, 'captions'), { recursive: true });
await mkdir(path.join(outputDir, 'segments'), { recursive: true });
await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });
await Promise.all(manifest.shots.map((shot, index) => writeFile(
    path.join(outputDir, 'captions', `${String(index + 1).padStart(2, '0')}.txt`),
    `${shot.caption}\n`,
)));
await writeFile(path.join(outputDir, 'captions', 'title.txt'), `${manifest.title}\n`);
await writeFile(path.join(outputDir, 'captions', 'cta.txt'), `${manifest.callToAction}\n`);
await writeFile(path.join(outputDir, 'captions', 'demo.txt'), 'WINDOWS DEMO\n');
for (const format of formats) {
    const segments = [];
    for (const [index, shot] of manifest.shots.entries()) {
        segments.push(await renderShot(shot, index, format, outputDir));
    }
    segments.push(await renderEndCard(format, outputDir));
    await concatSegments(segments, format, outputDir);
    console.log(`[marketing:render] ${format.name} video ready`);
}
for (const [index, shot] of manifest.shots.entries()) await renderStill(shot, index, outputDir);
await renderCover(manifest.shots[manifest.coverShot], outputDir);
console.log(`[marketing:render] Media saved to ${outputDir}`);
