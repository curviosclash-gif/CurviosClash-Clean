import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, ffmpeg, ffprobe, sourceDecodeArgs } from './session-tools.mjs';

function srtTime(seconds) {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export async function exportSessionMedia({ folder, source, candidate }) {
    const subtitles = candidate.captions.map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
    await writeFile(path.join(folder, 'captions.srt'), subtitles, { flag: 'wx' });
    // Relative subtitle path avoids drive-letter/filter escaping on Windows.
    await run(ffmpeg, ['-hide_banner', '-v', 'warning', '-n', '-i', 'picture.mp4', '-ss', String(candidate.startMs / 1000),
        '-fflags', '+noparse+nofillin', '-i', source, '-map', '0:v:0', '-map', '1:a:0',
        '-t', String((candidate.endMs - candidate.startMs) / 1000), '-vf',
        "subtitles=captions.srt:force_style='Fontname=Arial,Fontsize=18,Outline=2,MarginV=45'",
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', '60', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', 'video.mp4'], { cwd: folder });
    const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(folder, 'video.mp4')])).stdout);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    const duration = (candidate.endMs - candidate.startMs) / 1000;
    if (video?.width !== 1080 || video.height !== 1920 || video.codec_name !== 'h264'
        || video.avg_frame_rate !== '60/1' || audio?.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000
        || ![video.nb_frames, video.duration, video.start_time, audio.duration, audio.start_time]
            .every((value) => value != null && Number.isFinite(Number(value)))
        || Math.abs(Number(video.nb_frames) - duration * 60) > 1
        || Math.abs(Number(video.duration) - duration) > 1 / 30
        || Math.abs(Number(audio.duration) - Number(video.duration)) > 0.05
        || Math.abs(Number(audio.start_time) - Number(video.start_time)) > 0.05) throw new Error('export_metadata_failed');
    const decoded = await run(ffmpeg, sourceDecodeArgs(path.join(folder, 'video.mp4')));
    if (decoded.stderr.trim()) throw new Error('final_media_decode_failed');
    const diagnostics = await run(ffmpeg, ['-hide_banner', '-xerror', '-i', path.join(folder, 'video.mp4'),
        '-vf', 'blackdetect=d=0.1:pix_th=0.1,freezedetect=n=-50dB:d=0.1',
        '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
    await writeFile(path.join(folder, 'diagnostics.txt'), diagnostics.stderr, { flag: 'wx' });
    if (/black_start:|freeze_start:/.test(diagnostics.stderr)) throw new Error('black_or_frozen_frames');
    const peaks = [...diagnostics.stderr.matchAll(/Peak level dB:\s*(-?[\d.]+|-inf)/g)].map((match) => Number(match[1]));
    if (!peaks.length || !peaks.every((peak) => Number.isFinite(peak) && peak < -0.5 && peak > -60)) {
        throw new Error('audio_silent_clipped_or_unmeasurable');
    }
    await run(ffmpeg, ['-v', 'error', '-ss', '1', '-i', path.join(folder, 'video.mp4'), '-frames:v', '1', path.join(folder, 'cover.png')]);
    return probe;
}
