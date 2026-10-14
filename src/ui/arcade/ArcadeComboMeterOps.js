// Mirrors ArcadeScoreOps combo timing so the HUD meter reflects the live combo rules.
const SECONDS_FORMATTER = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

export function resolveArcadeComboMeter(input = {}) {
    const nowMs = Math.max(0, toSafeNumber(input.nowMs, 0));
    const combo = Math.max(0, Math.round(toSafeNumber(input.combo, 0)));
    const windowMs = Math.max(800, toSafeNumber(input.comboWindowMs, 5000));
    const decayPerSecond = Math.max(0, toSafeNumber(input.comboDecayPerSecond, 1));
    const multiplier = Math.max(1, Math.round(toSafeNumber(input.multiplier, 1)));
    const maxMultiplier = Math.max(1, Math.round(toSafeNumber(input.maxMultiplier, 8)));
    const factorLabel = `×${multiplier}`;
    if (combo <= 0) return { phase: 'idle', ratio: 0, hint: '', factorLabel };
    if (decayPerSecond <= 0) {
        const next = multiplier < maxMultiplier ? ` · ×${multiplier + 1} bei Kombo ${multiplier * 2}` : '';
        return { phase: 'persistent', ratio: 1, hint: `Hält dauerhaft${next}`, factorLabel };
    }

    const elapsedMs = Math.max(0, nowMs - Math.max(0, toSafeNumber(input.lastComboAtMs, 0)));
    const remainingMs = Math.max(0, windowMs - elapsedMs);
    const freezeUntilMs = Math.max(0, toSafeNumber(input.comboFreezeUntilMs, 0));
    const frozen = freezeUntilMs > 0 && nowMs <= freezeUntilMs;
    const inWindow = elapsedMs <= windowMs;
    const phase = frozen ? 'frozen' : inWindow ? 'window' : 'decaying';
    const ratio = frozen ? 1 : Math.max(0, Math.min(1, remainingMs / windowMs));
    const status = phase === 'frozen' ? 'Eingefroren'
        : phase === 'window' ? `${SECONDS_FORMATTER.format(remainingMs / 1000)} s`
            : 'Verfällt';
    const next = multiplier < maxMultiplier ? ` · ×${multiplier + 1} bei Kombo ${multiplier * 2}` : '';
    return { phase, ratio, hint: `${status}${next}`, factorLabel };
}
