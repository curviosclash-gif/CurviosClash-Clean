// ============================================
// Audio.js - Mixed recorded and synthesized game audio
// ============================================
// AudioManager is the facade: mixer, voices, ambience and event dispatch live in ./audio/.

import { SOUND_COOLDOWNS_MS } from './audio/AudioEventProfiles.js';
import { createLogger } from '../shared/logging/Logger.js';
import { normalizeAudioSettings } from '../shared/contracts/AudioSettingsContract.js';
import { createExplosionChainState } from './audio/ExplosionVoice.js';
import { MUSIC_STATES, ProceduralMusicDirector } from './audio/ProceduralMusicDirector.js';
import { playGameplayVoice } from './audio/GameplayVoices.js';
import { disposeMapAmbienceVoice } from './audio/MapAmbienceVoice.js';
import {
    AUDIO_THIRD_PARTY_NOTICE_URL,
    loadRecordedAudioSamples,
    playRecordedAudioSample,
} from './audio/RecordedAudioSamples.js';
import { disposeEngineVoice, ensureEngineVoice, stopEngineVoice, updateEngineVoice } from './audio/EngineVoice.js';
import { createAudioOutputGuard } from './audio/AudioOutputGuard.js';
import {
    acquireRecordingStream,
    applyAudioSettings,
    applyBusGains,
    buildAudioBuses,
    clampAudioValue,
    clearAudioGraphRefs,
    duckMusic,
    releaseRecordingDestinations,
    setAudioMuted,
    setBusVolume,
} from './audio/AudioMixer.js';
import {
    applyEnvelopeGain,
    createVoiceGraph,
    generateNoiseBuffers,
    playLayeredVoice,
    playNoiseVoice,
    playToneVoice,
    releaseVoice,
    resolveDistanceAttenuation,
    resolveVoiceDestination,
    resolveVoiceIntensity,
    startOscillator,
} from './audio/VoiceGraph.js';
import {
    clearMapAmbience,
    disposeAmbienceBed,
    ensureAmbienceBed,
    playMapCollapseVoice,
    setAmbienceForState,
    syncEngineFromPlayers,
    syncMapAmbienceFromPlayers,
} from './audio/AudioAmbience.js';
import { playAudioEvent, recordAudioDebugEvent } from './audio/AudioPlayback.js';

export { resolveLocalAudioSource } from './audio/AudioAmbience.js';

const logger = createLogger('AudioManager');
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
        this._audioOutputGuard = createAudioOutputGuard();
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
            window.removeEventListener(entry.type, entry.listener, true);
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
            void this._audioOutputGuard.pin(this.ctx);
            buildAudioBuses(this);
            this._applyBusGains();
            this._generateBuffers();
            this._sampleLoadPromise = loadRecordedAudioSamples(this);
            this._ensureAmbienceNodes();
            if (this.enabled) this.music.start();
        } catch (error) {
            this.enabled = false;
            clearAudioGraphRefs(this);
            this.buffers = {};
            this._audioInitFailed = true;
            logger.warn('AudioContext initialization failed; audio muted.', error);
            this._debugLog('AudioContext init failed', {
                error: error instanceof Error ? error.message : String(error || ''),
            });
        }
    }

    _generateBuffers() { generateNoiseBuffers(this); }
    _clamp(value, min, max) { return clampAudioValue(value, min, max); }
    _applyBusGains() { applyBusGains(this); }
    _sfxOut() { return this._sfxGain || this._masterGain || this.ctx.destination; }
    _musicOut() { return this._musicGain || this._masterGain || this.ctx?.destination || null; }
    _uiOut() { return this._uiGain || this._sfxOut(); }
    _ambienceOut() { return this._ambienceGain || this._masterGain || this.ctx?.destination || null; }

    /** Close-blast deafness: world sound goes dull under a faint ring, then recovers. */
    muffle(intensity, seconds) {
        if (this.enabled) this._hearing?.trigger(intensity, seconds);
    }

    acquireRecordingStream() { return acquireRecordingStream(this); }

    _resolveTime() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    _intensity(options = {}, fallback = 1, min = 0.2, max = 1.5) { return resolveVoiceIntensity(options, fallback, min, max); }
    _distanceAttenuation(options = {}) { return resolveDistanceAttenuation(options); }
    _resolveVoiceDestination(bus = 'sfx') { return resolveVoiceDestination(this, bus); }
    _playRecordedSample(key, config = {}) { return playRecordedAudioSample(this, key, config); }
    _createVoiceGraph(options = {}, bus = 'sfx') { return createVoiceGraph(this, options, bus); }
    _releaseVoice(duration = 0.2) { releaseVoice(this, duration); }
    _envGain(gainNode, peak, duration, options = {}) { applyEnvelopeGain(this, gainNode, peak, duration, options); }
    _startOsc(type, startFreq, endFreq, duration, gainNode, ramp = 'exp') { return startOscillator(this, type, startFreq, endFreq, duration, gainNode, ramp); }

    /**
     * @param {{type?: OscillatorType, startFreq?: number, endFreq?: number, duration?: number, peak?: number, attack?: number, hold?: number, ramp?: string, options?: any}} tone
     */
    _playTone(tone) { playToneVoice(this, tone); }
    _playLayered(layers, options = {}) { playLayeredVoice(this, layers, options); }
    _playNoise(config = {}) { playNoiseVoice(this, config); }
    _duckMusic(amount = 0.42, duration = 0.24) { duckMusic(this, amount, duration); }
    _recordDebugEvent(type, options = {}) { recordAudioDebugEvent(this, type, options); }

    getRecentEvents(limit = 10) {
        const size = Math.max(0, Number(limit) || 0);
        return size > 0 ? this._debugEvents.slice(-size) : [];
    }

    clearDebugEvents() {
        this._debugEvents.length = 0;
        this.lastPlayTime = {};
    }

    setMasterVolume(volume) { return setBusVolume(this, 'volume', volume); }
    getMasterVolume() { return this.volume; }
    applySettings(settings = {}) { return applyAudioSettings(this, settings); }

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

    setSfxVolume(volume) { return setBusVolume(this, 'sfxVolume', volume); }
    setEngineVolume(volume) { return setBusVolume(this, 'engineVolume', volume); }
    setMusicVolume(volume) { return setBusVolume(this, 'musicVolume', volume); }
    setUiVolume(volume) { return setBusVolume(this, 'uiVolume', volume); }
    setAmbienceVolume(volume) { return setBusVolume(this, 'ambienceVolume', volume); }
    setMuted(muted) { return setAudioMuted(this, muted); }

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

    play(type, options = {}) { playAudioEvent(this, type, options); }

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
    _playUiReject(options = {}) { playGameplayVoice(this, 'UI_REJECT', options); }
    _playExclusionWarning(options = {}) { playGameplayVoice(this, 'EXCLUSION_WARNING', options); }

    _ensureAmbienceNodes() { ensureAmbienceBed(this); }
    _setAmbienceForState(state) { setAmbienceForState(this, state); }
    _ensureEngineNodes() { ensureEngineVoice(this); }
    updateEngine(state = {}) { updateEngineVoice(this, state); }
    stopEngine() { stopEngineVoice(this); }
    syncEngineFromPlayers(players = [], options = {}) { syncEngineFromPlayers(this, players, options); }
    syncMapAmbienceFromPlayers(players = [], options = {}) { return syncMapAmbienceFromPlayers(this, players, options); }
    playMapCollapse(position, scale = 1) { playMapCollapseVoice(this, position, scale); }
    clearMapAmbience() { return clearMapAmbience(this); }

    dispose() {
        this.stopEngine();
        this.music?.dispose?.();
        releaseRecordingDestinations(this);
        for (const timer of this._voiceReleaseTimers) clearTimeout(timer);
        this._voiceReleaseTimers.clear();
        disposeEngineVoice(this);
        disposeMapAmbienceVoice(this);
        disposeAmbienceBed(this);
        this._removeInitListeners();
        this._removeAllWindowListeners();
        this._audioOutputGuard?.dispose();
        this._onInitInteraction = null;
        if (this.ctx && typeof this.ctx.close === 'function') {
            this.ctx.close().catch(() => {});
        }
        clearAudioGraphRefs(this);
        this._hearing = null;
        this._sampleLoadPromise = null;
        this._audioOutputGuard = null;
        this._recordedMgIndex = 0;
        this.buffers = {};
        this._debugEvents = [];
        this._registeredWindowListeners = [];
        this._activeVoices = 0;
        this._mapAmbienceSyncOptions = null;
    }
}
