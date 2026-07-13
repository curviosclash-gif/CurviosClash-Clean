import { clamp } from '../utils/MathOps.js';

function resolveDamageValue(event) {
    const damageResult = event?.damageResult || {};
    const requested = Math.max(0, Number(damageResult.applied) || 0);
    const absorbed = Math.max(0, Number(damageResult.absorbedByShield) || 0);
    const hpApplied = Math.max(0, Number(damageResult.hpApplied) || (requested - absorbed));
    return hpApplied + absorbed;
}

export function resolveScreenShakeProfile(event) {
    const damageValue = resolveDamageValue(event);
    if (damageValue <= 0) {
        return { intensity: 0, duration: 0 };
    }

    const intensity = clamp(0.08 + damageValue / 70, 0.08, 0.52);
    const duration = clamp(0.1 + damageValue / 180, 0.12, 0.38);
    return { intensity, duration };
}

export class ScreenShake {
    constructor(renderer) {
        this.renderer = renderer;
    }

    triggerForDamage(event) {
        if (!this.renderer || typeof this.renderer.triggerCameraShake !== 'function') {
            return;
        }

        const target = event?.target;
        if (!target || target.isBot || !Number.isInteger(target.index)) {
            return;
        }

        const profile = resolveScreenShakeProfile(event);
        if (profile.intensity <= 0 || profile.duration <= 0) {
            return;
        }

        this.renderer.triggerCameraShake(target.index, profile.intensity, profile.duration);
    }
}
