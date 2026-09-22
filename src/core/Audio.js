import { playNotreDameCollapse } from './audio/MapAmbienceVoice.js';
// ============================================
// Audio.js - Mixed recorded and synthesized game audio
// ============================================

import { HIGH_IMPACT_EVENTS, SOUND_COOLDOWNS_MS } from './audio/AudioEventProfiles.js';
import { createLogger } from '../shared/logging/Logger.js';
import { normalizeAudioSettings } from '../shared/contracts/AudioSettingsContract.js';
import { createExplosionChainState, playExplosionVoice, playRocketImpactVoice, resetExplosionChain, resolveExplosionEcho } from './audio/ExplosionVoice.js';
import { MUSIC_STATES, ProceduralMusicDirector } from './audio/ProceduralMusicDirector.js';
import { playGameplayVoice } from './audio/GameplayVoices.js';
import {
    disposeMapAmbienceVoice,
    syncMapAmbienceVoice,
} from './audio/MapAmbienceVoice.js';
import {
    AUDIO_THIRD_PARTY_NOTICE_URL,
    loadRecordedAudioSamples,
    playRecordedAudioSample,
} from './audio/RecordedAudioSamples.js';
import { disposeEngineVoice, ensureEngineVoice, stopEngineVoice, updateEngineVoice } from './audio/EngineVoice.js';

const logger = createLogger('AudioManager');
const DEFAULT_COOLDOWN_MS = 50;
const MAX_ACTIVE_VOICES = 18;
const AUDIO_INIT_EVENT_TYPES = ['pointerdown', 'click', 'keydown', 'touchstart'];

function isDevEnvironment() {
    try {
        return Boolean(import.meta?.env?.DEV);
    } catch {
        return false;
    }
}

export class AudioManager {
    constructor(settings = {}) {
        const audioSettings = normalizeAudioSettings(settings);
        this.ctx = null;
        this.enabled = audioSettings.enabled;
        this.volume = audioSettings.masterVolume;
        this.sfxVolume = audioSettings.sfxVolume;
        this.engineVolume = audioSettings.engineVolume;
        this.musicVolume = audioSettings.musicVolume;
        this.uiVolume = audioSettings.uiVolume;
        this.ambienceVolume = audioSettings.ambienceVolume;
        this.buffers = {};
        this._masterGain = null;
        this._sfxGain = null;
        this._engineGain = null;
        this._musicGain = null;
        this._uiGain = null;
        this._ambienceGain = null;
        this._compressor = null;
        this._outputNode = null;
        this._engine = null;
        this._ambience = null;
        this._mapAmbience = null;
        this._mapAmbienceSyncOptions = {
            profile: null,
            playerPosition: null,
            mapScale: 1,
        };
        this._activeVoices = 0;
        this._isDevEnvironment = isDevEnvironment();
        this._audioInitFailed = false;
        this._debugEvents = [];
        this._maxDebugEvents = 24;
        this._registeredWindowListeners = [];
        this._recordingDestinations = new Map();
        this._voiceReleaseTimers = new Set();
        this._sampleLoadPromise = null;
        this._recordedMgIndex = 0;
        this.thirdPartyAudioNoticeUrl = AUDIO_THIRD_PARTY_NOTICE_URL;

        this.lastPlayTime = {};
        this.cooldowns = { ...SOUND_COOLDOWNS_MS };
        this._explosionChain = createExplosionChainState();
        this.music = new ProceduralMusicDirector(this);

        this._onInitInteraction = () => {
            this._init();
            this._removeInitListeners();
        };

        for (const eventType of AUDIO_INIT_EVENT_TYPES) {
            this._addWindowListener(eventType, this._onInitInteraction);
        }
    }

    _addWindowListener(type, listener) {
        window.addEventListener(type, listener, true);
        this._registeredWindowListeners.push({ type, listener });
    }

    _removeWindowListener(type, listener) {
        window.removeEventListener(type, listener, true);
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
        const AudioContext = window.AudioContext || /** @type {Window & {webkitAudioContext?: typeof globalThis.AudioContext}} */ (window).webkitAudioContext;
        if (!AudioContext) return;
        try {
            this.ctx = new AudioContext();
            this._masterGain = this.ctx.createGain();
            this._sfxGain = this.ctx.createGain();
            this._engineGain = this.ctx.createGain();
            this._musicGain = this.ctx.createGain();
            this._uiGain = this.ctx.createGain();
            this._ambienceGain = this.ctx.createGain();
            this._sfxGain.connect(this._masterGain);
            this._engineGain.connect(this._masterGain);
            this._musicGain.connect(this._masterGain);
            this._uiGain.connect(this._masterGain);
            this._ambienceGain.connect(this._masterGain);
            if (typeof this.ctx.createDynamicsCompressor === 'function') {
                this._compressor = this.ctx.createDynamicsCompressor();
                this._compressor.threshold.value = -12;
                this._compressor.knee.value = 12;
                this._compressor.ratio.value = 5;
                this._compressor.attack.value = 0.004;
                this._compressor.release.value = 0.18;
                this._masterGain.connect(this._compressor);
                this._compressor.connect(this.ctx.destination);
                this._outputNode = this._compressor;
            } else {
                this._masterGain.connect(this.ctx.destination);
                this._outputNode = this._masterGain;
            }
            this._applyBusGains();
            this._generateBuffers();
            const context = this.ctx;
            this._sampleLoadPromise = loadRecordedAudioSamples(this).then((samples) => {
                const hasRecordedMusic = samples.classicalMusic || samples.fightMusic || samples.arcadeMusic;
                if (this.ctx === context && this.enabled && hasRecordedMusic) {
                    this.music.start({ crossfade: true });
                }
                return samples;
            });
            this._ensureAmbienceNodes();
            if (this.enabled) this.music.start();
        } catch (error) {
            this.enabled = false;
            this.ctx = null;
            this._masterGain = null;
            this._sfxGain = null;
            this._engineGain = null;
            this._musicGain = null;
            this._uiGain = null;
            this._ambienceGain = null;
            this._compressor = null;
            this._outputNode = null;
            this.buffers = {};
            this._audioInitFailed = true;
            logger.warn('AudioContext initialization failed; audio muted.', error);
            this._debugLog('AudioContext init failed', {
                error: error instanceof Error ? error.message : String(error || ''),
            });
        }
    }

    _generateBuffers() {
        const duration = 1.25;
        const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const textureBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
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
        this.buffers.explosion = buffer;
        this.buffers.musicNoise = textureBuffer;
    }

    _clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    _applyBusGains() {
        const master = this.enabled ? this._clamp(this.volume, 0, 1) : 0;
        if (this._masterGain) this._masterGain.gain.value = master;
        if (this._sfxGain) this._sfxGain.gain.value = this._clamp(this.sfxVolume, 0, 1);
        if (this._engineGain) this._engineGain.gain.value = this._clamp(this.engineVolume, 0, 1);
        if (this._musicGain) this._musicGain.gain.value = this._clamp(this.musicVolume, 0, 1);
        if (this._uiGain) this._uiGain.gain.value = this._clamp(this.uiVolume, 0, 1);
        if (this._ambienceGain) this._ambienceGain.gain.value = this._clamp(this.ambienceVolume, 0, 1);
    }

    _sfxOut() {
        return this._sfxGain || this._masterGain || this.ctx.destination;
    }

    _musicOut() {
        return this._musicGain || this._masterGain || this.ctx?.destination || null;
    }

    _uiOut() {
        return this._uiGain || this._sfxOut();
    }

    _ambienceOut() {
        return this._ambienceGain || this._masterGain || this.ctx?.destination || null;
    }

    acquireRecordingStream() {
        this._init();
        if (!this.ctx || !this._masterGain || typeof this.ctx.createMediaStreamDestination !== 'function') {
            return null;
        }
        try {
            const destination = this.ctx.createMediaStreamDestination();
            const outputNode = this._outputNode || this._masterGain;
            outputNode.connect(destination);
            const stream = destination.stream;
            const release = () => {
                const activeDestination = this._recordingDestinations.get(stream);
                if (!activeDestination) return;
                this._recordingDestinations.delete(stream);
                try {
                    outputNode?.disconnect?.(activeDestination);
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

    _resolveVoiceDestination(bus = 'sfx') {
        if (bus === 'ui') return this._uiOut();
        if (bus === 'ambience') return this._ambienceOut();
        return this._sfxOut();
    }

    _playRecordedSample(key, config = {}) {
        return playRecordedAudioSample(this, key, config);
    }

    _createVoiceGraph(options = {}, bus = 'sfx') {
        if (this._activeVoices >= MAX_ACTIVE_VOICES) return null;
        const gain = this.ctx.createGain();
        /** @type {AudioNode} */
        let tail = gain;
        const spatialPosition = options.spatialPosition;
        const hasSpatialPosition = spatialPosition
            && [spatialPosition.x, spatialPosition.y, spatialPosition.z]
                .every((value) => Number.isFinite(Number(value)));
        if (hasSpatialPosition && typeof this.ctx.createPanner === 'function') {
            const panner = this.ctx.createPanner();
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
        } else if (Number.isFinite(Number(options.pan)) && typeof this.ctx.createStereoPanner === 'function') {
            const panner = this.ctx.createStereoPanner();
            panner.pan.value = this._clamp(Number(options.pan), -1, 1);
            gain.connect(panner);
            tail = panner;
        }
        tail.connect(this._resolveVoiceDestination(bus));
        this._activeVoices += 1;
        return gain;
    }

    _releaseVoice(duration = 0.2) {
        const ms = Math.max(50, Math.ceil((Number(duration) || 0.2) * 1000) + 30);
        const timer = setTimeout(() => {
            this._voiceReleaseTimers.delete(timer);
            this._activeVoices = Math.max(0, this._activeVoices - 1);
        }, ms);
        timer?.unref?.();
        this._voiceReleaseTimers.add(timer);
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

    /**
     * @param {{type?: OscillatorType, startFreq?: number, endFreq?: number, duration?: number, peak?: number, attack?: number, hold?: number, ramp?: string, options?: any}} tone
     */
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
        const gain = this._createVoiceGraph(options, options.bus);
        if (!gain) return;
        const atten = this._distanceAttenuation(options);
        this._envGain(gain, peak * atten, duration, { attack, hold });
        this._startOsc(type, startFreq, endFreq, duration, gain, ramp);
        this._releaseVoice(duration);
    }

    _playLayered(layers, options = {}) {
        const gain = this._createVoiceGraph(options, options.bus);
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

    _playNoise({
        duration = 0.1,
        peak = 0.1,
        filterType = 'bandpass',
        startFrequency = 1800,
        endFrequency = 420,
        options = {},
        bus = 'sfx',
    } = {}) {
        const buffer = this.buffers.musicNoise;
        if (!buffer) return;
        const gain = this._createVoiceGraph(options, bus);
        if (!gain) return;
        const source = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const t = this.ctx.currentTime;
        const atten = this._distanceAttenuation(options);
        source.buffer = buffer;
        if (source.playbackRate) source.playbackRate.value = 0.94 + Math.random() * 0.12;
        filter.type = /** @type {BiquadFilterType} */ (filterType);
        filter.Q.value = filterType === 'bandpass' ? 0.9 : 0.5;
        filter.frequency.setValueAtTime(Math.max(40, startFrequency), t);
        filter.frequency.exponentialRampToValueAtTime?.(Math.max(40, endFrequency), t + duration);
        this._envGain(gain, peak * atten, duration, { attack: 0.003 });
        source.connect(filter);
        filter.connect(gain);
        source.start(t);
        source.stop?.(t + duration + 0.02);
        this._releaseVoice(duration);
    }

    _duckMusic(amount = 0.42, duration = 0.24) {
        const gain = this._musicGain?.gain;
        if (!gain || !this.ctx) return;
        const t = this.ctx.currentTime;
        const base = this._clamp(this.musicVolume, 0, 1);
        gain.cancelScheduledValues?.(t);
        gain.setValueAtTime?.(Math.max(0.0001, gain.value), t);
        gain.setTargetAtTime?.(Math.max(0.0001, base * amount), t, 0.018);
        gain.setTargetAtTime?.(base, t + duration, 0.09);
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

    applySettings(settings = {}) {
        const wasEnabled = this.enabled;
        const normalized = normalizeAudioSettings(settings, this.getSettings());
        this.enabled = normalized.enabled;
        this.volume = normalized.masterVolume;
        this.sfxVolume = normalized.sfxVolume;
        this.engineVolume = normalized.engineVolume;
        this.musicVolume = normalized.musicVolume;
        this.uiVolume = normalized.uiVolume;
        this.ambienceVolume = normalized.ambienceVolume;
        this._applyBusGains();
        if (!this.enabled) {
            this.stopEngine();
            this.music?.stop?.();
        } else {
            if (!wasEnabled && this.ctx) this.music?.start?.({ crossfade: true });
        }
        return this.getSettings();
    }

    getSettings() {
        return {
            enabled: this.enabled,
            masterVolume: this.volume,
            musicVolume: this.musicVolume,
            sfxVolume: this.sfxVolume,
            engineVolume: this.engineVolume,
            uiVolume: this.uiVolume,
            ambienceVolume: this.ambienceVolume,
        };
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

    setMusicVolume(volume) {
        this.musicVolume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.musicVolume;
    }

    setUiVolume(volume) {
        this.uiVolume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.uiVolume;
    }

    setAmbienceVolume(volume) {
        this.ambienceVolume = this._clamp(Number(volume) || 0, 0, 1);
        this._applyBusGains();
        return this.ambienceVolume;
    }

    setMuted(muted) {
        this.enabled = muted !== true;
        this._applyBusGains();
        if (!this.enabled) {
            this.stopEngine();
            this.music?.stop?.();
        } else if (this.ctx) {
            this.music?.start?.({ crossfade: true });
        }
        this._debugLog(`Audio ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
        return !this.enabled;
    }

    isMuted() {
        return !this.enabled;
    }

    toggleMute() {
        return this.setMuted(this.enabled);
    }

    setMusicState(state, options = {}) {
        const resolvedState = this.music?.setState?.(state, options) || MUSIC_STATES.MENU;
        this._setAmbienceForState(resolvedState);
        return resolvedState;
    }

    setMusicIntensity(value) {
        return this.music?.setIntensity?.(value) ?? 0;
    }

    setPaused(paused) {
        this.music?.setPaused?.(paused === true);
        if (paused === true) this.stopEngine();
        return paused === true;
    }

    play(type, options = {}) {
        if (!this.enabled || !this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this._resolveTime();
        const last = this.lastPlayTime[type] || 0;
        const cooldown = this.cooldowns[type] || DEFAULT_COOLDOWN_MS;
        const cooldownBlocked = now - last < cooldown;
        if (cooldownBlocked) {
            // Only explosions answer a blocked shot, and only twice per window, so
            // a chain reaction stays audible without a mass wipe turning to noise.
            const echo = type === 'EXPLOSION' ? resolveExplosionEcho(this._explosionChain) : null;
            if (!echo) return;
            options = { ...options, ...echo };
        } else if (type === 'EXPLOSION') {
            resetExplosionChain(this._explosionChain);
        }
        if (!cooldownBlocked) this.lastPlayTime[type] = now;
        this._recordDebugEvent(type, options);
        if (HIGH_IMPACT_EVENTS.has(type)) this._duckMusic();

        switch (type) {
            case 'SHOOT': this._playShoot(options); break;
            case 'MG_SHOOT': this._playMgShoot(options); break;
            case 'ROCKET_SHOOT': this._playRocketShoot(options); break;
            case 'EXPLOSION': playExplosionVoice(this, options); break;
            case 'REACTOR_BREACH': playRocketImpactVoice(this, options); break;
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
            case 'UI_REJECT': this._playUiReject(options); break; case 'EXCLUSION_WARNING': this._playExclusionWarning(options); break;
            default: playGameplayVoice(this, type, options); break;
        }
    }

    _playShoot(options = {}) { playGameplayVoice(this, 'SHOOT', options); }
    _playMgShoot(options = {}) { playGameplayVoice(this, 'MG_SHOOT', options); }
    _playRocketShoot(options = {}) { playGameplayVoice(this, 'ROCKET_SHOOT', options); }
    _playHit(options = {}) { playGameplayVoice(this, 'HIT', options); }
    _playMgHit(options = {}) { playGameplayVoice(this, 'MG_HIT', options); }
    _playShieldHit(options = {}) { playGameplayVoice(this, 'SHIELD_HIT', options); }
    _playPowerup(options = {}) { playGameplayVoice(this, 'POWERUP', options); }
    _playPickup(options = {}) { playGameplayVoice(this, 'PICKUP', options); }
    _playPortal(options = {}) { playGameplayVoice(this, 'PORTAL', options); }
    _playSlingshot(options = {}) { playGameplayVoice(this, 'SLINGSHOT', options); }
    _playBoost(options = {}) { playGameplayVoice(this, 'BOOST', options); }
    _playParcoursCheckpoint(options = {}) { playGameplayVoice(this, 'PARCOURS_CP', options); }
    _playParcoursBranch(options = {}) { playGameplayVoice(this, 'PARCOURS_BRANCH', options); }
    _playParcoursFinish(options = {}) { playGameplayVoice(this, 'PARCOURS_FINISH', options); }
    _playParcoursWrong(options = {}) { playGameplayVoice(this, 'PARCOURS_WRONG', options); }
    _playParcoursTimeout(options = {}) { playGameplayVoice(this, 'PARCOURS_TIMEOUT', options); }
    _playFightKill(options = {}) { playGameplayVoice(this, 'FIGHT_KILL', options); }
    _playFightAssist(options = {}) { playGameplayVoice(this, 'FIGHT_ASSIST', options); }
    _playFightLead(options = {}) { playGameplayVoice(this, 'FIGHT_LEAD', options); }
    _playUiDrop(options = {}) { playGameplayVoice(this, 'UI_DROP', options); }
    _playUiPickup(options = {}) { playGameplayVoice(this, 'UI_PICKUP', options); }
    _playUiReject(options = {}) { playGameplayVoice(this, 'UI_REJECT', options); } _playExclusionWarning(options = {}) { playGameplayVoice(this, 'EXCLUSION_WARNING', options); }
    _ensureAmbienceNodes() {
        if (!this.ctx || this._ambience || !this.buffers.musicNoise) return;
        const source = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        source.buffer = this.buffers.musicNoise;
        source.loop = true;
        filter.type = 'bandpass';
        filter.frequency.value = 240;
        filter.Q.value = 0.45;
        gain.gain.value = 0.012;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this._ambienceOut());
        source.start(this.ctx.currentTime);
        this._ambience = { source, filter, gain };
        this._setAmbienceForState(this.music?.state || MUSIC_STATES.MENU);
    }

    _setAmbienceForState(state) {
        const ambience = this._ambience;
        if (!ambience || !this.ctx) return;
        const targets = {
            [MUSIC_STATES.MENU]: { gain: 0.009, frequency: 210 },
            [MUSIC_STATES.RACE]: { gain: 0.018, frequency: 360 },
            [MUSIC_STATES.FIGHT]: { gain: 0.024, frequency: 480 },
            [MUSIC_STATES.RESULTS]: { gain: 0.012, frequency: 280 },
        };
        const target = targets[state] || targets[MUSIC_STATES.MENU];
        const t = this.ctx.currentTime;
        ambience.gain.gain.setTargetAtTime?.(target.gain, t, 0.35);
        ambience.filter.frequency.setTargetAtTime?.(target.frequency, t, 0.45);
    }

    _ensureEngineNodes() {
        ensureEngineVoice(this);
    }

    updateEngine(state = {}) {
        updateEngineVoice(this, state);
    }

    stopEngine() {
        stopEngineVoice(this);
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

    syncMapAmbienceFromPlayers(players = [], options = {}) {
        if (!this._mapAmbienceSyncOptions) return 'unavailable';
        const list = Array.isArray(players) ? players : [];
        const localIndex = Number(options.localPlayerIndex);
        let source = Number.isInteger(localIndex)
            ? list.find((player) => player && player.index === localIndex && player.isBot !== true)
            : null;
        if (!source) source = list.find((player) => player && player.isBot !== true && player.alive !== false) || null;
        const syncOptions = this._mapAmbienceSyncOptions;
        syncOptions.profile = options.fireProgress > 0 ? options.mapDefinition?.fireAudioProfile || options.mapDefinition?.audioProfile : options.mapDefinition?.audioProfile || null;
        syncOptions.fireProgress = options.fireProgress;
        syncOptions.playerPosition = source?.alive === false ? null : source?.position;
        syncOptions.mapScale = options.mapScale;
        syncOptions.elapsedSeconds = options.elapsedSeconds; syncOptions.sandstormState = options.sandstormState || null;
        return syncMapAmbienceVoice(this, syncOptions);
    }

    playMapCollapse(position, scale = 1) {
        const listener = this._mapAmbienceSyncOptions?.playerPosition;
        if (!this.ctx || !listener) return;
        playNotreDameCollapse(this, { collapse: { position, audibleRadius: 170 } }, listener, scale);
    }

    clearMapAmbience() {
        const syncOptions = this._mapAmbienceSyncOptions;
        if (!syncOptions) return 'unavailable';
        syncOptions.profile = null;
        syncOptions.playerPosition = null;
        syncOptions.elapsedSeconds = 0;
        return syncMapAmbienceVoice(this, syncOptions);
    }

    dispose() {
        this.stopEngine();
        this.music?.dispose?.();
        for (const [stream, destination] of this._recordingDestinations) {
            try { (this._outputNode || this._masterGain)?.disconnect?.(destination); } catch { /* best effort */ }
            for (const track of stream?.getTracks?.() || []) {
                try { track.stop(); } catch { /* best effort */ }
            }
        }
        this._recordingDestinations.clear();
        for (const timer of this._voiceReleaseTimers) clearTimeout(timer);
        this._voiceReleaseTimers.clear();
        disposeEngineVoice(this);
        disposeMapAmbienceVoice(this);
        if (this._ambience) {
            try { this._ambience.source.stop(); } catch { /* ignore */ }
            this._ambience = null;
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
        this._musicGain = null;
        this._uiGain = null;
        this._ambienceGain = null;
        this._compressor = null;
        this._outputNode = null;
        this._sampleLoadPromise = null;
        this._recordedMgIndex = 0;
        this.buffers = {};
        this._debugEvents = [];
        this._registeredWindowListeners = [];
        this._activeVoices = 0;
        this._mapAmbienceSyncOptions = null;
    }
}
