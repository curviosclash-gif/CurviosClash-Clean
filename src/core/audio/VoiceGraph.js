// ============================================
// VoiceGraph.js - Voice slots, envelopes and synthesized tone/noise voices
// ============================================

import { clampAudioValue } from './AudioMixer.js';

const MAX_ACTIVE_VOICES = 18;

export function generateNoiseBuffers(audio) {
    const duration = 1.25;
    const bufferSize = Math.max(1, Math.floor(audio.ctx.sampleRate * duration));
    const buffer = audio.ctx.createBuffer(1, bufferSize, audio.ctx.sampleRate);
    const textureBuffer = audio.ctx.createBuffer(1, bufferSize, audio.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const textureData = textureBuffer.getChannelData(0);
    let prev = 0;
    let texturePrev = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        const textureWhite = Math.random() * 2 - 1;
        prev = (prev * 0.96) + (white * 0.04);
        texturePrev = (texturePrev * 0.82) + (textureWhite * 0.18);
        const envelope = 1 - (i / bufferSize);
        data[i] = (white * 0.55 + prev * 0.45) * envelope;
        textureData[i] = textureWhite * 0.72 + texturePrev * 0.28;
    }
    audio.buffers.explosion = buffer;
    audio.buffers.musicNoise = textureBuffer;
}

export function resolveVoiceIntensity(options = {}, fallback = 1, min = 0.2, max = 1.5) {
    return clampAudioValue(Number(options.intensity) || fallback, min, max);
}

export function resolveDistanceAttenuation(options = {}) {
    const distance = Number(options.distance);
    if (!Number.isFinite(distance) || distance <= 0) return 1;
    return clampAudioValue(1 / (1 + distance * 0.045), 0.18, 1);
}

export function resolveVoiceDestination(audio, bus = 'sfx') {
    if (bus === 'ui') return audio._uiOut();
    if (bus === 'ambience') return audio._ambienceOut();
    return audio._sfxOut();
}

export function createVoiceGraph(audio, options = {}, bus = 'sfx') {
    if (audio._activeVoices >= MAX_ACTIVE_VOICES) return null;
    const gain = audio.ctx.createGain();
    /** @type {AudioNode} */
    let tail = gain;
    const spatialPosition = options.spatialPosition;
    const hasSpatialPosition = spatialPosition
        && [spatialPosition.x, spatialPosition.y, spatialPosition.z]
            .every((value) => Number.isFinite(Number(value)));
    if (hasSpatialPosition && typeof audio.ctx.createPanner === 'function') {
        const panner = audio.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 0;
        panner.positionX.value = Number(spatialPosition.x);
        panner.positionY.value = Number(spatialPosition.y);
        panner.positionZ.value = Number(spatialPosition.z);
        gain.connect(panner);
        tail = panner;
    } else if (Number.isFinite(Number(options.pan)) && typeof audio.ctx.createStereoPanner === 'function') {
        const panner = audio.ctx.createStereoPanner();
        panner.pan.value = clampAudioValue(Number(options.pan), -1, 1);
        gain.connect(panner);
        tail = panner;
    }
    tail.connect(audio._resolveVoiceDestination(bus));
    audio._activeVoices += 1;
    return gain;
}

export function releaseVoice(audio, duration = 0.2) {
    const ms = Math.max(50, Math.ceil((Number(duration) || 0.2) * 1000) + 30);
    const timer = setTimeout(() => {
        audio._voiceReleaseTimers.delete(timer);
        audio._activeVoices = Math.max(0, audio._activeVoices - 1);
    }, ms);
    timer?.unref?.();
    audio._voiceReleaseTimers.add(timer);
}

export function applyEnvelopeGain(audio, gainNode, peak, duration, options = {}) {
    const t = audio.ctx.currentTime;
    const attack = Math.max(0.003, Number(options.attack) || 0.01);
    const hold = Math.max(0, Number(options.hold) || 0);
    const level = Math.max(0.0001, peak);
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(level, t + attack);
    if (hold > 0) {
        gainNode.gain.setValueAtTime(level, t + attack + hold);
    }
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);
}

export function startOscillator(audio, type, startFreq, endFreq, duration, gainNode, ramp = 'exp') {
    const osc = audio.ctx.createOscillator();
    const t = audio.ctx.currentTime;
    osc.type = type;
    const safeStart = Math.max(20, startFreq);
    const safeEnd = Math.max(20, endFreq);
    osc.frequency.setValueAtTime(safeStart, t);
    if (ramp === 'linear') {
        osc.frequency.linearRampToValueAtTime(safeEnd, t + duration);
    } else {
        osc.frequency.exponentialRampToValueAtTime(safeEnd, t + duration);
    }
    osc.connect(gainNode);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return osc;
}

/**
 * @param {any} audio
 * @param {{type?: OscillatorType, startFreq?: number, endFreq?: number, duration?: number, peak?: number, attack?: number, hold?: number, ramp?: string, options?: any}} tone
 */
export function playToneVoice(audio, {
    type = 'sine',
    startFreq = 440,
    endFreq = 440,
    duration = 0.15,
    peak = 0.3,
    attack = 0.01,
    hold = 0,
    ramp = 'exp',
    options = {},
}) {
    const gain = audio._createVoiceGraph(options, options.bus);
    if (!gain) return;
    const atten = audio._distanceAttenuation(options);
    audio._envGain(gain, peak * atten, duration, { attack, hold });
    audio._startOsc(type, startFreq, endFreq, duration, gain, ramp);
    audio._releaseVoice(duration);
}

export function playLayeredVoice(audio, layers, options = {}) {
    const gain = audio._createVoiceGraph(options, options.bus);
    if (!gain) return;
    const atten = audio._distanceAttenuation(options);
    const duration = Math.max(...layers.map((layer) => layer.duration || 0.15), 0.08);
    const peak = Math.max(...layers.map((layer) => layer.peak || 0.2), 0.1) * atten;
    audio._envGain(gain, peak, duration, {
        attack: layers[0]?.attack || 0.01,
        hold: layers[0]?.hold || 0,
    });
    for (const layer of layers) {
        const layerGain = audio.ctx.createGain();
        const layerPeak = Math.max(0.0001, (layer.peak || 0.2) * atten);
        layerGain.gain.value = layerPeak / Math.max(peak, 0.0001);
        layerGain.connect(gain);
        audio._startOsc(
            layer.type || 'sine',
            layer.startFreq || 440,
            layer.endFreq || layer.startFreq || 440,
            layer.duration || duration,
            layerGain,
            layer.ramp || 'exp'
        );
    }
    audio._releaseVoice(duration);
}

export function playNoiseVoice(audio, {
    duration = 0.1,
    peak = 0.1,
    filterType = 'bandpass',
    startFrequency = 1800,
    endFrequency = 420,
    options = {},
    bus = 'sfx',
} = {}) {
    const buffer = audio.buffers.musicNoise;
    if (!buffer) return;
    const gain = audio._createVoiceGraph(options, bus);
    if (!gain) return;
    const source = audio.ctx.createBufferSource();
    const filter = audio.ctx.createBiquadFilter();
    const t = audio.ctx.currentTime;
    const atten = audio._distanceAttenuation(options);
    source.buffer = buffer;
    if (source.playbackRate) source.playbackRate.value = 0.94 + Math.random() * 0.12;
    filter.type = /** @type {BiquadFilterType} */ (filterType);
    filter.Q.value = filterType === 'bandpass' ? 0.9 : 0.5;
    filter.frequency.setValueAtTime(Math.max(40, startFrequency), t);
    filter.frequency.exponentialRampToValueAtTime?.(Math.max(40, endFrequency), t + duration);
    audio._envGain(gain, peak * atten, duration, { attack: 0.003 });
    source.connect(filter);
    filter.connect(gain);
    source.start(t);
    source.stop?.(t + duration + 0.02);
    audio._releaseVoice(duration);
}
