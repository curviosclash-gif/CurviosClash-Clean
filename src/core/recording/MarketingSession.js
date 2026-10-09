import { createReplaySnapshot } from './CinematicReplayRecorder.js';
import { normalizeMarketingSetup } from '../../shared/contracts/MarketingSessionContract.js';
import { createTrailStateRecorder } from './MarketingTrailState.js';

const MAX_PENDING_BYTES = 32 * 1024 * 1024;
const activeInput = (input) => Object.entries(input).some(([key, value]) =>
    key.endsWith('Axis') ? Math.abs(Number(value) || 0) > 0.15 : value === true);

export class MarketingSession {
    constructor(game, bridge) {
        this.game = game; this.bridge = bridge;
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
                await this.bridge.renderResult(await renderMarketingReplay(this.game, config.replay, this.bridge));
                return;
            }
            this.showSetup(config);
        } catch (error) {
            this.fail(error);
            if (!this.status) this.showSetup({ humans: 1, bots: 3 });
        }
    }

    showSetup(config) {
        const panel = document.createElement('section');
        panel.setAttribute('aria-label', 'Marketingaufnahme');
        Object.assign(panel.style, { position: 'fixed', inset: '10% auto auto 50%', transform: 'translateX(-50%)',
            zIndex: '100000', background: '#111827', color: '#fff', padding: '28px', border: '2px solid #22d3ee',
            borderRadius: '12px', maxWidth: '560px', font: '18px system-ui' });
        const add = (parent, tag, text = '', attributes = {}) => {
            const element = document.createElement(tag); element.textContent = text;
            for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
            parent.append(element); return element;
        };
        add(panel, 'h2', 'Partie aufnehmen');
        add(panel, 'p', 'Spiele selbst. Bild, Spielton und Replay werden lokal gespeichert. Nach dem Schließen werden belegte Videokandidaten gesucht.');
        const humansLabel = add(panel, 'label', 'Menschen ');
        const select = add(humansLabel, 'select', '', { 'data-humans': '' });
        add(select, 'option', 'Ich allein', { value: '1' });
        add(select, 'option', 'Zwei am selben Rechner', { value: '2' });
        const botsLabel = add(panel, 'label', ' Bots ');
        add(botsLabel, 'input', '', { 'data-bots': '', type: 'number', min: '1', max: '8', style: 'width:65px' });
        const confirmLabel = add(add(panel, 'p'), 'label');
        add(confirmLabel, 'input', '', { 'data-confirm': '', type: 'checkbox' });
        add(confirmLabel, 'span', ' Die gewählte Zahl Menschen spielt selbst; keine Makros oder Skriptsteuerung.');
        add(panel, 'p', 'Verwendet die im Spiel eingestellte Karte, Schwierigkeit und Steuerung.');
        const configure = add(panel, 'button', 'Spieleinstellungen anzeigen');
        const reopen = document.createElement('button');
        reopen.textContent = 'Marketingaufnahme einrichten';
        Object.assign(reopen.style, { position: 'fixed', top: '8px', right: '8px', zIndex: '100000' });
        reopen.hidden = true;
        configure.addEventListener('click', () => { panel.hidden = true; reopen.hidden = false; });
        reopen.addEventListener('click', () => { panel.hidden = false; reopen.hidden = true; });
        document.body.append(reopen);
        add(panel, 'button', 'Aufnahme und Partie starten', { 'data-start': '' });
        add(panel, 'p', '', { 'data-status': '', role: 'status' });
        panel.querySelector('[data-humans]').value = String(config.humans || 1);
        panel.querySelector('[data-bots]').value = String(config.bots || 3);
        this.status = panel.querySelector('[data-status]');
        this.status.textContent = this.error || '';
        panel.querySelector('[data-start]').addEventListener('click', async () => {
            const button = panel.querySelector('[data-start]');
            try {
                const humans = Number(panel.querySelector('[data-humans]').value);
                const setup = normalizeMarketingSetup({ humans, bots: Number(panel.querySelector('[data-bots]').value),
                    confirmedHumans: panel.querySelector('[data-confirm]').checked ? humans : 0 });
                button.disabled = true;
                this.status.textContent = 'Aufnahme wird vorbereitet …';
                await this.start(setup);
                panel.remove(); reopen.remove();
                const status = document.createElement('div');
                status.setAttribute('role', 'status');
                Object.assign(status.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '100000',
                    color: '#fff', background: '#111c', padding: '5px', font: '12px system-ui', pointerEvents: 'none' });
                document.body.append(status); this.status = status;
            } catch (error) {
                if (this.storeOpened) this.fail(error);
                else {
                    this.status.textContent = error?.message || String(error);
                    button.disabled = false;
                }
            }
        });
        document.body.append(panel);
    }

    fail(error) {
        const firstFailure = !this.error;
        this.error ||= error?.message || String(error);
        if (this.status) this.status.textContent = `Aufnahmefehler: ${this.error}. Rohdaten bleiben erhalten.`;
        if (firstFailure && this.storeOpened && this.running) {
            this.finish().catch((closeError) => {
                this.error += `; session_cleanup_failed: ${closeError?.message || String(closeError)}`;
                if (this.status) this.status.textContent = `Aufnahmefehler: ${this.error}. Rohdaten bleiben erhalten.`;
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
            const audio = this.game.audio?.acquireRecordingStream?.();
            if (!audio?.stream?.getAudioTracks().length) {
                throw new Error('Kein Spielton verfügbar. Die Partie wurde nicht gestartet.');
            }
            this.releaseAudio = audio.release;
            this.stream = new MediaStream([...display.getVideoTracks(), ...audio.stream.getAudioTracks()]);
            await this.game.audio.ctx?.resume?.();
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
            this.record({ type: 'session-start', setup, mediaSettings: this.stream.getTracks().map((t) => t.getSettings()) });
            this.recordClock();
            this.installObservers();
            const game = this.game;
            game.settings.mode = setup.humans === 1 ? '1p' : '2p';
            game.settings.numBots = setup.bots;
            game.settings.gameMode = 'HUNT';
            Object.assign(game.settings.localSettings, { sessionType: setup.humans === 1 ? 'single' : 'splitscreen', modePath: 'fight' });
            game.settings.audio = { ...game.settings.audio, enabled: true };
            game._applySettingsToRuntime({ schedulePrewarm: false });
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

    installObservers() {
        this.game.recorder.marketingObserver = (event) => this.record({ ...event, type: 'event', eventType: event.type });
        this.game.input.recordingInputObserver = (player, source, input) => {
            const previous = this.lastInput.get(player);
            const serialized = JSON.stringify([source, input]);
            if (previous === serialized) return;
            this.lastInput.set(player, serialized);
            this.record({ type: 'applied-input', player, source, active: activeInput(input), input: { ...input } });
            const sourceObject = this.game.input.getPlayerSource(player);
            const index = sourceObject?.gamepadIndex;
            if (Number.isInteger(index)) {
                const pad = navigator.getGamepads?.()[index];
                if (pad?.connected && (pad.buttons.some((b) => b.pressed) || pad.axes.some((axis) => Math.abs(axis) > 0.15))) {
                    this.record({ type: 'physical-input', player, source: 'gamepad-api', trusted: true,
                        device: index, timestamp: pad.timestamp, axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) });
                }
            }
        };
        const native = (event) => {
            if (this.game.state !== 'PLAYING' || event.repeat) return;
            for (let player = 0; player < this.setup.humans; player++) {
                const source = this.game.input.getPlayerSource(player);
                const keyIndex = source?.keyboardPlayerIndex ?? source?.gamepadIndex ?? player;
                const keys = Object.values(this.game.input.bindings?.[`PLAYER_${keyIndex + 1}`] || {});
                if (this.setup.humans === 1 && keyIndex === 0) keys.push(...Object.values(this.game.input.bindings?.PLAYER_2 || {}));
                if ((event.code && keys.includes(event.code)) || (!event.code && source?.type === 'mouse')) {
                    this.record({ type: 'physical-input', player, trusted: event.isTrusted,
                        source: event.type, code: event.code || '', button: event.button ?? null });
                }
            }
        };
        for (const name of ['keydown', 'keyup', 'mousedown', 'pointermove']) {
            window.addEventListener(name, native, true);
            this.cleanups.push(() => window.removeEventListener(name, native, true));
        }
    }

    record(record) {
        if (!this.running || this.error) return;
        const timeMs = performance.now() - this.epoch;
        const kernel = this.game.matchSessionRuntimeBridge?.getCurrentMatchKernel?.();
        this.records.push({ ...record, timeMs, activeMs: this.activeMs, match: this.match,
            round: kernel?.roundIndex ?? 0, frame: kernel?.tickIndex ?? 0,
            renderFrame: this.game.gameLoop?.renderFrameId ?? 0 });
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

    tick() {
        try { this.captureTick(); } catch (error) { this.fail(error); }
    }

    recordClock() {
        const context = this.game.audio?.ctx;
        this.record({ type: 'clock', audioTime: context?.currentTime ?? null,
            audioOutput: context?.getOutputTimestamp?.() || null, state: this.game.state,
            timeScale: this.game.gameLoop?.timeScale ?? 1 });
    }

    captureTick() {
        if (!this.running || this.error) return;
        const now = performance.now();
        const game = this.game;
        const kernel = game.matchSessionRuntimeBridge?.getCurrentMatchKernel?.();
        const round = kernel?.roundIndex ?? 0;
        if (game.state === 'PLAYING' && this.previousState === 'PLAYING') this.activeMs += now - this.lastTick;
        this.lastTick = now;
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
        if (game.entityManager && ['PLAYING', 'PAUSED', 'ROUND_END', 'MATCH_END'].includes(game.state) && now - this.lastSample >= 1000 / 30) {
            this.lastSample = now - ((now - this.lastSample) % (1000 / 30));
            try {
                const snapshot = createReplaySnapshot({ entityManager: game.entityManager,
                    roundState: { round, frame: kernel?.tickIndex ?? 0, scores: game.entityManager.players.map((p) => p.score) },
                    particles: game.particles, cameras: game.renderer?.cameras,
                    elapsedMs: now - this.epoch, gameStateId: game.state });
                snapshot.trails = this.captureTrails(game.entityManager.players, now - this.epoch);
                this.record({ type: 'snapshot', snapshot });
            } catch (error) { this.fail(error); }
        }
        if (now - this.lastFlush > 500) {
            this.lastFlush = now; this.recordClock(); this.flush();
            if (this.status) this.status.textContent = `● Aufnahme läuft · ${Math.floor((now - this.epoch) / 1000)} s · ${this.setup.humans} Mensch(en), ${this.setup.bots} Bots`;
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
        if (this.game.input) this.game.input.recordingInputObserver = null;
        if (this.game.recorder) this.game.recorder.marketingObserver = null;
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
