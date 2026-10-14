// ============================================
// AudioPlayback.js - Event dispatch (cooldowns, explosion echo, ducking) and debug events
// ============================================

import { HIGH_IMPACT_EVENTS } from './AudioEventProfiles.js';
import { playExplosionVoice, playRocketImpactVoice, resetExplosionChain, resolveExplosionEcho } from './ExplosionVoice.js';
import { playGameplayVoice } from './GameplayVoices.js';

const DEFAULT_COOLDOWN_MS = 50;
// Event type -> AudioManager voice method; the manager keeps these overridable by name.
const VOICE_METHODS = {
    SHOOT: '_playShoot',
    MG_SHOOT: '_playMgShoot',
    ROCKET_SHOOT: '_playRocketShoot',
    HIT: '_playHit',
    MG_HIT: '_playMgHit',
    SHIELD_HIT: '_playShieldHit',
    POWERUP: '_playPowerup',
    PICKUP: '_playPickup',
    PORTAL: '_playPortal',
    SLINGSHOT: '_playSlingshot',
    BOOST: '_playBoost',
    PARCOURS_CP: '_playParcoursCheckpoint',
    PARCOURS_BRANCH: '_playParcoursBranch',
    PARCOURS_FINISH: '_playParcoursFinish',
    PARCOURS_WRONG: '_playParcoursWrong',
    PARCOURS_TIMEOUT: '_playParcoursTimeout',
    FIGHT_KILL: '_playFightKill',
    FIGHT_ASSIST: '_playFightAssist',
    FIGHT_LEAD: '_playFightLead',
    UI_DROP: '_playUiDrop',
    UI_PICKUP: '_playUiPickup',
    UI_REJECT: '_playUiReject',
    EXCLUSION_WARNING: '_playExclusionWarning',
};

export function recordAudioDebugEvent(audio, type, options = {}) {
    audio._debugEvents.push({
        type,
        intensity: Number.isFinite(Number(options.intensity)) ? Number(options.intensity) : null,
        depleted: options.depleted === true,
        at: audio._resolveTime(),
    });
    if (audio._debugEvents.length > audio._maxDebugEvents) {
        audio._debugEvents.splice(0, audio._debugEvents.length - audio._maxDebugEvents);
    }
}

export function playAudioEvent(audio, type, options = {}) {
    if (!audio.enabled || !audio.ctx) return;
    if (audio.ctx.state === 'suspended') audio.ctx.resume();

    const now = audio._resolveTime();
    const last = audio.lastPlayTime[type] || 0;
    const cooldown = audio.cooldowns[type] || DEFAULT_COOLDOWN_MS;
    const cooldownBlocked = now - last < cooldown;
    if (cooldownBlocked) {
        // Only explosions answer a blocked shot, and only twice per window, so
        // a chain reaction stays audible without a mass wipe turning to noise.
        const echo = type === 'EXPLOSION' ? resolveExplosionEcho(audio._explosionChain) : null;
        if (!echo) return;
        options = { ...options, ...echo };
    } else if (type === 'EXPLOSION') {
        resetExplosionChain(audio._explosionChain);
    }
    if (!cooldownBlocked) audio.lastPlayTime[type] = now;
    audio._recordDebugEvent(type, options);
    if (HIGH_IMPACT_EVENTS.has(type)) audio._duckMusic();

    if (type === 'EXPLOSION') playExplosionVoice(audio, options);
    else if (type === 'REACTOR_BREACH' || type === 'ROCKET_IMPACT') playRocketImpactVoice(audio, options);
    else if (Object.hasOwn(VOICE_METHODS, type)) audio[VOICE_METHODS[type]](options);
    else playGameplayVoice(audio, type, options);
}
