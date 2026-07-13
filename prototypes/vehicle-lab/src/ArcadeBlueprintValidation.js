import {
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
    formatArcadeBlueprintValidation,
} from '../../../src/entities/arcade/ArcadeBlueprintSchema.js';

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
    const status = validation.ok ? 'ok' : 'invalid';
    return [
        `Blueprint ${status}`,
        `budget ${stats.budgetUsed || 0}/${limits.editorBudget || 0}`,
        `mass ${stats.massUsed || 0}/${limits.massBudget || 0}`,
        `power ${stats.powerUsed || 0}/${limits.powerBudget || 0}`,
        `heat ${stats.heatUsed || 0}/${limits.heatBudget || 0}`,
    ].join(' | ');
}

export function formatArcadeBlueprintValidationMessage(result) {
    return formatArcadeBlueprintValidation(result?.validation || null);
}

export default {
    buildValidatedArcadeBlueprint,
    describeArcadeBlueprintStatus,
    formatArcadeBlueprintValidationMessage,
};
