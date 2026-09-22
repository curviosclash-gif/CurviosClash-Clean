// Ears shut by a close blast: the world goes dull for a few seconds under a faint ring.
// World buses (effects, engines, ambience) pass one low-pass that sits neutral the rest of
// the time; music and ui stay outside it, and the ring bypasses it.

export const MUFFLE_NEUTRAL_HZ = 20000;
const MUFFLED_HZ = 350;          // the dullest a full-strength blast leaves the world
const CRACK_SECONDS = 0.12;      // the bang itself is heard clear before hearing closes
const CLOSE_SECONDS = 0.35;
const RING_HZ = 3900;
const RING_PEAK_GAIN = 0.035;

/**
 * @param {any} ctx AudioContext
 * @param {any[]} buses nodes that carry world sound
 * @param {any} master node the result is mixed into
 */
export function createHearingMuffle(ctx, buses, master) {
    const filter = typeof ctx?.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null;
    if (filter) {
        filter.type = 'lowpass';
        filter.frequency.value = MUFFLE_NEUTRAL_HZ;
        filter.Q.value = 0.7;
        filter.connect(master);
    }
    for (const bus of buses) bus?.connect(filter || master);

    return {
        /**
         * @param {number} intensity 0..1, how close the blast was
         * @param {number} seconds until hearing is back to normal
         */
        trigger(intensity, seconds) {
            const strength = Math.min(1, Math.max(0, Number(intensity) || 0));
            if (!filter || strength <= 0) return;
            const now = ctx.currentTime;
            const end = now + Math.max(CLOSE_SECONDS + 0.5, Number(seconds) || 0);
            // Exponential ramps interpolate in pitch, which is how hearing perceives it.
            const dull = MUFFLE_NEUTRAL_HZ * Math.pow(MUFFLED_HZ / MUFFLE_NEUTRAL_HZ, strength);
            const frequency = filter.frequency;
            frequency.cancelScheduledValues(now);
            frequency.setValueAtTime(frequency.value || MUFFLE_NEUTRAL_HZ, now);
            frequency.setValueAtTime(frequency.value || MUFFLE_NEUTRAL_HZ, now + CRACK_SECONDS);
            frequency.exponentialRampToValueAtTime(dull, now + CLOSE_SECONDS);
            frequency.exponentialRampToValueAtTime(dull * 1.6, now + CLOSE_SECONDS + (end - now) * 0.35);
            frequency.exponentialRampToValueAtTime(MUFFLE_NEUTRAL_HZ, end);

            if (typeof ctx.createOscillator !== 'function') return;
            const ring = ctx.createOscillator();
            const gain = ctx.createGain();
            ring.type = 'sine';
            ring.frequency.value = RING_HZ;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(RING_PEAK_GAIN * strength, now + CLOSE_SECONDS);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);
            ring.connect(gain);
            gain.connect(master);
            ring.start(now);
            ring.stop(end + 0.05);
        },
    };
}
