export const MUSIC_STATES = Object.freeze({
    MENU: 'menu',
    RACE: 'race',
    CLASSIC: 'classic',
    FIGHT: 'fight',
    ARCADE: 'arcade',
    RESULTS: 'results',
});

const MUSIC_STATE_SET = new Set(Object.values(MUSIC_STATES));
const LOOK_AHEAD_SECONDS = 0.18;
const SCHEDULER_INTERVAL_MS = 70;
const RETIRED_SCENE_LIFETIME_MS = 900;
const MIN_GAIN = 0.0001;
const RECORDED_MUSIC_BY_STATE = Object.freeze({
    [MUSIC_STATES.MENU]: 'classicalMusic',
    [MUSIC_STATES.RACE]: 'classicalMusic',
    [MUSIC_STATES.CLASSIC]: 'classicalMusic',
    [MUSIC_STATES.FIGHT]: 'fightMusic',
    [MUSIC_STATES.ARCADE]: 'arcadeMusic',
});
const RECORDED_LOOP_STARTS = Object.freeze({
    fightMusic: 2,
    arcadeMusic: 2,
});

const SCENES = Object.freeze({
    [MUSIC_STATES.MENU]: Object.freeze({
        bpm: 98,
        root: 73.42,
        bass: Object.freeze([0, null, 0, null, 3, null, 5, null, 0, null, 7, null, 5, null, 3, null]),
        lead: Object.freeze([12, null, 15, null, 19, null, 17, null, 12, null, 10, null, 7, null, 10, null]),
        chord: 'minor',
        density: 0.35,
    }),
    [MUSIC_STATES.RACE]: Object.freeze({
        bpm: 126,
        root: 82.41,
        bass: Object.freeze([0, 0, null, 0, 7, null, 5, 7, 0, 0, null, 12, 7, null, 5, 3]),
        lead: Object.freeze([12, null, 19, 17, 12, null, 15, null, 19, null, 22, 19, 17, null, 15, null]),
        chord: 'minor',
        density: 0.7,
    }),
    [MUSIC_STATES.FIGHT]: Object.freeze({
        bpm: 142,
        root: 73.42,
        bass: Object.freeze([0, 0, 0, 3, 0, 0, 6, 5, 0, 0, 0, 7, 6, 5, 3, 0]),
        lead: Object.freeze([12, 12, null, 15, 18, null, 17, 15, 12, null, 22, 18, 17, 15, 12, null]),
        chord: 'minor',
        density: 1,
    }),
    [MUSIC_STATES.RESULTS]: Object.freeze({
        bpm: 108,
        root: 98,
        bass: Object.freeze([0, null, 7, null, 9, null, 5, null, 0, null, 7, null, 12, null, 9, null]),
        lead: Object.freeze([12, null, 16, null, 19, null, 21, null, 24, null, 21, null, 19, null, 16, null]),
        chord: 'major',
        density: 0.5,
    }),
});

function noteFrequency(root, semitones = 0) {
    return root * (2 ** (Number(semitones || 0) / 12));
}

function automateGain(param, startTime, peak, duration, attack = 0.01) {
    const endTime = startTime + duration;
    param.cancelScheduledValues?.(startTime);
    param.setValueAtTime?.(MIN_GAIN, startTime);
    param.exponentialRampToValueAtTime?.(Math.max(MIN_GAIN, peak), startTime + attack);
    param.exponentialRampToValueAtTime?.(MIN_GAIN, endTime);
}

export class ProceduralMusicDirector {
    constructor(audio) {
        this.audio = audio;
        this.state = MUSIC_STATES.MENU;
        this.intensity = 0.65;
        this.paused = false;
        this._timer = null;
        this._step = 0;
        this._nextStepTime = 0;
        this._sceneGain = null;
        this._recordedSource = null;
        this._recordedGain = null;
        this._recordedKey = null;
        this._recordedActive = false;
        this._retiredSceneGains = new Map();
        this._generation = 0;
    }

    _resolveState(state) {
        return MUSIC_STATE_SET.has(state) ? state : MUSIC_STATES.MENU;
    }

    setState(state, options = {}) {
        const nextState = this._resolveState(state);
        const changed = nextState !== this.state;
        this.state = nextState;
        if (Number.isFinite(Number(options.intensity))) {
            this.intensity = Math.min(1, Math.max(0, Number(options.intensity)));
        }
        if (!changed && options.restart !== true) return this.state;
        if (this.audio?.ctx) this.start({ crossfade: true });
        return this.state;
    }

    setIntensity(value) {
        this.intensity = Math.min(1, Math.max(0, Number(value) || 0));
        return this.intensity;
    }

    setPaused(paused) {
        this.paused = paused === true;
        const param = this._recordedGain?.gain || this._sceneGain?.gain;
        const ctx = this.audio?.ctx;
        if (param && ctx) {
            const target = this.paused ? 0.24 : 1;
            param.setTargetAtTime?.(target, ctx.currentTime, 0.12);
        }
        return this.paused;
    }

    start(options = {}) {
        const ctx = this.audio?.ctx;
        const destination = this.audio?._musicOut?.();
        if (!ctx || !destination) return false;

        const recordedSelection = this._resolveRecordedSelection();
        if (recordedSelection) {
            return this._startRecorded(recordedSelection.key, recordedSelection.buffer, destination, options);
        }

        this._cancelScheduler();
        this._retireRecordedSource(ctx);
        const previousGain = this._sceneGain;
        if (previousGain?.gain) {
            const t = ctx.currentTime;
            previousGain.gain.cancelScheduledValues?.(t);
            previousGain.gain.setTargetAtTime?.(MIN_GAIN, t, options.crossfade === true ? 0.08 : 0.02);
            this._retireSceneGain(previousGain);
        }

        const sceneGain = ctx.createGain();
        sceneGain.gain.value = options.crossfade === true ? MIN_GAIN : 1;
        sceneGain.connect(destination);
        if (options.crossfade === true) {
            sceneGain.gain.setTargetAtTime?.(this.paused ? 0.24 : 1, ctx.currentTime, 0.08);
        }
        this._sceneGain = sceneGain;
        this._step = 0;
        this._nextStepTime = ctx.currentTime + 0.04;
        const generation = ++this._generation;
        this._schedule(generation);
        return true;
    }

    _resolveRecordedSelection() {
        const key = this.state === MUSIC_STATES.RESULTS
            ? (this._recordedKey || 'classicalMusic')
            : RECORDED_MUSIC_BY_STATE[this.state];
        const buffer = key ? this.audio?.buffers?.[key] : null;
        return buffer ? { key, buffer } : null;
    }

    _retireRecordedSource(ctx) {
        if (!this._recordedSource) return;
        const previousSource = this._recordedSource;
        const previousGain = this._recordedGain;
        previousGain?.gain?.cancelScheduledValues?.(ctx.currentTime);
        previousGain?.gain?.setTargetAtTime?.(MIN_GAIN, ctx.currentTime, 0.08);
        try { previousSource.stop?.(ctx.currentTime + 0.6); } catch { /* best effort */ }
        this._retireSceneGain(previousGain);
        this._recordedSource = null;
        this._recordedGain = null;
        this._recordedKey = null;
        this._recordedActive = false;
    }

    _startRecorded(key, buffer, destination, options = {}) {
        const ctx = this.audio?.ctx;
        if (!ctx || !buffer || !destination) return false;
        this._cancelScheduler();

        if (this._sceneGain?.gain) {
            const previousGain = this._sceneGain;
            previousGain.gain.cancelScheduledValues?.(ctx.currentTime);
            previousGain.gain.setTargetAtTime?.(MIN_GAIN, ctx.currentTime, 0.08);
            this._sceneGain = null;
            this._retireSceneGain(previousGain);
        }

        if (this._recordedSource && this._recordedKey !== key) {
            this._retireRecordedSource(ctx);
        }

        if (!this._recordedSource) {
            const gain = ctx.createGain();
            const source = ctx.createBufferSource();
            gain.gain.value = options.crossfade === true ? MIN_GAIN : (this.paused ? 0.24 : 1);
            source.buffer = buffer;
            source.loop = true;
            source.loopStart = RECORDED_LOOP_STARTS[key] || 0;
            source.connect(gain);
            gain.connect(destination);
            source.start(ctx.currentTime);
            this._recordedSource = source;
            this._recordedGain = gain;
            this._recordedKey = key;
        }

        const target = this.paused ? 0.24 : 1;
        this._recordedGain?.gain?.cancelScheduledValues?.(ctx.currentTime);
        this._recordedGain?.gain?.setTargetAtTime?.(target, ctx.currentTime, options.crossfade === true ? 0.18 : 0.04);
        this._recordedActive = true;
        return true;
    }

    _cancelScheduler() {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._generation += 1;
    }

    _retireSceneGain(sceneGain) {
        if (!sceneGain || this._retiredSceneGains.has(sceneGain)) return;
        const disconnect = () => {
            this._retiredSceneGains.delete(sceneGain);
            try { sceneGain.disconnect?.(); } catch { /* AudioContext may already be closing. */ }
        };
        const timer = setTimeout(disconnect, RETIRED_SCENE_LIFETIME_MS);
        timer?.unref?.();
        this._retiredSceneGains.set(sceneGain, timer);
    }

    _disconnectRetiredSceneGains() {
        for (const [sceneGain, timer] of this._retiredSceneGains) {
            clearTimeout(timer);
            try { sceneGain.disconnect?.(); } catch { /* best effort */ }
        }
        this._retiredSceneGains.clear();
    }

    _schedule(generation) {
        const ctx = this.audio?.ctx;
        const proceduralState = this.state === MUSIC_STATES.CLASSIC || this.state === MUSIC_STATES.ARCADE
            ? MUSIC_STATES.RACE
            : this.state;
        const scene = SCENES[proceduralState];
        if (!ctx || !scene || generation !== this._generation) return;
        const secondsPerStep = (60 / scene.bpm) / 4;
        if (this._nextStepTime < ctx.currentTime - secondsPerStep) {
            this._nextStepTime = ctx.currentTime + 0.02;
        }
        while (this._nextStepTime < ctx.currentTime + LOOK_AHEAD_SECONDS) {
            this._scheduleStep(scene, this._step, this._nextStepTime);
            this._step = (this._step + 1) % 16;
            this._nextStepTime += secondsPerStep;
        }
        this._timer = setTimeout(() => this._schedule(generation), SCHEDULER_INTERVAL_MS);
    }

    _scheduleStep(scene, step, time) {
        const bassNote = scene.bass[step];
        if (bassNote !== null) {
            this._scheduleTone({
                frequency: noteFrequency(scene.root, bassNote),
                time,
                duration: 0.18,
                peak: 0.105,
                type: 'triangle',
                filterFrequency: 520,
            });
        }

        if (step % 4 === 0) this._scheduleKick(time, scene.density);
        if (step % 2 === 0 || scene.density > 0.8) this._scheduleHat(time, scene.density);
        if (step % 8 === 0) this._scheduleChord(scene, time);

        const leadNote = scene.lead[step];
        const leadThreshold = scene.density * 0.6;
        if (leadNote !== null && this.intensity >= leadThreshold) {
            this._scheduleTone({
                frequency: noteFrequency(scene.root, leadNote),
                time,
                duration: 0.12,
                peak: 0.038 + (this.intensity * 0.025),
                type: 'sine',
                filterFrequency: 1800,
            });
        }
    }

    _scheduleTone({ frequency, time, duration, peak, type, filterFrequency }) {
        const ctx = this.audio?.ctx;
        const destination = this._sceneGain;
        if (!ctx || !destination) return;
        const oscillator = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime?.(Math.max(20, frequency), time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime?.(filterFrequency, time);
        filter.Q.value = 0.8;
        automateGain(gain.gain, time, peak, duration);
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(destination);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.03);
    }

    _scheduleKick(time, density) {
        const ctx = this.audio?.ctx;
        const destination = this._sceneGain;
        if (!ctx || !destination) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime?.(130 + density * 20, time);
        oscillator.frequency.exponentialRampToValueAtTime?.(46, time + 0.12);
        automateGain(gain.gain, time, 0.16 + density * 0.05, 0.14, 0.004);
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start(time);
        oscillator.stop(time + 0.17);
    }

    _scheduleHat(time, density) {
        const ctx = this.audio?.ctx;
        const destination = this._sceneGain;
        const buffer = this.audio?.buffers?.musicNoise;
        if (!ctx || !destination || !buffer) return;
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        source.buffer = buffer;
        filter.type = 'highpass';
        filter.frequency.setValueAtTime?.(5200, time);
        automateGain(gain.gain, time, 0.018 + density * 0.018, 0.045, 0.002);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(destination);
        source.start(time);
        source.stop?.(time + 0.055);
    }

    _scheduleChord(scene, time) {
        const intervals = scene.chord === 'major' ? [12, 16, 19] : [12, 15, 19];
        for (const interval of intervals) {
            this._scheduleTone({
                frequency: noteFrequency(scene.root, interval),
                time,
                duration: 0.7,
                peak: 0.022,
                type: 'sine',
                filterFrequency: 1200,
            });
        }
    }

    stop() {
        this._cancelScheduler();
        const ctx = this.audio?.ctx;
        if (this._recordedGain?.gain && ctx) {
            this._recordedGain.gain.cancelScheduledValues?.(ctx.currentTime);
            this._recordedGain.gain.setTargetAtTime?.(MIN_GAIN, ctx.currentTime, 0.03);
            this._recordedActive = false;
        }
        const sceneGain = this._sceneGain;
        if (sceneGain?.gain && ctx) {
            sceneGain.gain.setTargetAtTime?.(MIN_GAIN, ctx.currentTime, 0.03);
        }
        this._sceneGain = null;
        this._retireSceneGain(sceneGain);
    }

    dispose() {
        this.stop();
        try { this._recordedSource?.stop?.(); } catch { /* best effort */ }
        try { this._recordedGain?.disconnect?.(); } catch { /* best effort */ }
        this._recordedSource = null;
        this._recordedGain = null;
        this._recordedKey = null;
        this._recordedActive = false;
        this._disconnectRetiredSceneGains();
        this.audio = null;
    }
}
