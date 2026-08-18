// ============================================
// Audio.js - Synthesized Sound Effects (No assets needed)
// ============================================

import { createLogger } from '../shared/logging/Logger.js';
import { createExplosionChainState, playExplosionVoice, playRocketImpactVoice, resetExplosionChain, resolveExplosionEcho } from './audio/ExplosionVoice.js';

const logger = createLogger('AudioManager');
const DEFAULT_COOLDOWN_MS = 50;
const DEFAULT_MASTER_VOLUME = 0.18;
const DEFAULT_SFX_VOLUME = 1;
const DEFAULT_ENGINE_VOLUME = 0.55;
const MAX_ACTIVE_VOICES = 18;
const ENGINE_IDLE_GAIN = 0.0001;

const SOUND_COOLDOWNS_MS = Object.freeze({
    SHOOT: 100,
    MG_SHOOT: 45,
    ROCKET_SHOOT: 180,
    EXPLOSION: 200,
    HIT: 90,
    MG_HIT: 65,
    ROCKET_IMPACT: 160,
    SHIELD_HIT: 70,
    POWERUP: 420,
    PICKUP: 280,
    PORTAL: 320,
    SLINGSHOT: 260,
    BOOST: 180,
    PARCOURS_CP: 80,
    PARCOURS_BRANCH: 140,
    PARCOURS_FINISH: 650,
    PARCOURS_WRONG: 420,
    PARCOURS_TIMEOUT: 500,
    FIGHT_KILL: 120,
    FIGHT_ASSIST: 180,
    FIGHT_LEAD: 800,
    UI_DROP: 40,
    UI_PICKUP: 40,
    UI_REJECT: 80,
});

const AUDIO_INIT_EVENT_TYPES = ['click', 'keydown', 'touchstart'];

function isDevEnvironment() {
    try {
        return Boolean(import.meta?.env?.DEV);
    } catch {
        return false;
    }
}

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = DEFAULT_MASTER_VOLUME;
        this.sfxVolume = DEFAULT_SFX_VOLUME;
        this.engineVolume = DEFAULT_ENGINE_VOLUME;
        this.buffers = {};
        this._masterGain = null;
        this._sfxGain = null;
        this._engineGain = null;
        this._engine = null;
        this._activeVoices = 0;
        this._isDevEnvironment = isDevEnvironment();
        this._audioInitFailed = false;
        this._debugEvents = [];
        this._maxDebugEvents = 24;
        this._registeredWindowListeners = [];
        this._recordingDestinations = new Map();

        this.lastPlayTime = {};
        this.cooldowns = { ...SOUND_COOLDOWNS_MS };
        this._explosionChain = createExplosionChainState();

        this._onInitInteraction = () => {
            this._init();
            this._removeInitListeners();
        };

        for (const eventType of AUDIO_INIT_EVENT_TYPES) {
            this._addWindowListener(eventType, this._onInitInteraction);
        }
    }

    _addWindowListener(type, listener) {
        window.addEventListener(type, listener);
        this._registeredWindowListeners.push({ type, listener });
    }

    _removeWindowListener(type, listener) {
        window.removeEventListener(type, listener);
        if (!this._registeredWindowListeners.length) return;
        this._registeredWindowListeners = this._registeredWindowListeners.filter((entry) =>
            !(entry.type === type && entry.listener === listener)
        );
    }

    _removeAllWindowListeners() {
        if (!this._registeredWindowListeners.length) return;
        for (const entry of this._registeredWindowListeners) {
            window.removeEventListener(entry.type, entry.listener);
        }
        this._registeredWindowListeners = [];
    }

    _debugLog(message, metadata) {
        if (!this._isDevEnvironment) return;
        if (metadata !== undefined) {
            console.debug(`[AudioManager] ${message}`, metadata);
            return;
        }
        console.debug(`[AudioManager] ${message}`);
    }

    _removeInitListeners() {
        if (!this._onInitInteraction) return;
        for (const eventType of AUDIO_INIT_EVENT_TYPES) {
            this._removeWindowListener(eventType, this._onInitInteraction);
        }
    }

    _init() {
        if (this.ctx || this._audioInitFailed) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        try {
            this.ctx = new AudioContext();
            this._masterGain = this.ctx.createGain();
            this._sfxGain = this.ctx.createGain();
            this._engineGain = this.ctx.createGain();
            this._sfxGain.connect(this._masterGain);
            this._engineGain.connect(this._masterGain);
            this._masterGain.connect(this.ctx.destination);
            this._applyBusGains();
            this._generateBuffers();
        } catch (error) {
            this.enabled = false;
            this.ctx = null;
            this._masterGain = null;
            this._sfxGain = null;
            this._engineGain = null;
            this.buffers = {};
            this._audioInitFailed = true;
            logger.warn('AudioContext initialization failed; audio muted.', error);
            this._debugLog('AudioContext init failed', {
                error: error instanceof Error ? error.message : String(error || ''),
            });
        }
    }

    _generateBuffers() {
        const duration = 0.42;
        const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let prev = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            prev = (prev * 0.96) + (white * 0.04);
            const envelope = 1 - (i / bufferSize);
            data[i] = (white * 0.55 + prev * 0.45) * envelope;
        }
        this.buffers.explosion = buffer;
    }

    _clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    _applyBusGains() {
        const master = this.enabled ? this._clamp(this.volume, 0, 1) : 0;
        if (this._masterGain) this._masterGain.gain.value = master;
        if (this._sfxGain) this._sfxGain.gain.value = this._clamp(this.sfxVolume, 0, 1);
        if (this._engineGain) this._engineGain.gain.value = this._clamp(this.engineVolume, 0, 1);
    }

    _sfxOut() {
        return this._sfxGain || this._masterGain || this.ctx.destination;
    }

    acquireRecordingStream() {
        this._init();
        if (!this.ctx || !this._masterGain || typeof this.ctx.createMediaStreamDestination !== 'function') {
            return null;
        }
        try {
            const destination = this.ctx.createMediaStreamDestination();
            this._masterGain.connect(destination);
            const stream = destination.stream;
            const release = () => {
                const activeDestination = this._recordingDestinations.get(stream);
                if (!activeDestination) return;
                this._recordingDestinations.delete(stream);
                try {
                    this._masterGain?.disconnect?.(activeDestination);
                } catch {
                    // The AudioContext may already be closing.
                }
                for (const track of stream?.getTracks?.() || []) {
                    try { track.stop(); } catch { /* best effort */ }
                }
            };
            this._recordingDestinations.set(stream, destination);
            return { stream, release };
        } catch (error) {
            logger.warn('Recording audio stream unavailable.', error);
            return null;
        }
    }

    _resolveTime() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    _intensity(options = {}, fallback = 1, min = 0.2, max = 1.5) {
        return this._clamp(Number(options.intensity) || fallback, min, max);
    }

    _distanceAttenuation(options = {}) {
        const distance = Number(options.distance);
        if (!Number.isFinite(distance) || distance <= 0) return 1;
        return this._clamp(1 / (1 + distance * 0.045), 0.18, 1);
    }

    _createVoiceGraph(options = {}) {
        if (this._activeVoices >= MAX_ACTIVE_VOICES) return null;
        const gain = this.ctx.createGain();
        let tail = gain;
        const pan = Number(options.pan);
        if (Number.isFinite(pan) && typeof this.ctx.createStereoPanner === 'function') {
            const panner = this.ctx.createStereoPanner();
            panner.pan.value = this._clamp(pan, -1, 1);
            gain.connect(panner);
            tail = panner;
        }
        tail.connect(this._sfxOut());
        this._activeVoices += 1;
        return gain;
    }

    _releaseVoice(duration = 0.2) {
        const ms = Math.max(50, Math.ceil((Number(duration) || 0.2) * 1000) + 30);
        setTimeout(() => {
            this._activeVoices = Math.max(0, this._activeVoices - 1);
        }, ms);
    }

    _envGain(gainNode, peak, duration, options = {}) {
        const t = this.ctx.currentTime;
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

    _startOsc(type, startFreq, endFreq, duration, gainNode, ramp = 'exp') {
        const osc = this.ctx.createOscillator();
        const t = this.ctx.currentTime;
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

    _playTone({
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
        const gain = this._createVoiceGraph(options);
        if (!gain) return;
        const atten = this._distanceAttenuation(options);
        this._envGain(gain, peak * atten, duration, { attack, hold });
        this._startOsc(type, startFreq, endFreq, duration, gain, ramp);
        this._releaseVoice(duration);
    }

    _playLayered(layers, options = {}) {
        const gain = this._createVoiceGraph(options);
        if (!gain) return;
        const atten = this._distanceAttenuation(options);
        const duration = Math.max(...layers.map((layer) => layer.duration || 0.15), 0.08);
        const peak = Math.max(...layers.map((layer) => layer.peak || 0.2), 0.1) * atten;
        this._envGain(gain, peak, duration, {
            attack: layers[0]?.attack || 0.01,
            hold: layers[0]?.hold || 0,
        });
        for (const layer of layers) {
            const layerGain = this.ctx.createGain();
            const layerPeak = Math.max(0.0001, (layer.peak || 0.2) * atten);
            layerGain.gain.value = layerPeak / Math.max(peak, 0.0001);
            layerGain.connect(gain);
            this._startOsc(
                layer.type || 'sine',
                layer.startFreq || 440,
                layer.endFreq || layer.startFreq || 440,
                layer.duration || duration,
                layerGain,
                layer.ramp || 'exp'
            );
        }
        this._releaseVoice(duration);
    }

    _recordDebugEvent(type, options = {}) {
        this._debugEvents.push({
            type,
            intensity: Number.isFinite(Number(options.intensity)) ? Number(options.intensity) : null,
            depleted: options.depleted === true,
            at: this._resolveTime(),
        });
        if (this._debugEvents.length > this._maxDebugEvents) {
            this._debugEvents.splice(0, this._debugEvents.length - this._maxDebugEvents);
        }
    }

    getRecentEvents(limit = 10) {
        const size = Math.max(0, Number(limit) || 0);
        return size > 0 ? this._debugEvents.slice(-size) : [];
    }

    clearDebugEvents() {
        this._debugEvents.length = 0;
        this.lastPlayTime = {};
    }

    setMasterVolume(volume) {
        this.volume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.volume;
    }

    getMasterVolume() {
        return this.volume;
    }

    setSfxVolume(volume) {
        this.sfxVolume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.sfxVolume;
    }

    setEngineVolume(volume) {
        this.engineVolume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.engineVolume;
    }

    setMuted(muted) {
        this.enabled = muted !== true;
        this._applyBusGains();
        if (!this.enabled) this.stopEngine();
        this._debugLog(`Audio ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
        return !this.enabled;
    }

    isMuted() {
        return !this.enabled;
    }

    toggleMute() {
        return this.setMuted(this.enabled);
    }

    play(type, options = {}) {
        if (!this.enabled || !this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this._resolveTime();
        const last = this.lastPlayTime[type] || 0;
        const cooldown = this.cooldowns[type] || DEFAULT_COOLDOWN_MS;
        if (now - last < cooldown) {
            // Only explosions answer a blocked shot, and only twice per window, so
            // a chain reaction stays audible without a mass wipe turning to noise.
            const echo = type === 'EXPLOSION' ? resolveExplosionEcho(this._explosionChain) : null;
            if (!echo) return;
            options = { ...options, ...echo };
        } else if (type === 'EXPLOSION') {
            resetExplosionChain(this._explosionChain);
        }
        this.lastPlayTime[type] = now;
        this._recordDebugEvent(type, options);

        switch (type) {
            case 'SHOOT': this._playShoot(options); break;
            case 'MG_SHOOT': this._playMgShoot(options); break;
            case 'ROCKET_SHOOT': this._playRocketShoot(options); break;
            case 'EXPLOSION': playExplosionVoice(this, options); break;
            case 'HIT': this._playHit(options); break;
            case 'MG_HIT': this._playMgHit(options); break;
            case 'ROCKET_IMPACT': playRocketImpactVoice(this, options); break;
            case 'SHIELD_HIT': this._playShieldHit(options); break;
            case 'POWERUP': this._playPowerup(options); break;
            case 'PICKUP': this._playPickup(options); break;
            case 'PORTAL': this._playPortal(options); break;
            case 'SLINGSHOT': this._playSlingshot(options); break;
            case 'BOOST': this._playBoost(options); break;
            case 'PARCOURS_CP': this._playParcoursCheckpoint(options); break;
            case 'PARCOURS_BRANCH': this._playParcoursBranch(options); break;
            case 'PARCOURS_FINISH': this._playParcoursFinish(options); break;
            case 'PARCOURS_WRONG': this._playParcoursWrong(options); break;
            case 'PARCOURS_TIMEOUT': this._playParcoursTimeout(options); break;
            case 'FIGHT_KILL': this._playFightKill(options); break;
            case 'FIGHT_ASSIST': this._playFightAssist(options); break;
            case 'FIGHT_LEAD': this._playFightLead(options); break;
            case 'UI_DROP': this._playUiDrop(options); break;
            case 'UI_PICKUP': this._playUiPickup(options); break;
            case 'UI_REJECT': this._playUiReject(options); break;
            default: break;
        }
    }

    _playShoot(options = {}) {
        const intensity = this._intensity(options, 0.85, 0.2, 1.3);
        this._playLayered([
            { type: 'square', startFreq: 760, endFreq: 140, duration: 0.09, peak: 0.28 * intensity, attack: 0.004 },
            { type: 'triangle', startFreq: 420, endFreq: 90, duration: 0.11, peak: 0.16 * intensity },
        ], options);
    }

    _playMgShoot(options = {}) {
        const intensity = this._intensity(options, 0.75, 0.2, 1.2);
        this._playTone({
            type: 'square',
            startFreq: 1500,
            endFreq: 280,
            duration: 0.05,
            peak: 0.16 * intensity,
            attack: 0.003,
            options,
        });
    }

    _playRocketShoot(options = {}) {
        const intensity = this._intensity(options, 0.9, 0.25, 1.3);
        this._playLayered([
            { type: 'sawtooth', startFreq: 240, endFreq: 64, duration: 0.26, peak: 0.3 * intensity, attack: 0.02 },
            { type: 'triangle', startFreq: 110, endFreq: 48, duration: 0.3, peak: 0.18 * intensity },
        ], options);
    }

    _playHit(options = {}) {
        const intensity = this._intensity(options, 0.9, 0.2, 1.4);
        this._playLayered([
            { type: 'sawtooth', startFreq: 210 * (0.9 + intensity * 0.15), endFreq: 48, duration: 0.11, peak: 0.42 * intensity, attack: 0.004 },
            { type: 'triangle', startFreq: 320, endFreq: 80, duration: 0.09, peak: 0.18 * intensity },
        ], options);
    }

    _playMgHit(options = {}) {
        const intensity = this._intensity(options, 0.8, 0.2, 1.4);
        this._playTone({
            type: 'triangle',
            startFreq: 980,
            endFreq: 260,
            duration: 0.07,
            peak: 0.24 * intensity,
            attack: 0.004,
            options,
        });
    }

    _playShieldHit(options = {}) {
        const intensity = this._intensity(options, 0.9, 0.2, 1.3);
        const depleted = options.depleted === true;
        this._playLayered([
            {
                type: 'sine',
                startFreq: depleted ? 640 : 820,
                endFreq: depleted ? 140 : 280,
                duration: depleted ? 0.28 : 0.16,
                peak: 0.22 * intensity,
                attack: 0.006,
            },
            {
                type: 'triangle',
                startFreq: depleted ? 980 : 1240,
                endFreq: depleted ? 220 : 420,
                duration: depleted ? 0.22 : 0.12,
                peak: 0.14 * intensity,
            },
        ], options);
    }

    _playPowerup(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.3);
        this._playTone({
            type: 'sine',
            startFreq: 420,
            endFreq: 1180,
            duration: 0.2,
            peak: 0.34 * intensity,
            attack: 0.012,
            ramp: 'linear',
            options,
        });
    }

    _playPickup(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.3);
        this._playLayered([
            { type: 'sine', startFreq: 520, endFreq: 880, duration: 0.1, peak: 0.22 * intensity, attack: 0.008, ramp: 'linear' },
            { type: 'triangle', startFreq: 780, endFreq: 1240, duration: 0.14, peak: 0.16 * intensity, ramp: 'linear' },
        ], options);
    }

    _playPortal(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.3);
        this._playLayered([
            { type: 'sine', startFreq: 220, endFreq: 660, duration: 0.24, peak: 0.24 * intensity, attack: 0.02, ramp: 'linear' },
            { type: 'triangle', startFreq: 880, endFreq: 240, duration: 0.28, peak: 0.14 * intensity },
        ], options);
    }

    _playSlingshot(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.4);
        this._playLayered([
            { type: 'sawtooth', startFreq: 90, endFreq: 260, duration: 0.22, peak: 0.26 * intensity, attack: 0.015, ramp: 'linear' },
            { type: 'triangle', startFreq: 180, endFreq: 420, duration: 0.18, peak: 0.14 * intensity, ramp: 'linear' },
        ], options);
    }

    _playBoost(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.4);
        this._playLayered([
            { type: 'triangle', startFreq: 90, endFreq: 320, duration: 0.28, peak: 0.28 * intensity, attack: 0.02, ramp: 'linear' },
            { type: 'sawtooth', startFreq: 60, endFreq: 180, duration: 0.32, peak: 0.12 * intensity, ramp: 'linear' },
        ], options);
    }

    _playParcoursCheckpoint(options = {}) {
        const intensity = this._intensity(options, 0.9, 0.25, 1.3);
        this._playLayered([
            { type: 'sine', startFreq: 1420, endFreq: 980, duration: 0.12, peak: 0.16 * intensity, attack: 0.006 },
            { type: 'triangle', startFreq: 2120, endFreq: 1560, duration: 0.09, peak: 0.1 * intensity },
        ], options);
    }

    _playParcoursBranch(options = {}) {
        const intensity = this._intensity(options, 1, 0.3, 1.4);
        this._playLayered([
            { type: 'triangle', startFreq: 960, endFreq: 720, duration: 0.2, peak: 0.2 * intensity, attack: 0.01 },
            { type: 'square', startFreq: 1480, endFreq: 1180, duration: 0.15, peak: 0.1 * intensity },
        ], options);
    }

    _playParcoursFinish(options = {}) {
        const intensity = this._intensity(options, 1.05, 0.35, 1.6);
        this._playLayered([
            { type: 'triangle', startFreq: 240, endFreq: 360, duration: 0.5, peak: 0.22 * intensity, attack: 0.02, hold: 0.08, ramp: 'linear' },
            { type: 'sine', startFreq: 480, endFreq: 720, duration: 0.46, peak: 0.18 * intensity, ramp: 'linear' },
            { type: 'triangle', startFreq: 720, endFreq: 1080, duration: 0.34, peak: 0.14 * intensity, ramp: 'linear' },
        ], options);
    }

    _playParcoursWrong(options = {}) {
        const intensity = this._intensity(options, 0.95, 0.3, 1.3);
        this._playLayered([
            { type: 'sawtooth', startFreq: 280, endFreq: 120, duration: 0.18, peak: 0.22 * intensity, attack: 0.008 },
            { type: 'square', startFreq: 190, endFreq: 90, duration: 0.22, peak: 0.12 * intensity },
        ], options);
    }

    _playParcoursTimeout(options = {}) {
        const intensity = this._intensity(options, 0.9, 0.3, 1.3);
        this._playTone({
            type: 'triangle',
            startFreq: 360,
            endFreq: 140,
            duration: 0.28,
            peak: 0.2 * intensity,
            attack: 0.02,
            options,
        });
    }

    _playFightKill(options = {}) {
        const intensity = this._intensity(options, 1, 0.35, 1.5);
        this._playLayered([
            { type: 'sawtooth', startFreq: 340, endFreq: 68, duration: 0.3, peak: 0.3 * intensity, attack: 0.008 },
            { type: 'square', startFreq: 920, endFreq: 210, duration: 0.1, peak: 0.16 * intensity, attack: 0.003 },
        ], options);
    }

    _playFightAssist(options = {}) {
        const intensity = this._intensity(options, 0.85, 0.3, 1.3);
        this._playLayered([
            { type: 'triangle', startFreq: 420, endFreq: 560, duration: 0.14, peak: 0.16 * intensity, attack: 0.01, ramp: 'linear' },
            { type: 'sine', startFreq: 640, endFreq: 820, duration: 0.16, peak: 0.12 * intensity, ramp: 'linear' },
        ], options);
    }

    _playFightLead(options = {}) {
        const intensity = this._intensity(options, 0.95, 0.35, 1.4);
        const t = this.ctx.currentTime;
        const gain = this._createVoiceGraph(options);
        if (!gain) return;
        this._envGain(gain, 0.24 * intensity, 0.44, { attack: 0.015, hold: 0.08 });
        const root = this.ctx.createOscillator();
        const fifth = this.ctx.createOscillator();
        root.type = 'triangle';
        fifth.type = 'sine';
        root.frequency.setValueAtTime(330, t);
        root.frequency.setValueAtTime(415, t + 0.12);
        root.frequency.setValueAtTime(494, t + 0.24);
        fifth.frequency.setValueAtTime(494, t);
        fifth.frequency.setValueAtTime(622, t + 0.12);
        fifth.frequency.setValueAtTime(740, t + 0.24);
        root.connect(gain);
        fifth.connect(gain);
        root.start(t);
        fifth.start(t);
        root.stop(t + 0.44);
        fifth.stop(t + 0.4);
        this._releaseVoice(0.44);
    }

    _playUiDrop(options = {}) {
        this._playTone({
            type: 'sine',
            startFreq: 520,
            endFreq: 700,
            duration: 0.09,
            peak: 0.12,
            attack: 0.006,
            ramp: 'linear',
            options,
        });
    }

    _playUiPickup(options = {}) {
        this._playTone({
            type: 'sine',
            startFreq: 260,
            endFreq: 360,
            duration: 0.09,
            peak: 0.11,
            attack: 0.006,
            ramp: 'linear',
            options,
        });
    }

    _playUiReject(options = {}) {
        this._playTone({
            type: 'sawtooth',
            startFreq: 140,
            endFreq: 70,
            duration: 0.11,
            peak: 0.12,
            attack: 0.005,
            options,
        });
    }

    _ensureEngineNodes() {
        if (!this.ctx || this._engine) return;
        const body = this.ctx.createOscillator();
        const hum = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        body.type = 'sawtooth';
        hum.type = 'triangle';
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.6;
        gain.gain.value = ENGINE_IDLE_GAIN;
        body.frequency.value = 70;
        hum.frequency.value = 140;
        body.connect(filter);
        hum.connect(filter);
        filter.connect(gain);
        gain.connect(this._engineGain || this._masterGain || this.ctx.destination);
        const t = this.ctx.currentTime;
        body.start(t);
        hum.start(t);
        this._engine = { body, hum, filter, gain, active: true };
    }

    updateEngine(state = {}) {
        if (!this.enabled || !this.ctx) {
            this.stopEngine();
            return;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const alive = state.alive !== false;
        const speed = Math.max(0, Number(state.speed) || 0);
        const baseSpeed = Math.max(1, Number(state.baseSpeed) || 18);
        const boosting = state.boosting === true;
        if (!alive || speed < 0.35) {
            this.stopEngine();
            return;
        }

        this._ensureEngineNodes();
        const engine = this._engine;
        if (!engine) return;

        const ratio = this._clamp(speed / baseSpeed, 0.35, 3.0);
        const targetBody = 58 + ratio * 78 + (boosting ? 36 : 0);
        const targetHum = targetBody * 2.05;
        const targetFilter = 280 + ratio * 260 + (boosting ? 180 : 0);
        const targetGain = (0.018 + ratio * 0.06) * (boosting ? 1.55 : 1);
        const t = this.ctx.currentTime;
        engine.body.frequency.setTargetAtTime(targetBody, t, 0.05);
        engine.hum.frequency.setTargetAtTime(targetHum, t, 0.05);
        engine.filter.frequency.setTargetAtTime(targetFilter, t, 0.08);
        engine.gain.gain.setTargetAtTime(targetGain, t, 0.06);
        engine.active = true;
    }

    stopEngine() {
        const engine = this._engine;
        if (!engine || !this.ctx) return;
        const t = this.ctx.currentTime;
        engine.gain.gain.cancelScheduledValues(t);
        engine.gain.gain.setTargetAtTime(ENGINE_IDLE_GAIN, t, 0.04);
        engine.active = false;
    }

    syncEngineFromPlayers(players = [], options = {}) {
        if (!this.enabled) {
            this.stopEngine();
            return;
        }
        const list = Array.isArray(players) ? players : [];
        const localIndex = Number(options.localPlayerIndex);
        let source = null;
        if (Number.isInteger(localIndex)) {
            source = list.find((player) => player && player.index === localIndex && player.isBot !== true) || null;
        }
        if (!source) {
            source = list.find((player) => player && player.isBot !== true && player.alive !== false) || null;
        }
        if (!source || source.alive === false) {
            this.stopEngine();
            return;
        }
        this.updateEngine({
            alive: true,
            speed: source.speed,
            baseSpeed: source.baseSpeed,
            boosting: source.isBoosting === true || (Number(source.boostPortalTimer) || 0) > 0,
        });
    }

    dispose() {
        this.stopEngine();
        for (const [stream, destination] of this._recordingDestinations) {
            try { this._masterGain?.disconnect?.(destination); } catch { /* best effort */ }
            for (const track of stream?.getTracks?.() || []) {
                try { track.stop(); } catch { /* best effort */ }
            }
        }
        this._recordingDestinations.clear();
        if (this._engine) {
            try { this._engine.body.stop(); } catch { /* ignore */ }
            try { this._engine.hum.stop(); } catch { /* ignore */ }
            this._engine = null;
        }
        this._removeInitListeners();
        this._removeAllWindowListeners();
        this._onInitInteraction = null;
        if (this.ctx && typeof this.ctx.close === 'function') {
            this.ctx.close().catch(() => {});
        }
        this.ctx = null;
        this._masterGain = null;
        this._sfxGain = null;
        this._engineGain = null;
        this.buffers = {};
        this._debugEvents = [];
        this._registeredWindowListeners = [];
        this._activeVoices = 0;
    }
}
