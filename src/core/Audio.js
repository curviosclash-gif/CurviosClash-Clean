// ============================================
// Audio.js - Synthesized Sound Effects (No assets needed)
// ============================================

import { createLogger } from '../shared/logging/Logger.js';

const logger = createLogger('AudioManager');
const DEFAULT_COOLDOWN_MS = 50;
const DEFAULT_MASTER_VOLUME = 0.15;

const SOUND_COOLDOWNS_MS = Object.freeze({
    SHOOT: 100,
    MG_SHOOT: 50,
    ROCKET_SHOOT: 180,
    EXPLOSION: 200,
    HIT: 100,
    MG_HIT: 70,
    ROCKET_IMPACT: 160,
    SHIELD_HIT: 70,
    POWERUP: 500,
    BOOST: 200,
    PARCOURS_CP: 80,
    PARCOURS_BRANCH: 140,
    PARCOURS_FINISH: 650,
    FIGHT_KILL: 120,
    FIGHT_ASSIST: 180,
    FIGHT_LEAD: 800,
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
        this.buffers = {};
        this._masterGain = null;
        this._isDevEnvironment = isDevEnvironment();
        this._audioInitFailed = false;
        this._debugEvents = [];
        this._maxDebugEvents = 24;
        this._registeredWindowListeners = [];

        // Throttling Logic
        this.lastPlayTime = {}; // { 'EXPLOSION': 123456789 }
        this.cooldowns = { ...SOUND_COOLDOWNS_MS };

        // Initialize on first user interaction (browser policy)
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
            this._applyMasterGain();
            this._masterGain.connect(this.ctx.destination);
            this._generateBuffers();
        } catch (error) {
            this.enabled = false;
            this.ctx = null;
            this._masterGain = null;
            this.buffers = {};
            this._audioInitFailed = true;
            logger.warn('AudioContext initialization failed; audio muted.', error);
            this._debugLog('AudioContext init failed', {
                error: error instanceof Error ? error.message : String(error || ''),
            });
        }
    }

    _generateBuffers() {
        // Explosion Buffer (Noise)
        const duration = 0.3;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this.buffers.explosion = buffer;
    }

    _clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    _applyMasterGain() {
        if (!this._masterGain) return;
        const level = this.enabled ? this._clamp(this.volume, 0, 1) : 0;
        this._masterGain.gain.value = level;
    }

    _output() {
        return this._masterGain || this.ctx.destination;
    }

    _resolveTime() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
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
        this._applyMasterGain();
        return this.volume;
    }

    getMasterVolume() {
        return this.volume;
    }

    setMuted(muted) {
        this.enabled = muted !== true;
        this._applyMasterGain();
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

        // Check Cooldown
        const now = this._resolveTime();
        const last = this.lastPlayTime[type] || 0;
        const cooldown = this.cooldowns[type] || DEFAULT_COOLDOWN_MS;

        if (now - last < cooldown) return;
        this.lastPlayTime[type] = now;
        this._recordDebugEvent(type, options);

        switch (type) {
            case 'SHOOT': this._playShoot(options); break;
            case 'MG_SHOOT': this._playMgShoot(options); break;
            case 'ROCKET_SHOOT': this._playRocketShoot(options); break;
            case 'EXPLOSION': this._playExplosion(options); break;
            case 'HIT': this._playHit(options); break;
            case 'MG_HIT': this._playMgHit(options); break;
            case 'ROCKET_IMPACT': this._playRocketImpact(options); break;
            case 'SHIELD_HIT': this._playShieldHit(options); break;
            case 'POWERUP': this._playPowerup(options); break;
            case 'BOOST': this._playBoost(options); break;
            case 'PARCOURS_CP': this._playParcoursCheckpoint(options); break;
            case 'PARCOURS_BRANCH': this._playParcoursBranch(options); break;
            case 'PARCOURS_FINISH': this._playParcoursFinish(options); break;
            case 'FIGHT_KILL': this._playFightKill(options); break;
            case 'FIGHT_ASSIST': this._playFightAssist(options); break;
            case 'FIGHT_LEAD': this._playFightLead(options); break;
        }
    }

    _playShoot(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.85, 0.2, 1.3);

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.5 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    _playMgShoot(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.75, 0.2, 1.2);

        osc.type = 'square';
        osc.frequency.setValueAtTime(1450, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(260, this.ctx.currentTime + 0.06);

        gain.gain.setValueAtTime(0.22 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.06);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.06);
    }

    _playRocketShoot(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.9, 0.25, 1.3);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(72, this.ctx.currentTime + 0.22);

        gain.gain.setValueAtTime(0.42 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.22);
    }

    _playExplosion(options = {}) {
        if (!this.buffers.explosion) return;

        const noise = this.ctx.createBufferSource();
        noise.buffer = this.buffers.explosion;
        const intensity = this._clamp(Number(options.intensity) || 1, 0.25, 1.5);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + 0.3);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this._output());

        noise.start();
    }

    _playHit(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.9, 0.2, 1.4);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200 * (0.85 + intensity * 0.2), this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.8 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    _playMgHit(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.8, 0.2, 1.4);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(920, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(280, this.ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.32 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    }

    _playRocketImpact(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1, 0.3, 1.6);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(42, this.ctx.currentTime + 0.28);

        gain.gain.setValueAtTime(0.52 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.28);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.28);
        this._playExplosion({ intensity: intensity * 0.85 });
    }

    _playShieldHit(options = {}) {
        const primary = this.ctx.createOscillator();
        const secondary = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.9, 0.2, 1.3);
        const endFrequency = options.depleted ? 180 : 260;

        primary.type = 'sine';
        primary.frequency.setValueAtTime(760, this.ctx.currentTime);
        primary.frequency.exponentialRampToValueAtTime(endFrequency, this.ctx.currentTime + 0.16);

        secondary.type = 'triangle';
        secondary.frequency.setValueAtTime(1180, this.ctx.currentTime);
        secondary.frequency.exponentialRampToValueAtTime(Math.max(endFrequency * 1.8, 320), this.ctx.currentTime + 0.12);

        gain.gain.setValueAtTime(0.26 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.18);

        primary.connect(gain);
        secondary.connect(gain);
        gain.connect(this._output());

        primary.start();
        secondary.start();
        primary.stop(this.ctx.currentTime + 0.18);
        secondary.stop(this.ctx.currentTime + 0.16);
    }

    _playPowerup(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1, 0.3, 1.3);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, this.ctx.currentTime + 0.2);

        gain.gain.setValueAtTime(0.6 * intensity, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    }

    _playBoost(options = {}) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1, 0.3, 1.4);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.4 * intensity, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this._output());

        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }

    _playParcoursCheckpoint(options = {}) {
        const primary = this.ctx.createOscillator();
        const overtone = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.9, 0.25, 1.3);

        primary.type = 'sine';
        primary.frequency.setValueAtTime(1420, this.ctx.currentTime);
        primary.frequency.exponentialRampToValueAtTime(980, this.ctx.currentTime + 0.12);

        overtone.type = 'triangle';
        overtone.frequency.setValueAtTime(2120, this.ctx.currentTime);
        overtone.frequency.exponentialRampToValueAtTime(1560, this.ctx.currentTime + 0.09);

        gain.gain.setValueAtTime(0.2 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.14);

        primary.connect(gain);
        overtone.connect(gain);
        gain.connect(this._output());

        primary.start();
        overtone.start();
        primary.stop(this.ctx.currentTime + 0.14);
        overtone.stop(this.ctx.currentTime + 0.1);
    }

    _playParcoursBranch(options = {}) {
        const primary = this.ctx.createOscillator();
        const accent = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1.0, 0.3, 1.4);

        primary.type = 'triangle';
        primary.frequency.setValueAtTime(960, this.ctx.currentTime);
        primary.frequency.exponentialRampToValueAtTime(720, this.ctx.currentTime + 0.2);

        accent.type = 'square';
        accent.frequency.setValueAtTime(1480, this.ctx.currentTime);
        accent.frequency.exponentialRampToValueAtTime(1180, this.ctx.currentTime + 0.16);

        gain.gain.setValueAtTime(0.28 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);

        primary.connect(gain);
        accent.connect(gain);
        gain.connect(this._output());

        primary.start();
        accent.start();
        primary.stop(this.ctx.currentTime + 0.22);
        accent.stop(this.ctx.currentTime + 0.17);
    }

    _playParcoursFinish(options = {}) {
        const low = this.ctx.createOscillator();
        const mid = this.ctx.createOscillator();
        const high = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1.05, 0.35, 1.6);

        low.type = 'triangle';
        low.frequency.setValueAtTime(240, this.ctx.currentTime);
        low.frequency.linearRampToValueAtTime(360, this.ctx.currentTime + 0.34);

        mid.type = 'sine';
        mid.frequency.setValueAtTime(480, this.ctx.currentTime);
        mid.frequency.linearRampToValueAtTime(720, this.ctx.currentTime + 0.34);

        high.type = 'triangle';
        high.frequency.setValueAtTime(720, this.ctx.currentTime);
        high.frequency.linearRampToValueAtTime(1080, this.ctx.currentTime + 0.28);

        gain.gain.setValueAtTime(0.34 * intensity, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.12 * intensity, this.ctx.currentTime + 0.18);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.58);

        low.connect(gain);
        mid.connect(gain);
        high.connect(gain);
        gain.connect(this._output());

        low.start();
        mid.start();
        high.start();
        low.stop(this.ctx.currentTime + 0.58);
        mid.stop(this.ctx.currentTime + 0.5);
        high.stop(this.ctx.currentTime + 0.36);
    }

    _playFightKill(options = {}) {
        const body = this.ctx.createOscillator();
        const snap = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 1, 0.35, 1.5);

        body.type = 'sawtooth';
        body.frequency.setValueAtTime(320, this.ctx.currentTime);
        body.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.28);

        snap.type = 'square';
        snap.frequency.setValueAtTime(880, this.ctx.currentTime);
        snap.frequency.exponentialRampToValueAtTime(220, this.ctx.currentTime + 0.09);

        gain.gain.setValueAtTime(0.38 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

        body.connect(gain);
        snap.connect(gain);
        gain.connect(this._output());

        body.start();
        snap.start();
        body.stop(this.ctx.currentTime + 0.3);
        snap.stop(this.ctx.currentTime + 0.1);
    }

    _playFightAssist(options = {}) {
        const low = this.ctx.createOscillator();
        const high = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.85, 0.3, 1.3);

        low.type = 'triangle';
        low.frequency.setValueAtTime(420, this.ctx.currentTime);
        low.frequency.linearRampToValueAtTime(560, this.ctx.currentTime + 0.12);

        high.type = 'sine';
        high.frequency.setValueAtTime(640, this.ctx.currentTime);
        high.frequency.linearRampToValueAtTime(820, this.ctx.currentTime + 0.14);

        gain.gain.setValueAtTime(0.24 * intensity, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.18);

        low.connect(gain);
        high.connect(gain);
        gain.connect(this._output());

        low.start();
        high.start();
        low.stop(this.ctx.currentTime + 0.16);
        high.stop(this.ctx.currentTime + 0.18);
    }

    _playFightLead(options = {}) {
        const root = this.ctx.createOscillator();
        const fifth = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const intensity = this._clamp(Number(options.intensity) || 0.95, 0.35, 1.4);
        const t = this.ctx.currentTime;

        root.type = 'triangle';
        root.frequency.setValueAtTime(330, t);
        root.frequency.setValueAtTime(415, t + 0.12);
        root.frequency.setValueAtTime(494, t + 0.24);

        fifth.type = 'sine';
        fifth.frequency.setValueAtTime(494, t);
        fifth.frequency.setValueAtTime(622, t + 0.12);
        fifth.frequency.setValueAtTime(740, t + 0.24);

        gain.gain.setValueAtTime(0.3 * intensity, t);
        gain.gain.setValueAtTime(0.22 * intensity, t + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.42);

        root.connect(gain);
        fifth.connect(gain);
        gain.connect(this._output());

        root.start();
        fifth.start();
        root.stop(t + 0.42);
        fifth.stop(t + 0.38);
    }

    dispose() {
        this._removeInitListeners();
        this._removeAllWindowListeners();
        this._onInitInteraction = null;
        if (this.ctx && typeof this.ctx.close === 'function') {
            this.ctx.close().catch(() => {});
        }
        this.ctx = null;
        this._masterGain = null;
        this.buffers = {};
        this._debugEvents = [];
        this._registeredWindowListeners = [];
    }
}
