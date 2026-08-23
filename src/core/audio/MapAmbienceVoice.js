const NOTRE_DAME_PROFILE_ID = 'notre_dame';
const SILENT_GAIN = 0.0001;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function setTarget(parameter, value, time, constant = 0.45) {
    if (!parameter) return;
    if (typeof parameter.setTargetAtTime === 'function') {
        parameter.setTargetAtTime(value, time, constant);
    } else {
        parameter.value = value;
    }
}

function createNoiseLayer(audio, { filterType, frequency, q, playbackRate = 1 }) {
    const source = audio.ctx.createBufferSource();
    const filter = audio.ctx.createBiquadFilter();
    const gain = audio.ctx.createGain();
    source.buffer = audio.buffers.musicNoise;
    source.loop = true;
    if (source.playbackRate) source.playbackRate.value = playbackRate;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.value = SILENT_GAIN;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio._ambienceOut());
    source.start(audio.ctx.currentTime);
    return { source, filter, gain };
}

function createMechanicalLayer(audio) {
    const oscillator = audio.ctx.createOscillator();
    const filter = audio.ctx.createBiquadFilter();
    const gain = audio.ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 54;
    filter.type = 'lowpass';
    filter.frequency.value = 210;
    filter.Q.value = 1.8;
    gain.gain.value = SILENT_GAIN;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(audio._ambienceOut());
    oscillator.start(audio.ctx.currentTime);
    return { oscillator, filter, gain };
}

export function ensureMapAmbienceVoice(audio) {
    if (!audio?.ctx || audio._mapAmbience || !audio.buffers?.musicNoise) return audio?._mapAmbience || null;
    audio._mapAmbience = {
        profileId: '',
        zone: 'none',
        lastBellIndex: null,
        lastElapsedSeconds: 0,
        outdoor: createNoiseLayer(audio, {
            filterType: 'bandpass', frequency: 520, q: 0.32, playbackRate: 0.72,
        }),
        interior: createNoiseLayer(audio, {
            filterType: 'lowpass', frequency: 185, q: 1.65, playbackRate: 0.46,
        }),
        construction: createNoiseLayer(audio, {
            filterType: 'bandpass', frequency: 940, q: 0.72, playbackRate: 1.18,
        }),
        machinery: createMechanicalLayer(audio),
    };
    return audio._mapAmbience;
}

function scaledBoundsContains(bounds, position, scale) {
    if (!Array.isArray(bounds?.min) || !Array.isArray(bounds?.max) || !position) return false;
    return position.x >= Number(bounds.min[0]) * scale
        && position.x <= Number(bounds.max[0]) * scale
        && position.y >= Number(bounds.min[1]) * scale
        && position.y <= Number(bounds.max[1]) * scale
        && position.z >= Number(bounds.min[2]) * scale
        && position.z <= Number(bounds.max[2]) * scale;
}

function resolveNearestConstructionDistance(profile, position, scale) {
    const centers = Array.isArray(profile?.constructionCenters) ? profile.constructionCenters : [];
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < centers.length; index += 1) {
        const center = centers[index];
        if (!Array.isArray(center)) continue;
        const dx = position.x - Number(center[0]) * scale;
        const dy = position.y - Number(center[1]) * scale;
        const dz = position.z - Number(center[2]) * scale;
        nearest = Math.min(nearest, Math.hypot(dx, dy, dz));
    }
    return nearest;
}

function silenceMapAmbience(audio, state) {
    if (!state || !audio?.ctx) return;
    const time = audio.ctx.currentTime;
    for (const layer of [state.outdoor, state.interior, state.construction, state.machinery]) {
        setTarget(layer?.gain?.gain, SILENT_GAIN, time, 0.3);
    }
    state.profileId = '';
    state.zone = 'none';
    state.lastBellIndex = null;
}

function playNotreDameBell(audio, profile, position, scale) {
    const bell = profile?.bell;
    if (!Array.isArray(bell?.position) || !position) return;
    const dx = Number(bell.position[0]) * scale - position.x;
    const dy = Number(bell.position[1]) * scale - position.y;
    const dz = Number(bell.position[2]) * scale - position.z;
    const distance = Math.hypot(dx, dy, dz);
    const audibleRadius = Math.max(1, Number(bell.audibleRadius) * scale || 450);
    if (distance > audibleRadius) return;
    audio._playLayered([
        { type: 'sine', startFreq: 196, endFreq: 194, duration: 2.6, peak: 0.18, attack: 0.012, hold: 0.08 },
        { type: 'sine', startFreq: 294, endFreq: 289, duration: 2.2, peak: 0.11, attack: 0.01, hold: 0.05 },
        { type: 'triangle', startFreq: 392, endFreq: 382, duration: 1.7, peak: 0.06, attack: 0.008 },
    ], {
        bus: 'ambience',
        distance: distance / Math.max(1, scale),
        pan: clamp(dz / audibleRadius, -0.8, 0.8),
    });
}

export function syncMapAmbienceVoice(audio, options = {}) {
    const profile = options.profile;
    const profileId = String(profile?.id || '').trim();
    if (profileId !== NOTRE_DAME_PROFILE_ID || !options.playerPosition) {
        silenceMapAmbience(audio, audio?._mapAmbience);
        return 'none';
    }

    const state = ensureMapAmbienceVoice(audio);
    if (!state || !audio?.ctx) return 'unavailable';

    const position = options.playerPosition;
    const scale = Math.max(0.0001, Number(options.mapScale) || 1);
    const inside = scaledBoundsContains(profile.interiorBounds, position, scale);
    const constructionRadius = Math.max(1, Number(profile.constructionRadius) * scale || 48 * scale);
    const constructionDistance = resolveNearestConstructionDistance(profile, position, scale);
    const constructionMix = clamp(1 - (constructionDistance / constructionRadius), 0, 1);
    const zone = inside ? 'interior' : (constructionMix > 0.08 ? 'construction' : 'outdoor');
    const time = audio.ctx.currentTime;

    setTarget(state.outdoor.gain.gain, inside ? 0.0025 : 0.015, time);
    setTarget(state.interior.gain.gain, inside ? 0.022 : SILENT_GAIN, time);
    setTarget(state.construction.gain.gain, SILENT_GAIN + constructionMix * 0.012, time);
    setTarget(state.machinery.gain.gain, SILENT_GAIN + constructionMix * 0.007, time);
    setTarget(state.interior.filter.frequency, inside ? 165 : 260, time, 0.6);

    const elapsedSeconds = Math.max(0, Number(options.elapsedSeconds) || 0);
    const intervalSeconds = Math.max(0.1, Number(profile.bell?.intervalSeconds) || 6);
    const phaseSeconds = Math.max(0, Number(profile.bell?.phaseOffsetSeconds) || 0);
    const bellIndex = Math.floor((elapsedSeconds - phaseSeconds) / intervalSeconds);
    const restarted = elapsedSeconds + 0.001 < state.lastElapsedSeconds || state.profileId !== profileId;
    if (restarted) {
        state.lastBellIndex = bellIndex;
    } else if (bellIndex >= 0 && state.lastBellIndex !== null && bellIndex > state.lastBellIndex) {
        playNotreDameBell(audio, profile, position, scale);
        state.lastBellIndex = bellIndex;
    } else if (state.lastBellIndex === null) {
        state.lastBellIndex = bellIndex;
    }

    state.profileId = profileId;
    state.zone = zone;
    state.lastElapsedSeconds = elapsedSeconds;
    return zone;
}

export function disposeMapAmbienceVoice(audio) {
    const state = audio?._mapAmbience;
    if (!state) return;
    for (const layer of [state.outdoor, state.interior, state.construction]) {
        try { layer?.source?.stop?.(); } catch { /* AudioContext may already be closed. */ }
        try { layer?.gain?.disconnect?.(); } catch { /* best effort */ }
    }
    try { state.machinery?.oscillator?.stop?.(); } catch { /* AudioContext may already be closed. */ }
    try { state.machinery?.gain?.disconnect?.(); } catch { /* best effort */ }
    audio._mapAmbience = null;
}
