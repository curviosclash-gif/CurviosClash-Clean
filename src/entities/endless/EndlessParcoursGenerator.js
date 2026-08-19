import {
    deriveEndlessSeed,
    ENDLESS_PARCOURS_MODULE_LENGTH,
    sampleEndlessSeed,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_MODULE_BY_ID,
    ENDLESS_PARCOURS_MODULE_CATALOG,
    ENDLESS_PARCOURS_SAFE_MODULE_ID,
} from './EndlessParcoursModuleCatalog.js';

function chooseWeighted(candidates, roll) {
    let total = 0;
    for (const entry of candidates) total += entry.weight;
    if (total <= 0) return candidates[0]?.definition || null;
    let cursor = Math.max(0, Math.min(0.999999999, roll)) * total;
    for (const entry of candidates) {
        cursor -= entry.weight;
        if (cursor <= 0) return entry.definition;
    }
    return candidates[candidates.length - 1]?.definition || null;
}

function selectDefinition(baseSeed, moduleIndex, previousConnector, difficultyTier) {
    if (moduleIndex === 0) return ENDLESS_PARCOURS_MODULE_BY_ID.get('combat_free_intro');
    if (previousConnector !== 'straight') return ENDLESS_PARCOURS_MODULE_BY_ID.get(ENDLESS_PARCOURS_SAFE_MODULE_ID);
    const tier = Math.max(1, Math.floor(Number(difficultyTier) || 1));
    const candidates = [];
    for (const definition of ENDLESS_PARCOURS_MODULE_CATALOG) {
        if (definition.id === 'combat_free_intro' || definition.minimumTier > tier) continue;
        let weight = Math.max(0.1, Number(definition.weight) || 1);
        if (definition.recovery) weight *= Math.max(0.18, 1 - tier * 0.18);
        if (definition.minimumTier >= 2) weight *= 1 + (tier - 1) * 0.28;
        candidates.push({ definition, weight });
    }
    return chooseWeighted(
        candidates,
        sampleEndlessSeed(deriveEndlessSeed(baseSeed, `module-selection:${moduleIndex}`))
    ) || ENDLESS_PARCOURS_MODULE_BY_ID.get(ENDLESS_PARCOURS_SAFE_MODULE_ID);
}

function createContent(definition, baseSeed, moduleIndex, difficultyTier) {
    const contentRoll = sampleEndlessSeed(deriveEndlessSeed(baseSeed, `module-content:${moduleIndex}`));
    const mirror = contentRoll >= 0.5 ? -1 : 1;
    const pickupReduction = Math.max(0, Math.floor(Number(difficultyTier) || 1) - 1);
    const pickups = definition.pickups
        .filter((_entry, index) => !definition.recovery || index + pickupReduction < definition.pickups.length)
        .map((entry, index) => ({
            ...entry,
            id: `${moduleIndex}:pickup:${index}`,
            x: entry.x * mirror,
        }));
    const colliders = definition.colliders.map((entry, index) => ({
        ...entry,
        id: `${moduleIndex}:collider:${index}`,
        x: entry.x * mirror,
    }));
    return { pickups, colliders, mirror };
}

function createSpawnAnchors(definition, baseSeed, moduleIndex) {
    const seed = deriveEndlessSeed(baseSeed, `spawn-anchor:${moduleIndex}`);
    const rotate = definition.botAnchors.length > 0
        ? Math.floor(sampleEndlessSeed(seed) * definition.botAnchors.length)
        : 0;
    return definition.botAnchors.map((_entry, index) => {
        const source = definition.botAnchors[(index + rotate) % definition.botAnchors.length];
        return {
            ...source,
            id: `${moduleIndex}:spawn:${index}`,
        };
    });
}

export function generateEndlessParcoursModule({
    baseSeed,
    moduleIndex,
    previousConnector = 'straight',
    difficultyTier = 1,
} = {}) {
    const index = Math.max(0, Math.floor(Number(moduleIndex) || 0));
    const definition = selectDefinition(baseSeed, index, previousConnector, difficultyTier);
    const content = createContent(definition, baseSeed, index, difficultyTier);
    return Object.freeze({
        id: `${definition.id}:${index}`,
        templateId: definition.id,
        label: definition.label,
        moduleIndex: index,
        originZ: index * ENDLESS_PARCOURS_MODULE_LENGTH,
        length: ENDLESS_PARCOURS_MODULE_LENGTH,
        entranceConnector: definition.entrance.id,
        exitConnector: definition.exit.id,
        checkpointZ: index * ENDLESS_PARCOURS_MODULE_LENGTH + definition.checkpointZ,
        colliders: Object.freeze(content.colliders),
        pickups: Object.freeze(content.pickups),
        botAnchors: Object.freeze(createSpawnAnchors(definition, baseSeed, index)),
        mirror: content.mirror,
        difficultyTier: Math.max(0, Math.floor(Number(difficultyTier) || 0)),
    });
}

export function generateEndlessParcoursSequence(baseSeed, count, difficultyTier = 1) {
    const output = [];
    let connector = 'straight';
    for (let index = 0; index < Math.max(0, Math.floor(Number(count) || 0)); index += 1) {
        const module = generateEndlessParcoursModule({ baseSeed, moduleIndex: index, previousConnector: connector, difficultyTier });
        output.push(module);
        connector = module.exitConnector;
    }
    return output;
}
