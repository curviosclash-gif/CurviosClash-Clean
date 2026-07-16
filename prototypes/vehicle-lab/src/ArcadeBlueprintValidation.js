import {
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
} from '../../../src/entities/arcade/ArcadeBlueprintSchema.js';

const SLOT_LABELS = Object.freeze({
    core: 'Rumpf',
    nose: 'Nase',
    wing_left: 'Flügel links',
    wing_right: 'Flügel rechts',
    engine_left: 'Antrieb links',
    engine_right: 'Antrieb rechts',
});

function translateValidationIssue(issue) {
    const text = String(issue || '');
    const missing = text.match(/^missing required slot: (.+)$/);
    if (missing) return `Pflichtrolle fehlt: ${SLOT_LABELS[missing[1]] || missing[1]}`;
    return text
        .replace(/^schemaVersion mismatch/, 'Schema-Version stimmt nicht überein')
        .replace(/^missing blueprintId$/, 'Blueprint-ID fehlt')
        .replace(/^editorBudget exceeded/, 'Budget überschritten')
        .replace(/^massBudget exceeded/, 'Masse überschritten')
        .replace(/^powerBudget exceeded/, 'Energie überschritten')
        .replace(/^heatBudget exceeded/, 'Hitze überschritten')
        .replace(/^hitbox radius exceeds class/, 'Hitbox-Radius überschreitet Klasse')
        .replace(/^hitbox width exceeds class/, 'Hitbox-Breite überschreitet Klasse')
        .replace(/^hitbox height exceeds class/, 'Hitbox-Höhe überschreitet Klasse')
        .replace(/^hitbox length exceeds class/, 'Hitbox-Länge überschreitet Klasse')
        .replace(/^high part count \((\d+)\) may impact runtime perf$/, 'Hohe Bauteilzahl ($1) kann die Laufzeit beeinträchtigen');
}

export function buildValidatedArcadeBlueprint(config, options = {}) {
    const blueprint = createArcadeBlueprintFromVehicleConfig(config, options);
    const validation = validateArcadeBlueprint(blueprint);
    return {
        blueprint,
        validation,
    };
}

export function describeArcadeBlueprintStatus(result) {
    const blueprint = result?.blueprint || null;
    const validation = result?.validation || null;
    if (!blueprint || !validation) {
        return 'Blueprint: n/a';
    }
    const stats = blueprint.stats || {};
    const limits = blueprint.limits || {};
    const status = validation.ok ? 'gültig' : 'ungültig';
    const missingRoles = validation.errors
        .map((issue) => String(issue || '').match(/^missing required slot: (.+)$/)?.[1])
        .filter(Boolean)
        .map((role) => SLOT_LABELS[role] || role);
    return [
        `Blueprint ${status}`,
        missingRoles.length > 0 ? `Fehlt: ${missingRoles.join(', ')}` : '',
        `Budget ${stats.budgetUsed || 0}/${limits.editorBudget || 0}`,
        `Masse ${stats.massUsed || 0}/${limits.massBudget || 0}`,
        `Energie ${stats.powerUsed || 0}/${limits.powerBudget || 0}`,
        `Hitze ${stats.heatUsed || 0}/${limits.heatBudget || 0}`,
    ].filter(Boolean).join(' | ');
}

export function formatArcadeBlueprintValidationMessage(result) {
    const validation = result?.validation;
    if (!validation) return 'Blueprint-Prüfung nicht verfügbar.';
    if (validation.ok) return 'Blueprint ist gültig.';
    return [...(validation.errors || []), ...(validation.warnings || [])]
        .map(translateValidationIssue)
        .join(' · ');
}

export default {
    buildValidatedArcadeBlueprint,
    describeArcadeBlueprintStatus,
    formatArcadeBlueprintValidationMessage,
};
