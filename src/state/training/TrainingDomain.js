// ============================================
// TrainingDomain.js - deterministic domain mapping via mode + planarMode
// ============================================

export const TRAINING_DOMAIN_VERSION = 'mode-planar-control-v2';

const MODE_ALIASES = Object.freeze({
    classic: 'classic',
    normal: 'classic',
    hunt: 'hunt',
    fight: 'hunt',
});

function normalizeModeValue(mode) {
    if (typeof mode !== 'string') return 'classic';
    const normalized = mode.trim().toLowerCase();
    return MODE_ALIASES[normalized] || 'classic';
}

function normalizeDomainModeValue(mode) {
    if (typeof mode !== 'string') return 'classic';
    const normalized = mode.trim().toLowerCase();
    if (!normalized) return 'classic';
    if (normalized === 'fight') return 'fight';
    return MODE_ALIASES[normalized] || 'classic';
}

function normalizeControlProfileId(value, mode, dimension) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim().toLowerCase();
    }
    return `legacy-v1:${mode}-${dimension}`;
}

export function normalizeTrainingMode(mode) {
    return normalizeModeValue(mode);
}

export function deriveTrainingDomain(input = {}) {
    const payload = /** @type {Record<string, any>} */ (
        input && typeof input === 'object'
            ? input
            : { mode: input }
    );
    const mode = normalizeModeValue(payload.mode);
    const domainMode = normalizeDomainModeValue(payload.mode);
    const planarMode = !!payload.planarMode;
    const dimension = planarMode ? '2d' : '3d';
    const controlProfileId = normalizeControlProfileId(
        payload.controlProfileId,
        mode,
        dimension
    );

    const domain = {
        version: TRAINING_DOMAIN_VERSION,
        mode,
        planarMode,
        dimension,
        domainId: `${domainMode}-${dimension}`,
        controlProfileId,
    };

    if (typeof payload.matchBotType === 'string' && payload.matchBotType.trim()) {
        domain.matchBotType = payload.matchBotType.trim();
    }
    return domain;
}
