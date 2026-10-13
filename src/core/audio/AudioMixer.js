// ============================================
// AudioMixer.js - Bus graph, volumes, mute and recording taps of the AudioManager
// ============================================

import { createLogger } from '../../shared/logging/Logger.js';
import { normalizeAudioSettings } from '../../shared/contracts/AudioSettingsContract.js';
import { createHearingMuffle } from './HearingMuffle.js';

const logger = createLogger('AudioManager');
const BUS_GAIN_NODES = [
    ['_sfxGain', 'sfxVolume'],
    ['_engineGain', 'engineVolume'],
    ['_musicGain', 'musicVolume'],
    ['_uiGain', 'uiVolume'],
    ['_ambienceGain', 'ambienceVolume'],
];

export function clampAudioValue(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/** Creates the six bus gains, the hearing low-pass and the compressor chain into the destination. */
export function buildAudioBuses(audio) {
    audio._masterGain = audio.ctx.createGain();
    audio._sfxGain = audio.ctx.createGain();
    audio._engineGain = audio.ctx.createGain();
    audio._musicGain = audio.ctx.createGain();
    audio._uiGain = audio.ctx.createGain();
    audio._ambienceGain = audio.ctx.createGain();
    // World sound passes the hearing low-pass; music and ui never go deaf.
    audio._hearing = createHearingMuffle(audio.ctx, [audio._sfxGain, audio._engineGain, audio._ambienceGain], audio._masterGain);
    audio._musicGain.connect(audio._masterGain);
    audio._uiGain.connect(audio._masterGain);
    if (typeof audio.ctx.createDynamicsCompressor !== 'function') {
        audio._masterGain.connect(audio.ctx.destination);
        audio._outputNode = audio._masterGain;
        return;
    }
    audio._compressor = audio.ctx.createDynamicsCompressor();
    audio._compressor.threshold.value = -12;
    audio._compressor.knee.value = 12;
    audio._compressor.ratio.value = 5;
    audio._compressor.attack.value = 0.004;
    audio._compressor.release.value = 0.18;
    audio._masterGain.connect(audio._compressor);
    audio._compressor.connect(audio.ctx.destination);
    audio._outputNode = audio._compressor;
}

/** Drops the context and every bus node reference (failed init and dispose). */
export function clearAudioGraphRefs(audio) {
    audio.ctx = null;
    audio._masterGain = null;
    audio._sfxGain = null;
    audio._engineGain = null;
    audio._musicGain = null;
    audio._uiGain = null;
    audio._ambienceGain = null;
    audio._compressor = null;
    audio._outputNode = null;
}

export function applyBusGains(audio) {
    const master = audio.enabled ? clampAudioValue(audio.volume, 0, 1) : 0;
    if (audio._masterGain) audio._masterGain.gain.value = master;
    for (const [node, volume] of BUS_GAIN_NODES) {
        if (audio[node]) audio[node].gain.value = clampAudioValue(audio[volume], 0, 1);
    }
}

/** Stores one clamped volume field (`volume`, `sfxVolume`, ...) and pushes it to the buses. */
export function setBusVolume(audio, field, volume) {
    audio[field] = clampAudioValue(Number(volume) || 0, 0, 1);
    audio._applyBusGains();
    return audio[field];
}

export function applyAudioSettings(audio, settings = {}) {
    const wasEnabled = audio.enabled;
    const normalized = normalizeAudioSettings(settings, audio.getSettings());
    audio.enabled = normalized.enabled;
    audio.volume = normalized.masterVolume;
    audio.sfxVolume = normalized.sfxVolume;
    audio.engineVolume = normalized.engineVolume;
    audio.musicVolume = normalized.musicVolume;
    audio.uiVolume = normalized.uiVolume;
    audio.ambienceVolume = normalized.ambienceVolume;
    audio._applyBusGains();
    if (!audio.enabled) {
        audio.stopEngine();
        audio.music?.stop?.();
    } else {
        if (!wasEnabled && audio.ctx) audio.music?.start?.({ crossfade: true });
    }
    return audio.getSettings();
}

export function setAudioMuted(audio, muted) {
    audio.enabled = muted !== true;
    audio._applyBusGains();
    if (!audio.enabled) {
        audio.stopEngine();
        audio.music?.stop?.();
    } else if (audio.ctx) {
        audio.music?.start?.({ crossfade: true });
    }
    audio._debugLog(`Audio ${audio.enabled ? 'ENABLED' : 'DISABLED'}`);
    return !audio.enabled;
}

export function duckMusic(audio, amount = 0.42, duration = 0.24) {
    const gain = audio._musicGain?.gain;
    if (!gain || !audio.ctx) return;
    const t = audio.ctx.currentTime;
    const base = clampAudioValue(audio.musicVolume, 0, 1);
    gain.cancelScheduledValues?.(t);
    gain.setValueAtTime?.(Math.max(0.0001, gain.value), t);
    gain.setTargetAtTime?.(Math.max(0.0001, base * amount), t, 0.018);
    gain.setTargetAtTime?.(base, t + duration, 0.09);
}

export function acquireRecordingStream(audio) {
    audio._init();
    if (!audio.ctx || !audio._masterGain || typeof audio.ctx.createMediaStreamDestination !== 'function') {
        return null;
    }
    try {
        const destination = audio.ctx.createMediaStreamDestination();
        const outputNode = audio._outputNode || audio._masterGain;
        outputNode.connect(destination);
        const stream = destination.stream;
        const release = () => {
            const activeDestination = audio._recordingDestinations.get(stream);
            if (!activeDestination) return;
            audio._recordingDestinations.delete(stream);
            try {
                outputNode?.disconnect?.(activeDestination);
            } catch {
                // The AudioContext may already be closing.
            }
            for (const track of stream?.getTracks?.() || []) {
                try { track.stop(); } catch { /* best effort */ }
            }
        };
        audio._recordingDestinations.set(stream, destination);
        return { stream, release };
    } catch (error) {
        logger.warn('Recording audio stream unavailable.', error);
        return null;
    }
}

export function releaseRecordingDestinations(audio) {
    for (const [stream, destination] of audio._recordingDestinations) {
        try { (audio._outputNode || audio._masterGain)?.disconnect?.(destination); } catch { /* best effort */ }
        for (const track of stream?.getTracks?.() || []) {
            try { track.stop(); } catch { /* best effort */ }
        }
    }
    audio._recordingDestinations.clear();
}
