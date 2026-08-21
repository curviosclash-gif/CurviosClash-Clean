// A chain reaction is several deaths, not one sound repeating. The 200 ms
// explosion cooldown swallowed every kill that landed inside the window of the
// previous one, so a triple kill sounded exactly like a single one - the loudest
// thing that can happen in a round was also the least informative. Dropping the
// cooldown is not the answer either: a mass wipe would turn into noise, and the
// voice limiter would cut the tail of it off anyway. So the cooldown stays and
// the first few blocked blasts come back as quieter, detuned echoes instead.
//
// The explosion voice itself lives here too, because it is the only sound whose
// shape now depends on where it sits in a chain.

// Extra blasts allowed inside one cooldown window. Three explosions per fifth of
// a second reads as a chain; beyond that it turns to mush.
const MAX_CHAIN_ECHOES = 2;

// Fixed rather than random, so a chain sounds the same every time and reads as
// one recognisable event instead of an audio glitch. Detuning down and then up
// keeps each blast distinct from the first and from each other, and the falling
// gain keeps the original kill the loudest one.
const ECHO_SHAPES = Object.freeze([
    Object.freeze({ chainDetune: 0.88, chainGain: 0.72 }),
    Object.freeze({ chainDetune: 1.14, chainGain: 0.58 }),
]);

export function createExplosionChainState() {
    return { echoes: 0 };
}

/**
 * Answers a blast the cooldown would otherwise drop.
 *
 * @param {{echoes: number}|null} state - Chain state, advanced on success.
 * @returns {{chainDetune: number, chainGain: number}|null} Null once the chain is
 *   spent, which means silence really is the right answer for this one.
 */
export function resolveExplosionEcho(state) {
    if (!state) return null;
    const used = Math.max(0, Math.trunc(Number(state.echoes) || 0));
    const shape = used < MAX_CHAIN_ECHOES ? ECHO_SHAPES[used] : null;
    if (!shape) return null;
    state.echoes = used + 1;
    return shape;
}

export function resetExplosionChain(state) {
    if (state) state.echoes = 0;
}

// Absent or nonsensical values resolve to an untouched blast, so a plain
// explosion and a rocket impact are unaffected by any of this.
function resolveEchoShape(options) {
    const detune = Number(options?.chainDetune);
    const gain = Number(options?.chainGain);
    return {
        detune: Number.isFinite(detune) && detune > 0 ? detune : 1,
        gain: Number.isFinite(gain) && gain > 0 ? gain : 1,
    };
}

/**
 * Plays the explosion voice on the given AudioManager. Taking the manager as a
 * parameter keeps the voice graph, the limiter and the envelope helpers in one
 * place instead of duplicating them here.
 *
 * @param {object} audio - The AudioManager.
 * @param {object} [options] - Play options, including any chain echo shape.
 */
export function playExplosionVoice(audio, options = {}) {
    if (!audio?.buffers?.explosion) return;
    const echo = resolveEchoShape(options);
    const intensity = audio._intensity(options, 1, 0.25, 1.5) * echo.gain;
    const atten = audio._distanceAttenuation(options);
    const recordedRate = 1 + ((echo.detune - 1) * 0.35);
    const playedRecording = audio._playRecordedSample?.('explosionHeavy', {
        duration: 1.9,
        reservationDuration: 0.55,
        peak: 0.72 * intensity,
        playbackRate: recordedRate,
        filter: { type: 'highpass', frequency: 32, q: 0.5 },
        options,
    });
    if (playedRecording) {
        audio._playRecordedSample?.('explosionDebris', {
            duration: 0.9,
            reservationDuration: 0.35,
            peak: 0.24 * intensity,
            playbackRate: recordedRate,
            filter: { type: 'highpass', frequency: 110, q: 0.6 },
            options,
        });
        return;
    }

    const gain = audio._createVoiceGraph(options);
    if (!gain) return;
    const noise = audio.ctx.createBufferSource();
    noise.buffer = audio.buffers.explosion;
    // Detuning the noise burst is what makes a second kill sound like its own
    // blast rather than like the first one played twice.
    if (noise.playbackRate) noise.playbackRate.value = echo.detune;

    const filter = audio.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(1400, audio.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(90, audio.ctx.currentTime + 0.38);

    audio._envGain(gain, 0.85 * intensity * atten, 0.4, { attack: 0.004 });
    noise.connect(filter);
    filter.connect(gain);
    noise.start();
    audio._releaseVoice(0.42);

    audio._playTone({
        type: 'triangle',
        startFreq: 180 * echo.detune,
        endFreq: 45 * echo.detune,
        duration: 0.28,
        peak: 0.22 * intensity * atten,
        attack: 0.01,
        options,
    });
}

/**
 * A rocket impact is one event, not an impact plus a separate kill, so it drives
 * the explosion voice directly and deliberately bypasses the EXPLOSION cooldown -
 * it has its own ROCKET_IMPACT cooldown already. It also never consumes a chain
 * echo, because it is not a death in a chain of deaths.
 *
 * @param {object} audio - The AudioManager.
 * @param {object} [options] - Play options.
 */
export function playRocketImpactVoice(audio, options = {}) {
    const intensity = audio._intensity(options, 1, 0.3, 1.6);
    audio._playTone({
        type: 'triangle',
        startFreq: 150,
        endFreq: 38,
        duration: 0.3,
        peak: 0.36 * intensity,
        attack: 0.008,
        options,
    });
    playExplosionVoice(audio, { ...options, intensity: intensity * 0.9 });
}
