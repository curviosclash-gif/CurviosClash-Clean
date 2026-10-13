const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const MAX_SESSION_BYTES = 8 * 1024 ** 3;
const MAX_SESSION_DURATION_MS = 90 * 60 * 1000;
const MIN_FREE_BYTES = 1024 ** 3;
const STORAGE_CHECK_INTERVAL_MS = 5000;

// All destinations are chosen by the launcher, never by a renderer IPC payload.
async function createMarketingSessionStore({ directory, ffmpeg, metadata = {}, spawnProcess = spawn }) {
    await fs.mkdir(directory, { recursive: false });
    const journal = await fs.open(path.join(directory, 'journal.ndjson'), 'wx');
    let media = null;
    let segmenter = null;
    let exited = Promise.resolve({ error: 'segmenter_not_started' });
    const manifest = { version: 'marketing-session.v1', ...metadata, status: 'recording',
        startedAt: new Date().toISOString(), modelCalls: 0, bytes: 0, records: 0, errors: [] };
    let chain = Promise.resolve();
    let closed = false;
    let sequence = 0;
    let journalHash = '';
    let lastStorageCheckAt = 0;
    const startedAtMs = Date.now();
    const mediaHash = createHash('sha256');
    let stderr = '';
    const publish = async () => {
        const temp = path.join(directory, 'session.json.tmp');
        const file = await fs.open(temp, 'w');
        try { await file.writeFile(JSON.stringify(manifest, null, 2)); await file.sync(); }
        finally { await file.close(); }
        await fs.rename(temp, path.join(directory, 'session.json'));
    };
    try {
        media = await fs.open(path.join(directory, 'original.webm.partial'), 'wx');
        segmenter = spawnProcess(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-i', 'pipe:0',
            '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'segment', '-segment_time', '4',
            '-reset_timestamps', '1', path.join(directory, 'segment-%06d.mkv')],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        segmenter.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
        segmenter.stdin.on('error', () => {});
        exited = new Promise((resolve) => {
            segmenter.once('error', (error) => resolve({ error: error.message }));
            segmenter.once('close', (code) => resolve({ code }));
        });
        await publish();
    } catch (error) {
        if (segmenter) {
            try { segmenter.stdin.end(); } catch {}
            const stopped = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 1000))]);
            if (!stopped) segmenter.kill();
        }
        await Promise.allSettled([journal.close(), media?.close()]);
        throw error;
    }
    async function checkStorageBudget() {
        const now = Date.now();
        if (now - lastStorageCheckAt < STORAGE_CHECK_INTERVAL_MS) return;
        const entries = await fs.readdir(directory, { withFileTypes: true });
        let storedBytes = 0;
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            storedBytes += (await fs.stat(path.join(directory, entry.name))).size;
        }
        if (storedBytes > MAX_SESSION_BYTES) throw new Error('recording_session_quota_reached');
        const space = await fs.statfs(directory);
        if (Number(space.bavail) * Number(space.bsize) < MIN_FREE_BYTES) {
            throw new Error('recording_disk_reserve_reached');
        }
        lastStorageCheckAt = now;
    }
    function enqueue(operation) {
        const result = chain.then(operation);
        chain = result.catch((error) => { manifest.errors.push(error.message); });
        return result;
    }
    return {
        directory,
        append(payload) {
            if (closed) return Promise.reject(new Error('session_closed'));
            return enqueue(async () => {
                if (Date.now() - startedAtMs > MAX_SESSION_DURATION_MS) throw new Error('recording_session_duration_limit');
                await checkStorageBudget();
                if (payload.sequence !== sequence) throw new Error('session_sequence_gap');
                if (!['media', 'records'].includes(payload.kind)) throw new Error('invalid_batch_kind');
                if (payload.kind === 'media') {
                    if (!payload.bytes || !Number.isInteger(payload.bytes.byteLength)
                        || payload.bytes.byteLength < 1 || payload.bytes.byteLength > 16 * 1024 * 1024) throw new Error('invalid_media_batch');
                    const bytes = Buffer.from(payload.bytes || []);
                    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('invalid_media_batch');

                    await media.writeFile(bytes);
                    await media.sync();
                    mediaHash.update(bytes);
                    manifest.bytes += bytes.length;
                    await new Promise((resolve, reject) => segmenter.stdin.write(bytes,
                        (error) => error ? reject(error) : resolve()));
                } else {
                    if (!Array.isArray(payload.records) || payload.records.length > 1000) throw new Error('invalid_record_batch');
                    const body = JSON.stringify(payload.records);
                    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error('record_batch_too_large');
                    const hash = createHash('sha256').update(journalHash).update(body).digest('hex');
                    await journal.writeFile(JSON.stringify({ sequence, previous: journalHash, hash, records: payload.records }) + '\n');
                    await journal.sync();
                    journalHash = hash;
                    manifest.records += payload.records.length;
                }
                sequence++;
                return { accepted: true, sequence };
            });
        },
        finish(status = 'complete', details = {}) {
            if (closed) return chain;
            closed = true;
            return enqueue(async () => {
                segmenter.stdin.end();
                let timer;
                const result = await Promise.race([exited, new Promise((resolve) => {
                    timer = setTimeout(() => { segmenter.kill(); resolve({ error: 'segmenter_timeout' }); }, 10000);
                })]);
                clearTimeout(timer);
                if (result.code !== 0) manifest.errors.push(result.error || `segmenter_failed:${stderr}`);
                await journal.close(); await media.close();
                manifest.mediaSha256 = mediaHash.digest('hex');
                manifest.journalSha256 = journalHash;
                manifest.endedAt = new Date().toISOString();
                manifest.status = manifest.errors.length ? 'partial' : status;
                manifest.details = details;
                if (manifest.status === 'complete') {
                    await fs.rename(path.join(directory, 'original.webm.partial'), path.join(directory, 'original.webm'));
                }
                await publish();
                return manifest;
            });
        },
    };
}
module.exports = { createMarketingSessionStore };
