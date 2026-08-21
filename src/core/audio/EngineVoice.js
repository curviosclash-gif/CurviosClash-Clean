const ENGINE_IDLE_GAIN = 0.0001;

export function ensureEngineVoice(audio) {
    if (!audio.ctx || audio._engine) return;
    const body = audio.ctx.createOscillator();
    const hum = audio.ctx.createOscillator();
    const turbine = audio.ctx.createOscillator();
    const air = audio.ctx.createBufferSource();
    const filter = audio.ctx.createBiquadFilter();
    const turbineFilter = audio.ctx.createBiquadFilter();
    const airFilter = audio.ctx.createBiquadFilter();
    const gain = audio.ctx.createGain();
    const turbineGain = audio.ctx.createGain();
    const airGain = audio.ctx.createGain();
    body.type = 'triangle';
    hum.type = 'sine';
    turbine.type = 'triangle';
    air.buffer = audio.buffers.musicNoise;
    air.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 360;
    filter.Q.value = 0.45;
    turbineFilter.type = 'bandpass';
    turbineFilter.frequency.value = 620;
    turbineFilter.Q.value = 0.65;
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 760;
    airFilter.Q.value = 0.35;
    gain.gain.value = ENGINE_IDLE_GAIN;
    turbineGain.gain.value = ENGINE_IDLE_GAIN;
    airGain.gain.value = ENGINE_IDLE_GAIN;
    body.frequency.value = 56;
    hum.frequency.value = 110;
    turbine.frequency.value = 240;
    body.connect(filter);
    hum.connect(filter);
    turbine.connect(turbineFilter);
    air.connect(airFilter);
    filter.connect(gain);
    turbineFilter.connect(turbineGain);
    airFilter.connect(airGain);
    const destination = audio._engineGain || audio._masterGain || audio.ctx.destination;
    gain.connect(destination);
    turbineGain.connect(destination);
    airGain.connect(destination);
    const time = audio.ctx.currentTime;
    body.start(time);
    hum.start(time);
    turbine.start(time);
    air.start(time);
    audio._engine = {
        body, hum, turbine, air, filter, turbineFilter, airFilter, gain, turbineGain, airGain,
        active: true,
        lastRatio: Number.NaN,
        lastBoosting: false,
        lastUpdateTime: Number.NEGATIVE_INFINITY,
    };
}

export function updateEngineVoice(audio, state = {}) {
    if (!audio.enabled || !audio.ctx) {
        stopEngineVoice(audio);
        return;
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();

    const alive = state.alive !== false;
    const speed = Math.max(0, Number(state.speed) || 0);
    const baseSpeed = Math.max(1, Number(state.baseSpeed) || 18);
    const boosting = state.boosting === true;
    if (!alive || speed < 0.35) {
        stopEngineVoice(audio);
        return;
    }

    ensureEngineVoice(audio);
    const engine = audio._engine;
    if (!engine) return;

    const time = audio.ctx.currentTime;
    const ratio = audio._clamp(speed / baseSpeed, 0.35, 3);
    const stableLoad = Math.abs(ratio - engine.lastRatio) < 0.015 && boosting === engine.lastBoosting;
    if (engine.active && stableLoad && time - engine.lastUpdateTime < 0.08) return;
    const drift = 1 + Math.sin(time * 0.73) * 0.012;
    const bodyFrequency = (52 + ratio * 44 + (boosting ? 10 : 0)) * drift;
    const humFrequency = bodyFrequency * 1.96;
    const turbineFrequency = bodyFrequency * (3.1 + ratio * 0.12);
    const filterFrequency = 240 + ratio * 180 + (boosting ? 90 : 0);
    const turbineFilterFrequency = 520 + ratio * 210 + (boosting ? 260 : 0);
    const airFilterFrequency = 620 + ratio * 240 + (boosting ? 380 : 0);
    const bodyGain = (0.014 + ratio * 0.024) * (boosting ? 1.18 : 1);
    const turbineGain = (0.002 + ratio * 0.0045) * (boosting ? 1.35 : 1);
    const airGain = (0.0015 + ratio * 0.0035) * (boosting ? 1.75 : 1);
    engine.body.frequency.setTargetAtTime(bodyFrequency, time, 0.12);
    engine.hum.frequency.setTargetAtTime(humFrequency, time, 0.12);
    engine.turbine.frequency.setTargetAtTime(turbineFrequency, time, 0.1);
    engine.filter.frequency.setTargetAtTime(filterFrequency, time, 0.14);
    engine.turbineFilter.frequency.setTargetAtTime(turbineFilterFrequency, time, 0.14);
    engine.airFilter.frequency.setTargetAtTime(airFilterFrequency, time, 0.16);
    engine.gain.gain.setTargetAtTime(bodyGain, time, 0.14);
    engine.turbineGain.gain.setTargetAtTime(turbineGain, time, 0.14);
    engine.airGain.gain.setTargetAtTime(airGain, time, 0.16);
    engine.active = true;
    engine.lastRatio = ratio;
    engine.lastBoosting = boosting;
    engine.lastUpdateTime = time;
}

export function stopEngineVoice(audio) {
    const engine = audio._engine;
    if (!engine || !audio.ctx) return;
    const time = audio.ctx.currentTime;
    for (const gain of [engine.gain, engine.turbineGain, engine.airGain]) {
        gain.gain.cancelScheduledValues?.(time);
        gain.gain.setTargetAtTime?.(ENGINE_IDLE_GAIN, time, 0.06);
    }
    engine.active = false;
}

export function disposeEngineVoice(audio) {
    if (!audio._engine) return;
    for (const source of [audio._engine.body, audio._engine.hum, audio._engine.turbine, audio._engine.air]) {
        try { source.stop(); } catch { /* best effort */ }
    }
    audio._engine = null;
}
