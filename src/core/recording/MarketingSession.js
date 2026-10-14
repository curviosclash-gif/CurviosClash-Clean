import { createReplaySnapshot } from './CinematicReplayRecorder.js';
import { normalizeMarketingSetup } from '../../shared/contracts/MarketingSessionContract.js';
import { createTrailStateRecorder } from './MarketingTrailState.js';
import { refreshLocalMapCatalog } from '../runtime/LocalMapCatalogRefresh.js';
import { CONFIG_BASE, refreshConfigRuntimeCache } from '../Config.js';
import { DESKTOP_LOCAL_MAP_KEYS } from '../config/maps/MapPresetsGenerated.js';

const MAX_PENDING_BYTES = 32 * 1024 * 1024;
const activeInput = (input) => Object.entries(input || {}).some(([key, value]) =>
    key.endsWith('Axis') ? Math.abs(Number(value) || 0) > 0.15 : value === true);

/** @typedef {{ hasSetup: () => boolean, setStatus: (message: string) => void, showSetup: (config: any, onStart: (values: any) => void) => void }} MarketingSessionView */

export class MarketingSession {
    /**
     * @param {any} runtime
     * @param {any} bridge
     * @param {MarketingSessionView} [view]
     */
    constructor(runtime, bridge, view = { hasSetup: () => false, setStatus() {}, showSetup() {} }) {
        this.runtime = runtime; this.bridge = bridge; this.view = view;
        this.running = false; this.sequence = 0; this.records = [];
        this.pending = Promise.resolve(); this.pendingBytes = 0;
        this.error = null; this.cleanups = []; this.match = 0; this.activeMs = 0;
        this.lastInput = new Map(); this.lastSample = 0; this.lastFlush = 0;
        this.captureTrails = createTrailStateRecorder();
    }

    async initialize() {
        if (!this.bridge) return;
        try {
            const config = await this.bridge.config();
            if (config.action === 'render') {
                const { renderMarketingReplay } = await import('./MarketingReplayRender.js');
                await this.bridge.renderResult(await renderMarketingReplay(this.runtime, config.replay, this.bridge));
                return;
            }
            this.settingsSnapshot = config.settings;
            this.showSetup(config);
        } catch (error) {
            this.fail(error);
            if (!this.view.hasSetup()) this.showSetup({ humans: 1, bots: 3 });
        }
    }

    showSetup(config) {
        this.view.showSetup(config, async (values) => {
            try {
                const setup = normalizeMarketingSetup(values);
                this.view.setStatus('Aufnahme wird vorbereitet …');
                await this.start(setup);
            } catch (error) {
                if (this.storeOpened) this.fail(error);
                throw error;
            }
        });
    }

    fail(error) {
        const firstFailure = !this.error;
        this.error ||= error?.message || String(error);
        this.view.setStatus(`Aufnahmefehler: ${this.error}. Rohdaten bleiben erhalten.`);
        if (firstFailure && this.storeOpened && this.running) {
            this.finish().catch((closeError) => {
                this.error += `; session_cleanup_failed: ${closeError?.message || String(closeError)}`;
                this.view.setStatus(`Aufnahmefehler: ${this.error}. Rohdaten bleiben erhalten.`);
            });
        }
    }

    async start(setup) {
        if (this.running || this.storeOpened) throw new Error('Für einen neuen Versuch den Aufnahmestarter neu öffnen.');
        this.setup = setup;
        this.stream = null; this.releaseAudio = null;
        let display;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
            });
            const audio = this.runtime.audio?.acquireRecordingStream?.();
            if (!audio?.stream?.getAudioTracks().length) {
                throw new Error('Kein Spielton verfügbar. Die Partie wurde nicht gestartet.');
            }
            this.releaseAudio = audio.release;
            this.stream = new MediaStream([...display.getVideoTracks(), ...audio.stream.getAudioTracks()]);
            await this.runtime.audio.ctx?.resume?.();
            await this.bridge.begin(setup);
            this.storeOpened = true;
            this.epoch = performance.now(); this.lastTick = this.epoch;
            this.media = new MediaRecorder(this.stream, { mimeType: 'video/webm;codecs=vp8,opus',
                videoBitsPerSecond: 18_000_000, audioBitsPerSecond: 192_000, videoKeyFrameIntervalDuration: 2000 });
            this.media.addEventListener('dataavailable', ({ data }) => {
                if (data.size) this.send('media', data.size, async () => ({ bytes: new Uint8Array(await data.arrayBuffer()) }));
            });
            this.media.addEventListener('error', (event) => this.fail(event.error || 'media_recorder_error'));
            this.stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
                if (this.running) this.fail('capture_track_ended');
            }));
            this.running = true;
            this.media.start(500);
            this.installGameTick();
            this.record({ type: 'session-start', setup, mediaSettings: this.stream.getTracks().map((t) => t.getSettings()) });
            this.recordClock();
            this.installObservers();
            const game = this.runtime;
            if (this.settingsSnapshot) {
                if (this.settingsSnapshot.localMap) {
                    const { mapKey, localMap } = this.settingsSnapshot;
                    const refreshed = await refreshLocalMapCatalog({
                        gameState: game.state,
                        getGameState: () => game.state,
                        readLocalMaps: async () => ({ [mapKey]: localMap }),
                        catalog: CONFIG_BASE.MAPS,
                        refreshRuntimeConfig: refreshConfigRuntimeCache,
                        knownKeys: DESKTOP_LOCAL_MAP_KEYS,
                    });
                    if (!refreshed) throw new Error('marketing_local_map_unavailable');
                }
                game.settings.mapKey = this.settingsSnapshot.mapKey;
                game.settings.botDifficulty = this.settingsSnapshot.botDifficulty;
                game.settings.controls = this.settingsSnapshot.controls;
            }
            game.settings.mode = setup.humans === 1 ? '1p' : '2p';
            game.settings.numBots = setup.bots;
            game.settings.gameMode = 'HUNT';
            Object.assign(game.settings.localSettings, { sessionType: setup.humans === 1 ? 'single' : 'splitscreen', modePath: 'fight' });
            game.settings.audio = { ...game.settings.audio, enabled: true };
            game.applySettings();
            game.audio?.applySettings?.(game.settings.audio);
            await game.startMatch();
            if (this.error) throw new Error(this.error);
        } catch (error) {
            if (this.storeOpened) {
                try { await this.finish(error); }
                catch (closeError) {
                    this.error = `${error?.message || String(error)}; session_cleanup_failed: ${closeError?.message || String(closeError)}`;
                }
            } else {
                (this.stream?.getTracks() || display?.getTracks() || []).forEach((track) => track.stop());
                this.releaseAudio?.();
                this.stream = null; this.releaseAudio = null;
            }
            throw error;
        }
    }

    installGameTick() {
        const game = this.runtime;
        if (typeof game.update !== 'function') return;
        const originalUpdate = game.update;
        const session = this;
        const wrappedUpdate = function (...args) {
            const result = originalUpdate.apply(this, args);
            try { session.tick(args[0]); }
            catch (error) { session.fail(error); }
            return result;
        };
        game.update = wrappedUpdate;
        this.cleanups.push(() => {
            if (game.update === wrappedUpdate) game.update = originalUpdate;
        });
    }
    installObservers() {
        const input = this.runtime.input;
        if (input && typeof input.getPlayerInput === 'function') {
            const originalGetPlayerInput = input.getPlayerInput;
            const wrappedGetPlayerInput = function (player, ...args) {
                const value = originalGetPlayerInput.call(this, player, ...args);
                try {
                    const source = input.getPlayerSource?.(player);
                    const sourceName = source?.type || 'keyboard';
                    const previous = thisSession.lastInput.get(player);
                    const serialized = JSON.stringify([sourceName, value]);
                    if (previous !== serialized) {
                        thisSession.lastInput.set(player, serialized);
                        thisSession.record({ type: 'applied-input', player, source: sourceName,
                            active: activeInput(value), input: { ...value } });
                        const index = source?.gamepadIndex;
                        if (Number.isInteger(index)) {
                            const pad = navigator.getGamepads?.()[index];
                            if (pad?.connected && (pad.buttons.some((b) => b.pressed)
                                || pad.axes.some((axis) => Math.abs(axis) > 0.15))) {
                                thisSession.record({ type: 'physical-input', player, source: 'gamepad-api',
                                    trusted: true, device: index, timestamp: pad.timestamp,
                                    axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) });
                            }
                        }
                    }
                } catch (error) { thisSession.fail(error); }
                return value;
            };
            const thisSession = this;
            input.getPlayerInput = wrappedGetPlayerInput;
            this.cleanups.push(() => {
                if (input.getPlayerInput === wrappedGetPlayerInput) input.getPlayerInput = originalGetPlayerInput;
            });
        }

        const recorder = this.runtime.recorder;
        for (const method of ['logEvent', 'recordDamageEvent']) {
            if (typeof recorder?.[method] !== 'function') continue;
            const original = recorder[method];
            const session = this;
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                try {
                    if (method === 'logEvent') {
                        const [type, player, data] = args;
                        session.record({ type: 'event', eventType: type, player, data });
                    } else {
                        const event = args[0] || {};
                        session.record({ type: 'event', eventType: 'DAMAGE',
                            player: event.sourcePlayer?.index ?? -1, target: event.target?.index ?? -1,
                            weapon: event.projectile?.type || event.type || '',
                            applied: Number(event.damageResult?.applied) || 0,
                            hpApplied: Number(event.damageResult?.hpApplied) || 0,
                            shieldApplied: Number(event.damageResult?.absorbedByShield) || 0 });
                    }
                } catch (error) { session.fail(error); }
                return result;
            };
            recorder[method] = wrapped;
            this.cleanups.push(() => {
                if (recorder[method] === wrapped) recorder[method] = original;
            });
        }

        let lastPointerRecordAt = 0;
        const native = (event) => {
            if (this.runtime.state !== 'PLAYING' || event.repeat) return;
            if (event.type === 'pointermove') {
                if ((!event.movementX && !event.movementY) || performance.now() - lastPointerRecordAt < 100) return;
                lastPointerRecordAt = performance.now();
            }
            for (let player = 0; player < this.setup.humans; player++) {
                const source = this.runtime.input.getPlayerSource(player);
                const keyIndex = source?.keyboardPlayerIndex ?? source?.gamepadIndex ?? player;
                const keys = Object.values(this.runtime.input.bindings?.[`PLAYER_${keyIndex + 1}`] || {});
                if (this.setup.humans === 1 && keyIndex === 0) keys.push(...Object.values(this.runtime.input.bindings?.PLAYER_2 || {}));
                if ((event.code && keys.includes(event.code)) || (!event.code && source?.type === 'mouse')) {
                    this.record({ type: 'physical-input', player, trusted: event.isTrusted,
                        source: event.type, code: event.code || '', button: event.button ?? null,
                        movementX: event.movementX || 0, movementY: event.movementY || 0 });
                }
            }
        };
        for (const name of ['keydown', 'keyup', 'mousedown', 'pointermove']) {
            window.addEventListener(name, native, true);
            this.cleanups.push(() => window.removeEventListener(name, native, true));
        }
    }
    record(record, timeMs = performance.now() - this.epoch) {
        if (!this.running || this.error) return;
        const kernel = this.runtime.matchSessionRuntimeBridge?.getCurrentMatchKernel?.();
        this.records.push({ ...record, timeMs, activeMs: this.activeMs, match: this.match,
            round: kernel?.roundIndex ?? 0, frame: kernel?.tickIndex ?? 0,
            renderFrame: this.runtime.gameLoop?.renderFrameId ?? 0 });
        if (this.records.length >= 12) this.flush();
    }

    send(kind, size, payload) {
        if (this.pendingBytes + size > MAX_PENDING_BYTES) { this.fail('disk_backpressure_limit'); return; }
        this.pendingBytes += size;
        this.pending = this.pending.then(async () => {
            const body = await payload();
            const result = await this.bridge.append({ kind, sequence: this.sequence, ...body });
            if (!result.accepted) throw new Error('session_write_rejected');
            this.sequence++;
        }).catch((error) => this.fail(error)).finally(() => { this.pendingBytes -= size; });
    }

    flush() {
        if (!this.records.length) return;
        const records = this.records; this.records = [];
        this.sendRecordBatch(records);
    }

    sendRecordBatch(records) {
        const size = JSON.stringify(records).length * 2;
        // Full trail checkpoints can be larger than ordinary snapshots. Split
        // batches without splitting a snapshot or silently dropping its trails.
        if (size > 4 * 1024 * 1024 && records.length > 1) {
            const middle = Math.floor(records.length / 2);
            this.sendRecordBatch(records.slice(0, middle));
            this.sendRecordBatch(records.slice(middle));
        } else {
            this.send('records', size, async () => ({ records }));
        }
    }

    tick(_delta) {
        void _delta;
        try { this.captureTick(); } catch (error) { this.fail(error); }
    }

    recordClock() {
        const context = this.runtime.audio?.ctx;
        this.record({ type: 'clock', audioTime: context?.currentTime ?? null,
            audioOutput: context?.getOutputTimestamp?.() || null, state: this.runtime.state,
            timeScale: this.runtime.gameLoop?.timeScale ?? 1 });
    }

    captureTick() {
        if (!this.running || this.error) return;
        const now = performance.now();
        const game = this.runtime;
        const loop = game.gameLoop;
        const step = loop?.fixedStep;
        const remaining = step > 0 && Number.isFinite(loop.accumulator)
            ? Math.max(1, Math.floor(loop.accumulator / step + 1e-6)) : 1;
        // A slow render frame can run multiple distinct fixed simulation steps.
        // Give each step its place on the media timeline instead of sampling only once per render.
        const sampleNow = Math.max(now - (remaining - 1) * (step > 0 ? step * 1000 : 0), this.lastSample + 1);
        const kernel = game.matchSessionRuntimeBridge?.getCurrentMatchKernel?.();
        const round = kernel?.roundIndex ?? 0;
        if (game.state === 'PLAYING' && this.previousState === 'PLAYING') this.activeMs += Math.max(0, sampleNow - this.lastTick);
        this.lastTick = sampleNow;
        if (game.state === 'MENU') this.currentMatch = false;
        if (game.state === 'PLAYING' && game.entityManager
            && (!this.currentMatch || this.manager !== game.entityManager || this.kernel !== kernel || this.previousState === 'MATCH_END')) {
            this.currentMatch = true;
            this.kernel = kernel;
            this.lastInput.clear();
            this.manager = game.entityManager; this.match++; this.activeMs = 0;
            this.record({ type: 'match-start', metadata: { settings: structuredClone(game.settings),
                runtimeConfig: structuredClone(game.runtimeConfig), mapKey: game.mapKey, activeGameMode: game.activeGameMode,
                numHumans: game.numHumans, numBots: game.numBots, hudMode: 'clean' },
            participants: game.entityManager.players.map((p) => ({ index: p.index, isBot: p.isBot })) });
        }
        if (this.previousState !== game.state || this.previousRound !== round) {
            if (this.previousRound !== round) this.activeMs = 0;
            this.record({ type: 'state', state: game.state });
            this.previousState = game.state; this.previousRound = round;
        }
        if (game.entityManager && ['PLAYING', 'PAUSED', 'ROUND_END', 'MATCH_END'].includes(game.state)
            && sampleNow > this.lastSample) {
            this.lastSample = sampleNow;
            try {
                const snapshot = createReplaySnapshot({ entityManager: game.entityManager,
                    roundState: { round, frame: kernel?.tickIndex ?? 0, scores: game.entityManager.players.map((p) => p.score) },
                    particles: game.particles, cameras: game.renderer?.cameras,
                    elapsedMs: sampleNow - this.epoch, gameStateId: game.state });
                snapshot.trails = this.captureTrails(game.entityManager.players, sampleNow - this.epoch);
                this.record({ type: 'snapshot', snapshot }, sampleNow - this.epoch);
            } catch (error) { this.fail(error); }
        }
        if (now - this.lastFlush > 500) {
            this.lastFlush = now; this.recordClock(); this.flush();
            this.view.setStatus(`● Aufnahme läuft · ${Math.floor((now - this.epoch) / 1000)} s · ${this.setup.humans} Mensch(en), ${this.setup.bots} Bots`);
        }
    }

    finish(startError) {
        if (!this.storeOpened) return Promise.resolve();
        this.finishPromise ||= this.finishSession(startError);
        return this.finishPromise;
    }

    async finishSession(startError) {
        if (this.running) this.record({ type: 'session-end' });
        this.running = false;
        this.cleanups.splice(0).forEach((cleanup) => cleanup());
        this.flush();
        if (this.media && this.media.state !== 'inactive') {
            await new Promise((resolve) => {
                const timeout = setTimeout(() => { this.fail('media_stop_timeout'); resolve(); }, 8000);
                this.media.addEventListener('stop', () => { clearTimeout(timeout); resolve(); }, { once: true });
                try { this.media.stop(); }
                catch (error) { clearTimeout(timeout); this.fail(error); resolve(); }
            });
        }
        this.stream?.getTracks().forEach((track) => track.stop());
        this.releaseAudio?.();
        await this.pending;
        if (startError) this.fail(startError);
        await this.bridge.finish({ error: this.error, durationMs: performance.now() - this.epoch,
            provenanceLimit: 'Input channels and participant declaration; not proof of individual identity.' });
    }
}
