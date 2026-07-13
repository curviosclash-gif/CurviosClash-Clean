import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

async function readLockFile(lockPath) {
    try {
        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export default async function globalTeardown() {
    const lockPath = path.resolve(
        process.cwd(),
        String(process.env.PW_SUITE_LOCK_PATH || process.env.PW_LOCK_PATH || '.playwright-suite.lock')
    );
    const ownerToken = String(process.env.PW_SUITE_LOCK_OWNER || '').trim();
    if (!ownerToken) return;

    const lockPayload = await readLockFile(lockPath);
    if (lockPayload?.ownerToken && lockPayload.ownerToken !== ownerToken) {
        return;
    }
    await rm(lockPath, { force: true });
    console.log(`[PlaywrightIsolation] lock released: ${lockPath}`);
}

