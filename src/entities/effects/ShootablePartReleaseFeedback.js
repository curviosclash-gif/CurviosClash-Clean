import { resolveWorldAudioOptions } from '../audio/WorldAudioOptions.js';

// A release older than this is a replica catching up (a late join, a reset), not a hit anyone
// just saw; puffing all of them at once would be noise, not feedback.
const FRESH_RELEASE_SECONDS = 0.5;

// World-unit tufts sized to the parts: a pappus crown is tens of units across, a kernel a few.
const TUFTS = Object.freeze({
    dandelionSeeds: Object.freeze({ count: 18, color: 0xf5f1dc, speed: 22, size: 2.4, life: 1.6, gravity: -1.2 }),
    sunflowerKernels: Object.freeze({ count: 10, color: 0x6b4a2b, speed: 7, size: 0.7, life: 0.9, gravity: -6 }),
});

/**
 * Seen and heard feedback for one shot-off seed or kernel. Runs on host and replica alike,
 * because both release the part through the same controller path.
 * @param {any} owner Entity manager: arena clock, particles and audio.
 * @param {{ x: number, y: number, z: number }} position World position, read at once.
 * @param {number} atSeconds Map second the part was released.
 * @param {string} source 'dandelionSeeds' or 'sunflowerKernels'.
 * @returns {boolean} Whether feedback was emitted.
 */
export function emitShootablePartReleaseFeedback(owner, position, atSeconds, source) {
    if (!position) return false;
    const now = Number(owner?.arena?.glbAnimationElapsedSeconds) || 0;
    if (now - (Number(atSeconds) || 0) > FRESH_RELEASE_SECONDS) return false;
    const tuft = TUFTS[source] || TUFTS.dandelionSeeds;
    owner?.particles?.spawn?.(position, tuft.count, tuft.color, tuft.speed, tuft.size, tuft.life, {
        gravity: tuft.gravity,
        type: 'shootable-part-release',
    });
    owner?.audio?.play?.('SEED_PUFF', resolveWorldAudioOptions(owner, position));
    return true;
}
