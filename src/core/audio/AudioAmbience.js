// ============================================
// AudioAmbience.js - Ambience bed plus engine and map ambience follow the local pilot
// ============================================

import { playNotreDameCollapse, syncMapAmbienceVoice } from './MapAmbienceVoice.js';
import { MUSIC_STATES } from './ProceduralMusicDirector.js';

const AMBIENCE_TARGETS = {
    [MUSIC_STATES.MENU]: { gain: 0.009, frequency: 210 },
    [MUSIC_STATES.RACE]: { gain: 0.018, frequency: 360 },
    [MUSIC_STATES.FIGHT]: { gain: 0.024, frequency: 480 },
    [MUSIC_STATES.RESULTS]: { gain: 0.012, frequency: 280 },
};

/**
 * The local pilot engine sound and ambience follow: the first living one among the local
 * humans, so a split screen keeps its engine while any local player still flies.
 */
export function resolveLocalAudioSource(players, options = {}) {
    const list = Array.isArray(players) ? players : [];
    const localIndex = Number(options.localPlayerIndex);
    const localCount = Math.max(1, Math.floor(Number(options.localHumanCount) || 1));
    const locals = Number.isInteger(localIndex)
        ? list.filter((player) => player && player.isBot !== true
            && player.index >= localIndex && player.index < localIndex + localCount)
        : [];
    return locals.find((player) => player.alive !== false)
        || locals[0]
        || list.find((player) => player && player.isBot !== true && player.alive !== false)
        || null;
}

export function ensureAmbienceBed(audio) {
    if (!audio.ctx || audio._ambience || !audio.buffers.musicNoise) return;
    const source = audio.ctx.createBufferSource();
    const filter = audio.ctx.createBiquadFilter();
    const gain = audio.ctx.createGain();
    source.buffer = audio.buffers.musicNoise;
    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.45;
    gain.gain.value = 0.012;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio._ambienceOut());
    source.start(audio.ctx.currentTime);
    audio._ambience = { source, filter, gain };
    audio._setAmbienceForState(audio.music?.state || MUSIC_STATES.MENU);
}

export function setAmbienceForState(audio, state) {
    const ambience = audio._ambience;
    if (!ambience || !audio.ctx) return;
    const target = AMBIENCE_TARGETS[state] || AMBIENCE_TARGETS[MUSIC_STATES.MENU];
    const t = audio.ctx.currentTime;
    ambience.gain.gain.setTargetAtTime?.(target.gain, t, 0.35);
    ambience.filter.frequency.setTargetAtTime?.(target.frequency, t, 0.45);
}

export function disposeAmbienceBed(audio) {
    if (!audio._ambience) return;
    try { audio._ambience.source.stop(); } catch { /* ignore */ }
    audio._ambience = null;
}

export function syncEngineFromPlayers(audio, players = [], options = {}) {
    if (!audio.enabled) {
        audio.stopEngine();
        return;
    }
    const source = resolveLocalAudioSource(players, options);
    if (!source || source.alive === false) {
        audio.stopEngine();
        return;
    }
    audio.updateEngine({
        alive: true,
        speed: source.speed,
        baseSpeed: source.baseSpeed,
        boosting: source.isBoosting === true || (Number(source.boostPortalTimer) || 0) > 0,
    });
}

export function syncMapAmbienceFromPlayers(audio, players = [], options = {}) {
    if (!audio._mapAmbienceSyncOptions) return 'unavailable';
    const source = resolveLocalAudioSource(players, options);
    const syncOptions = audio._mapAmbienceSyncOptions;
    syncOptions.profile = options.fireProgress > 0 ? options.mapDefinition?.fireAudioProfile || options.mapDefinition?.audioProfile : options.mapDefinition?.audioProfile || null;
    syncOptions.fireProgress = options.fireProgress;
    syncOptions.playerPosition = source?.alive === false ? null : source?.position;
    syncOptions.mapScale = options.mapScale;
    syncOptions.elapsedSeconds = options.elapsedSeconds;
    syncOptions.sandstormState = options.sandstormState || null;
    return syncMapAmbienceVoice(audio, syncOptions);
}

export function playMapCollapseVoice(audio, position, scale = 1) {
    const listener = audio._mapAmbienceSyncOptions?.playerPosition;
    if (!audio.ctx || !listener) return;
    playNotreDameCollapse(audio, { collapse: { position, audibleRadius: 170 } }, listener, scale);
}

export function clearMapAmbience(audio) {
    const syncOptions = audio._mapAmbienceSyncOptions;
    if (!syncOptions) return 'unavailable';
    syncOptions.profile = null;
    syncOptions.playerPosition = null;
    syncOptions.elapsedSeconds = 0;
    return syncMapAmbienceVoice(audio, syncOptions);
}
