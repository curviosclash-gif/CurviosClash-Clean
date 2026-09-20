function playShoot(audio, options) {
    const intensity = audio._intensity(options, 0.85, 0.2, 1.3);
    audio._playLayered([
        { type: 'square', startFreq: 760, endFreq: 140, duration: 0.09, peak: 0.28 * intensity, attack: 0.004 },
        { type: 'triangle', startFreq: 420, endFreq: 90, duration: 0.11, peak: 0.16 * intensity },
    ], options);
    audio._playNoise({
        duration: 0.065,
        peak: 0.16 * intensity,
        filterType: 'highpass',
        startFrequency: 4200,
        endFrequency: 980,
        options,
    });
}

function playMgShoot(audio, options) {
    const intensity = audio._intensity(options, 0.75, 0.2, 1.2);
    const shotIndex = audio._recordedMgIndex || 0;
    audio._recordedMgIndex = (shotIndex + 1) % 14;
    const playedRecording = audio._playRecordedSample?.('machineGun', {
        offset: shotIndex * 0.136,
        duration: 0.12,
        peak: 0.22 * intensity,
        playbackRate: 0.985 + ((shotIndex % 3) * 0.012),
        filter: { type: 'highpass', frequency: 65, q: 0.55 },
        options,
    });
    if (playedRecording) return;
    audio._playTone({
        type: 'square', startFreq: 1500, endFreq: 280, duration: 0.05,
        peak: 0.16 * intensity, attack: 0.003, options,
    });
    audio._playNoise({
        duration: 0.035,
        peak: 0.085 * intensity,
        filterType: 'highpass',
        startFrequency: 6200,
        endFrequency: 1800,
        options,
    });
}

function playRocketShoot(audio, options) {
    const intensity = audio._intensity(options, 0.9, 0.25, 1.3);
    const playedRecording = audio._playRecordedSample?.('rocketLaunch', {
        duration: 1.9,
        reservationDuration: 0.45,
        peak: 0.34 * intensity,
        playbackRate: 1,
        filter: { type: 'highpass', frequency: 42, q: 0.55 },
        options,
    });
    if (playedRecording) return;
    audio._playLayered([
        { type: 'sawtooth', startFreq: 240, endFreq: 64, duration: 0.26, peak: 0.3 * intensity, attack: 0.02 },
        { type: 'triangle', startFreq: 110, endFreq: 48, duration: 0.3, peak: 0.18 * intensity },
    ], options);
    audio._playNoise({
        duration: 0.28,
        peak: 0.17 * intensity,
        filterType: 'bandpass',
        startFrequency: 1900,
        endFrequency: 180,
        options,
    });
}

/**
 * Two short high beeps while a homing rocket is chasing the local player.
 *
 * Deliberately thin and bright so it cuts through the engine and never gets confused
 * with HIT or ROCKET_SHOOT, both of which are low sawtooth hits. `intensity` rises when
 * the rocket is close: the pair then sits higher and a touch louder.
 */
function playRocketWarning(audio, options) {
    const intensity = audio._intensity(options, 0.6, 0.3, 1.2);
    const gain = audio._createVoiceGraph(options);
    if (!gain) return;
    const t = audio.ctx.currentTime;
    const beep = 0.055;
    const gap = 0.05;
    const total = (beep * 2) + gap;
    const peak = Math.max(0.0001, 0.17 * intensity);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + beep);
    gain.gain.exponentialRampToValueAtTime(peak, t + beep + gap + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + total);
    const osc = audio.ctx.createOscillator();
    osc.type = 'square';
    const base = 1180 + (intensity * 260);
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.setValueAtTime(base * 1.2, t + beep + gap);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + total + 0.02);
    audio._releaseVoice(total);
}

function playHit(audio, options) {
    const intensity = audio._intensity(options, 0.9, 0.2, 1.4);
    const playedRecording = audio._playRecordedSample?.('armorHit', {
        duration: 1.3,
        reservationDuration: 0.24,
        peak: 0.3 * intensity,
        playbackRate: 1,
        filter: { type: 'highpass', frequency: 48, q: 0.5 },
        options,
    });
    if (playedRecording) return;
    audio._playLayered([
        { type: 'sawtooth', startFreq: 210 * (0.9 + intensity * 0.15), endFreq: 48, duration: 0.11, peak: 0.42 * intensity, attack: 0.004 },
        { type: 'triangle', startFreq: 320, endFreq: 80, duration: 0.09, peak: 0.18 * intensity },
    ], options);
    audio._playNoise({
        duration: 0.09,
        peak: 0.2 * intensity,
        filterType: 'bandpass',
        startFrequency: 2600,
        endFrequency: 260,
        options,
    });
}

function playMgHit(audio, options) {
    const intensity = audio._intensity(options, 0.8, 0.2, 1.4);
    audio._playTone({
        type: 'triangle', startFreq: 980, endFreq: 260, duration: 0.07,
        peak: 0.24 * intensity, attack: 0.004, options,
    });
}

function playShieldHit(audio, options) {
    const intensity = audio._intensity(options, 0.9, 0.2, 1.3);
    const depleted = options.depleted === true;
    audio._playLayered([
        {
            type: 'sine', startFreq: depleted ? 640 : 820, endFreq: depleted ? 140 : 280,
            duration: depleted ? 0.28 : 0.16, peak: 0.22 * intensity, attack: 0.006,
        },
        {
            type: 'triangle', startFreq: depleted ? 980 : 1240, endFreq: depleted ? 220 : 420,
            duration: depleted ? 0.22 : 0.12, peak: 0.14 * intensity,
        },
    ], options);
}

function playPowerup(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.3);
    audio._playTone({
        type: 'sine', startFreq: 420, endFreq: 1180, duration: 0.2,
        peak: 0.34 * intensity, attack: 0.012, ramp: 'linear', options,
    });
}

function playPickup(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.3);
    audio._playLayered([
        { type: 'sine', startFreq: 520, endFreq: 880, duration: 0.1, peak: 0.22 * intensity, attack: 0.008, ramp: 'linear' },
        { type: 'triangle', startFreq: 780, endFreq: 1240, duration: 0.14, peak: 0.16 * intensity, ramp: 'linear' },
    ], options);
}

function playPortal(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.3);
    audio._playLayered([
        { type: 'sine', startFreq: 220, endFreq: 660, duration: 0.24, peak: 0.24 * intensity, attack: 0.02, ramp: 'linear' },
        { type: 'triangle', startFreq: 880, endFreq: 240, duration: 0.28, peak: 0.14 * intensity },
    ], options);
}

function playSlingshot(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.4);
    audio._playLayered([
        { type: 'sawtooth', startFreq: 90, endFreq: 260, duration: 0.22, peak: 0.26 * intensity, attack: 0.015, ramp: 'linear' },
        { type: 'triangle', startFreq: 180, endFreq: 420, duration: 0.18, peak: 0.14 * intensity, ramp: 'linear' },
    ], options);
}

function playBoost(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.4);
    audio._playLayered([
        { type: 'triangle', startFreq: 90, endFreq: 320, duration: 0.28, peak: 0.28 * intensity, attack: 0.02, ramp: 'linear' },
        { type: 'sawtooth', startFreq: 60, endFreq: 180, duration: 0.32, peak: 0.12 * intensity, ramp: 'linear' },
    ], options);
    audio._playNoise({
        duration: 0.34,
        peak: 0.13 * intensity,
        filterType: 'bandpass',
        startFrequency: 280,
        endFrequency: 2800,
        options,
    });
}

function playParcoursCheckpoint(audio, options) {
    const intensity = audio._intensity(options, 0.9, 0.25, 1.3);
    audio._playLayered([
        { type: 'sine', startFreq: 1420, endFreq: 980, duration: 0.12, peak: 0.16 * intensity, attack: 0.006 },
        { type: 'triangle', startFreq: 2120, endFreq: 1560, duration: 0.09, peak: 0.1 * intensity },
    ], options);
}

function playParcoursBranch(audio, options) {
    const intensity = audio._intensity(options, 1, 0.3, 1.4);
    audio._playLayered([
        { type: 'triangle', startFreq: 960, endFreq: 720, duration: 0.2, peak: 0.2 * intensity, attack: 0.01 },
        { type: 'square', startFreq: 1480, endFreq: 1180, duration: 0.15, peak: 0.1 * intensity },
    ], options);
}

function playParcoursFinish(audio, options) {
    const intensity = audio._intensity(options, 1.05, 0.35, 1.6);
    audio._playLayered([
        { type: 'triangle', startFreq: 240, endFreq: 360, duration: 0.5, peak: 0.22 * intensity, attack: 0.02, hold: 0.08, ramp: 'linear' },
        { type: 'sine', startFreq: 480, endFreq: 720, duration: 0.46, peak: 0.18 * intensity, ramp: 'linear' },
        { type: 'triangle', startFreq: 720, endFreq: 1080, duration: 0.34, peak: 0.14 * intensity, ramp: 'linear' },
    ], options);
}

function playParcoursWrong(audio, options) {
    const intensity = audio._intensity(options, 0.95, 0.3, 1.3);
    audio._playLayered([
        { type: 'sawtooth', startFreq: 280, endFreq: 120, duration: 0.18, peak: 0.22 * intensity, attack: 0.008 },
        { type: 'square', startFreq: 190, endFreq: 90, duration: 0.22, peak: 0.12 * intensity },
    ], options);
}

function playParcoursTimeout(audio, options) {
    const intensity = audio._intensity(options, 0.9, 0.3, 1.3);
    audio._playTone({
        type: 'triangle', startFreq: 360, endFreq: 140, duration: 0.28,
        peak: 0.2 * intensity, attack: 0.02, options,
    });
}

function playFightKill(audio, options) {
    const intensity = audio._intensity(options, 1, 0.35, 1.5);
    audio._playLayered([
        { type: 'sawtooth', startFreq: 340, endFreq: 68, duration: 0.3, peak: 0.3 * intensity, attack: 0.008 },
        { type: 'square', startFreq: 920, endFreq: 210, duration: 0.1, peak: 0.16 * intensity, attack: 0.003 },
    ], options);
}

function playFightAssist(audio, options) {
    const intensity = audio._intensity(options, 0.85, 0.3, 1.3);
    audio._playLayered([
        { type: 'triangle', startFreq: 420, endFreq: 560, duration: 0.14, peak: 0.16 * intensity, attack: 0.01, ramp: 'linear' },
        { type: 'sine', startFreq: 640, endFreq: 820, duration: 0.16, peak: 0.12 * intensity, ramp: 'linear' },
    ], options);
}

function playFightLead(audio, options) {
    const intensity = audio._intensity(options, 0.95, 0.35, 1.4);
    const t = audio.ctx.currentTime;
    const gain = audio._createVoiceGraph(options);
    if (!gain) return;
    audio._envGain(gain, 0.24 * intensity, 0.44, { attack: 0.015, hold: 0.08 });
    const root = audio.ctx.createOscillator();
    const fifth = audio.ctx.createOscillator();
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
    audio._releaseVoice(0.44);
}

function playFlagCapture(audio, options) {
    const intensity = audio._intensity(options, 0.95, 0.35, 1.4);
    audio._playLayered([
        { type: 'triangle', startFreq: 330, endFreq: 660, duration: 0.24, peak: 0.24 * intensity, attack: 0.01, ramp: 'linear' },
        { type: 'sine', startFreq: 495, endFreq: 990, duration: 0.32, peak: 0.14 * intensity, attack: 0.015, ramp: 'linear' },
    ], options);
}

function playUiTone(audio, options, tone) {
    audio._playTone({ ...tone, options: { ...options, bus: 'ui' } });
}

const PLAYERS = Object.freeze({
    SHOOT: playShoot,
    MG_SHOOT: playMgShoot,
    ROCKET_SHOOT: playRocketShoot,
    ROCKET_WARNING: playRocketWarning,
    HIT: playHit,
    MG_HIT: playMgHit,
    SHIELD_HIT: playShieldHit,
    POWERUP: playPowerup,
    PICKUP: playPickup,
    PORTAL: playPortal,
    SLINGSHOT: playSlingshot,
    BOOST: playBoost,
    PARCOURS_CP: playParcoursCheckpoint,
    PARCOURS_BRANCH: playParcoursBranch,
    PARCOURS_FINISH: playParcoursFinish,
    PARCOURS_WRONG: playParcoursWrong,
    PARCOURS_TIMEOUT: playParcoursTimeout,
    FIGHT_KILL: playFightKill,
    FIGHT_ASSIST: playFightAssist,
    FIGHT_LEAD: playFightLead,
    FLAG_CAPTURE: playFlagCapture,
    UI_DROP: (audio, options) => playUiTone(audio, options, {
        type: 'sine', startFreq: 520, endFreq: 700, duration: 0.09,
        peak: 0.12, attack: 0.006, ramp: 'linear',
    }),
    UI_PICKUP: (audio, options) => playUiTone(audio, options, {
        type: 'sine', startFreq: 260, endFreq: 360, duration: 0.09,
        peak: 0.11, attack: 0.006, ramp: 'linear',
    }),
    UI_REJECT: (audio, options) => playUiTone(audio, options, {
        type: 'sawtooth', startFreq: 140, endFreq: 70, duration: 0.11,
        peak: 0.12, attack: 0.005,
    }),
    EXCLUSION_WARNING: (audio, options) => audio._playLayered([
        { type: 'sine', startFreq: 620, endFreq: 620, duration: 0.12, peak: 0.08, attack: 0.008 },
        { type: 'triangle', startFreq: 410, endFreq: 350, duration: 0.2, peak: 0.055, attack: 0.012 },
    ], options),
});

export function playGameplayVoice(audio, type, options = {}) {
    if (!Object.hasOwn(PLAYERS, type)) return;
    PLAYERS[type](audio, options);
}
