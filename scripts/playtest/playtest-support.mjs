// Pure helpers of the autonomous playtest driver. No Playwright, no Electron, so a
// contract test can load them in plain Node.
import { timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const PLAYTEST_TOKEN_HEADER = 'x-playtest-token';

// Console noise that says nothing about the game: Chromium autofill and DevTools chatter,
// the missing favicon, and the meta-CSP note about frame-ancestors.
const NOISE_PATTERN = /Autofill|DevTools|favicon|frame-ancestors/i;

/** Output folder for profiles, shots and results; one per day unless CURVIOS_PLAYTEST_OUT is set. */
export function resolvePlaytestOutDir(env = process.env, now = new Date(), tmpDir = os.tmpdir()) {
    const explicit = String(env?.CURVIOS_PLAYTEST_OUT || '').trim();
    if (explicit) return path.resolve(explicit);
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, '0'))
        .join('');
    return path.join(tmpDir, `curvios-playtest-${day}`);
}

/** A file name that is safe on Windows and still readable in a report. */
export function sanitizeShotName(name) {
    const cleaned = String(name || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned || 'shot';
}

/** Path length flown across samples of the form { pos: [x, y, z] | null }. */
export function distanceTravelled(samples) {
    let distance = 0;
    for (let index = 1; index < (samples?.length || 0); index += 1) {
        const from = samples[index - 1]?.pos;
        const to = samples[index]?.pos;
        if (!from || !to) continue;
        distance += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
    return Math.round(distance);
}

/** Deaths seen as an alive -> dead step between consecutive samples. */
export function countDeaths(samples) {
    let deaths = 0;
    for (let index = 1; index < (samples?.length || 0); index += 1) {
        if (samples[index - 1]?.alive === true && samples[index]?.alive === false) deaths += 1;
    }
    return deaths;
}

/** Errors recorded at or after sinceMs, without known console noise. */
export function filterPlaytestErrors(errors, sinceMs = 0) {
    return (errors || []).filter((entry) => entry.at >= sinceMs && !NOISE_PATTERN.test(entry.text));
}

/**
 * The control server runs code it receives, so it only answers a POST that carries the
 * session token and no Origin header. A web page in a browser always sends Origin on a
 * cross-site POST and cannot read the token, so it can never drive the game.
 */
export function isAuthorizedPlaytestRequest(request, token) {
    if (!request || request.method !== 'POST') return false;
    const headers = request.headers || {};
    if (headers.origin !== undefined) return false;
    const presented = String(headers[PLAYTEST_TOKEN_HEADER] || '');
    const expected = String(token || '');
    if (!expected || presented.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
