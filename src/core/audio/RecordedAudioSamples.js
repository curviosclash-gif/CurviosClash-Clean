export const RECORDED_SAMPLE_KEYS = Object.freeze({
    MACHINE_GUN: 'machineGun',
    ROCKET_LAUNCH: 'rocketLaunch',
    ARMOR_HIT: 'armorHit',
    CLASSICAL_MUSIC: 'classicalMusic',
    FIGHT_MUSIC: 'fightMusic',
    ARCADE_MUSIC: 'arcadeMusic',
    ROCKET_EXPLOSION: 'rocketExplosion',
    VEHICLE_EXPLOSION: 'vehicleExplosion',
});

export const AUDIO_THIRD_PARTY_NOTICE_URL = new URL(
    '../../../assets/audio/THIRD_PARTY_NOTICES.txt?no-inline',
    import.meta.url
).href;

const SAMPLE_URLS = Object.freeze({
    [RECORDED_SAMPLE_KEYS.MACHINE_GUN]: new URL('../../../assets/audio/sfx/machine-gun-autocannon.wav', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.ROCKET_LAUNCH]: new URL('../../../assets/audio/sfx/rocket-launch-heavy.wav', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.ARMOR_HIT]: new URL('../../../assets/audio/sfx/armor-hit-break.wav', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.CLASSICAL_MUSIC]: new URL('../../../assets/audio/music/mozart-nachtmusik-advent-chamber.mp3', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.FIGHT_MUSIC]: new URL('../../../assets/audio/music/beethoven-5-skidmore-fight.mp3', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.ARCADE_MUSIC]: new URL('../../../assets/audio/music/chopin-nocturne-frank-levy-arcade.mp3', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.ROCKET_EXPLOSION]: new URL('../../../assets/audio/sfx/explosion-rocket-deep.wav', import.meta.url).href,
    [RECORDED_SAMPLE_KEYS.VEHICLE_EXPLOSION]: new URL('../../../assets/audio/sfx/explosion-vehicle-metal.wav', import.meta.url).href,
});

async function loadSample(audio, context, fetcher, key, url) {
    try {
        const response = await fetcher(url);
        if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        if (audio.ctx === context) audio.buffers[key] = buffer;
        return buffer;
    } catch (error) {
        audio._debugLog?.(`Recorded audio sample unavailable: ${key}`, {
            error: error instanceof Error ? error.message : String(error || ''),
        });
        return null;
    }
}

export async function loadRecordedAudioSamples(audio) {
    const context = audio?.ctx;
    const windowFetch = globalThis.window?.fetch;
    if (!context || typeof context.decodeAudioData !== 'function' || typeof windowFetch !== 'function') {
        return {};
    }
    const fetcher = windowFetch.bind(globalThis.window);
    const entries = Object.entries(SAMPLE_URLS);
    const loaded = await Promise.all(entries.map(async ([key, url]) => [
        key,
        await loadSample(audio, context, fetcher, key, url),
    ]));
    return Object.fromEntries(loaded);
}

export function playRecordedAudioSample(audio, key, config = {}) {
    const context = audio?.ctx;
    const buffer = audio?.buffers?.[key];
    if (!context || !buffer) return false;

    const options = config.options || {};
    const gain = audio._createVoiceGraph(options, config.bus || options.bus);
    if (!gain) return false;

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (source.playbackRate) source.playbackRate.value = Math.max(0.5, Number(config.playbackRate) || 1);

    let tail = source;
    if (config.filter && typeof context.createBiquadFilter === 'function') {
        const filter = context.createBiquadFilter();
        filter.type = config.filter.type || 'highpass';
        filter.frequency.value = Math.max(20, Number(config.filter.frequency) || 45);
        filter.Q.value = Math.max(0.01, Number(config.filter.q) || 0.7);
        source.connect(filter);
        tail = filter;
    }
    tail.connect(gain);

    const bufferDuration = Math.max(0.02, Number(buffer.duration) || Number(config.duration) || 0.2);
    const offset = Math.min(Math.max(0, Number(config.offset) || 0), Math.max(0, bufferDuration - 0.02));
    const duration = Math.min(
        Math.max(0.02, Number(config.duration) || bufferDuration - offset),
        Math.max(0.02, bufferDuration - offset)
    );
    const attenuation = audio._distanceAttenuation(options);
    audio._envGain(gain, Math.max(0.0001, Number(config.peak) || 0.3) * attenuation, duration, {
        attack: Math.max(0.002, Number(config.attack) || 0.004),
        hold: Math.max(0, duration - 0.06),
    });
    const time = context.currentTime;
    source.start(time, offset, duration);
    source.stop?.(time + duration + 0.02);
    const reservationDuration = Math.min(
        duration,
        Math.max(0.05, Number(config.reservationDuration) || duration)
    );
    audio._releaseVoice(reservationDuration);
    return true;
}
