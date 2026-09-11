import {
    deriveEndlessSeed,
    ENDLESS_PARCOURS_MODULE_LENGTH,
    sampleEndlessSeed,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_CONNECTORS,
    isEndlessConnectorAllowed,
    resolveEndlessConnector,
} from './EndlessParcoursConnectors.js';
import {
    ENDLESS_PARCOURS_MODULE_BY_ID,
    ENDLESS_PARCOURS_MODULE_CATALOG,
    ENDLESS_PARCOURS_SAFE_MODULE_ID,
} from './EndlessParcoursModuleCatalog.js';

/** Nach spaetestens so vielen Bausteinen kommt zwingend ein Erholungsmodul. */
export const ENDLESS_RECOVERY_GUARANTEE = 5;

/** Bausteine mit Decke oder Bodenplatte vertragen keinen Hoehenversatz am Eingang. */
const LEVEL_ENTRY_ONLY = new Set(['tunnel', 'vertical_passage', 'closing_walls']);

export const ENDLESS_PARCOURS_AREAS = Object.freeze(['industrial', 'canyon', 'energy']);
export const ENDLESS_PARCOURS_MODULE_RHYTHM = Object.freeze([
    'chase', 'maneuver', 'side_route', 'chase', 'challenge', 'recovery',
]);

const AREA_LAYOUTS = Object.freeze({
    industrial: Object.freeze(new Set(['fast_straight', 'slalom', 'sluice_gates', 'closing_walls'])),
    canyon: Object.freeze(new Set(['choke_point', 'vertical_passage', 'obstacle_weave', 'hazard_corridor'])),
    energy: Object.freeze(new Set(['tunnel', 'boost_passage', 'pendulum_bars', 'sprint_shafts'])),
});

const RHYTHM_LAYOUTS = Object.freeze({
    chase: Object.freeze(new Set(['fast_straight', 'choke_point', 'tunnel', 'boost_passage'])),
    maneuver: Object.freeze(new Set(['slalom', 'vertical_passage', 'boost_passage', 'obstacle_weave'])),
    side_route: Object.freeze(new Set(['sluice_gates', 'obstacle_weave', 'sprint_shafts', 'choke_point'])),
    challenge: Object.freeze(new Set(['closing_walls', 'hazard_corridor', 'pendulum_bars', 'sprint_shafts'])),
});

export function resolveEndlessArea(baseSeed, moduleIndex, previousArea = '') {
    const index = Math.max(0, Math.floor(Number(moduleIndex) || 0));
    if (index === 0) return 'intro';
    const block = Math.floor((index - 1) / 6);
    if (block < ENDLESS_PARCOURS_AREAS.length) return ENDLESS_PARCOURS_AREAS[block];
    let prior = ENDLESS_PARCOURS_AREAS[ENDLESS_PARCOURS_AREAS.length - 1];
    for (let currentBlock = ENDLESS_PARCOURS_AREAS.length; currentBlock <= block; currentBlock += 1) {
        const candidates = ENDLESS_PARCOURS_AREAS.filter((area) => area !== prior);
        const roll = sampleEndlessSeed(deriveEndlessSeed(baseSeed, `area:${currentBlock}`));
        prior = candidates[Math.floor(roll * candidates.length) % candidates.length];
    }
    void previousArea;
    return prior;
}

export function resolveEndlessModuleRhythm(moduleIndex) {
    const index = Math.max(0, Math.floor(Number(moduleIndex) || 0));
    return index === 0 ? 'intro' : ENDLESS_PARCOURS_MODULE_RHYTHM[(index - 1) % ENDLESS_PARCOURS_MODULE_RHYTHM.length];
}

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

function selectDefinition({ baseSeed, moduleIndex, entranceConnector, difficultyTier, forceRecovery, area, rhythm, previousTemplateId }) {
    if (moduleIndex === 0) return ENDLESS_PARCOURS_MODULE_BY_ID.get('combat_free_intro');
    if (forceRecovery || rhythm === 'recovery') return ENDLESS_PARCOURS_MODULE_BY_ID.get('recovery');
    const entrance = resolveEndlessConnector(entranceConnector);
    const tier = Math.max(1, Math.floor(Number(difficultyTier) || 1));
    const candidates = [];
    for (const definition of ENDLESS_PARCOURS_MODULE_CATALOG) {
        if (definition.id === 'combat_free_intro' || definition.minimumTier > tier) continue;
        if (definition.id === previousTemplateId) continue;
        if (AREA_LAYOUTS[area] && !AREA_LAYOUTS[area].has(definition.id)) continue;
        if (RHYTHM_LAYOUTS[rhythm] && !RHYTHM_LAYOUTS[rhythm].has(definition.id)) continue;
        if (entrance.offsetY !== 0 && LEVEL_ENTRY_ONLY.has(definition.id)) continue;
        let weight = Math.max(0.1, Number(definition.weight) || 1);
        if (definition.recovery) weight *= Math.max(0.18, 1 - tier * 0.18);
        if (definition.minimumTier >= 2) weight *= 1 + (tier - 1) * 0.28;
        candidates.push({ definition, weight });
    }
    const selected = chooseWeighted(
        candidates,
        sampleEndlessSeed(deriveEndlessSeed(baseSeed, `module-selection:${moduleIndex}`))
    );
    if (selected) return selected;
    const fallback = ENDLESS_PARCOURS_MODULE_CATALOG.find((definition) => (
        definition.id !== 'combat_free_intro'
        && definition.id !== previousTemplateId
        && definition.minimumTier <= tier
        && (!RHYTHM_LAYOUTS[rhythm] || RHYTHM_LAYOUTS[rhythm].has(definition.id))
    ));
    return fallback || ENDLESS_PARCOURS_MODULE_BY_ID.get(ENDLESS_PARCOURS_SAFE_MODULE_ID);
}

function selectExitConnector({ definition, baseSeed, moduleIndex, entryDrift }) {
    const candidates = [];
    for (const id of definition.exitCandidates || ['straight']) {
        const connector = resolveEndlessConnector(id);
        if (!isEndlessConnectorAllowed(entryDrift, connector)) continue;
        candidates.push({ definition: connector, weight: Math.max(0.1, Number(connector.weight) || 1) });
    }
    if (candidates.length === 0) return ENDLESS_CONNECTORS.straight;
    return chooseWeighted(
        candidates,
        sampleEndlessSeed(deriveEndlessSeed(baseSeed, `module-exit:${moduleIndex}`))
    ) || ENDLESS_CONNECTORS.straight;
}

function createContent(definition, baseSeed, moduleIndex, sideRoute = null) {
    const contentRoll = sampleEndlessSeed(deriveEndlessSeed(baseSeed, `module-content:${moduleIndex}`));
    const mirror = contentRoll >= 0.5 ? -1 : 1;
    const pickups = definition.pickups.map((entry, index) => ({
        ...entry,
        id: `${moduleIndex}:pickup:${index}`,
        x: entry.x * mirror,
    }));
    const colliders = definition.colliders.map((entry, index) => ({
        ...entry,
        id: `${moduleIndex}:collider:${index}`,
        x: entry.x * mirror,
        cycle: entry.cycle ? { ...entry.cycle } : null,
    }));
    if (sideRoute) {
        pickups.push({
            id: `${moduleIndex}:pickup:risk`,
            x: sideRoute.side * 18,
            y: 8,
            z: 60,
            type: sideRoute.pickupType,
            sideRouteId: sideRoute.id,
        });
        colliders.push({
            id: `${moduleIndex}:collider:route-divider`,
            x: 0, y: 9, z: 60, sx: 3, sy: 18, sz: 46, cycle: null,
        });
    }
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

/**
 * Baut einen Baustein. `entranceConnector` und `entryDrift` kommen aus dem
 * Vorgaenger, damit der Korridor ohne Sprung weiterlaeuft; `entryDrift` ist der
 * bereits aufsummierte Weltversatz des Korridormittelpunkts.
 *
 * @param {{ baseSeed?: unknown, moduleIndex?: unknown, previousConnector?: string, entryDrift?: { x: number, y: number }, difficultyTier?: unknown, sinceRecovery?: unknown }} [options]
 */
export function generateEndlessParcoursModule({
    baseSeed,
    moduleIndex,
    previousConnector = 'straight',
    entryDrift = { x: 0, y: 0 },
    difficultyTier = 1,
    sinceRecovery = 0,
    previousTemplateId = '',
    previousArea = '',
} = {}) {
    const index = Math.max(0, Math.floor(Number(moduleIndex) || 0));
    const safeEntryDrift = {
        x: Number(entryDrift?.x) || 0,
        y: Number(entryDrift?.y) || 0,
    };
    const area = resolveEndlessArea(baseSeed, index, previousArea);
    const rhythm = resolveEndlessModuleRhythm(index);
    const definition = selectDefinition({
        baseSeed,
        moduleIndex: index,
        entranceConnector: previousConnector,
        difficultyTier,
        forceRecovery: index > 0 && Math.max(0, Math.floor(Number(sinceRecovery) || 0)) >= ENDLESS_RECOVERY_GUARANTEE,
        area,
        rhythm,
        previousTemplateId: String(previousTemplateId || ''),
    });
    const sideRoute = rhythm === 'side_route' ? Object.freeze({
        id: `${index}:side-route`,
        side: sampleEndlessSeed(deriveEndlessSeed(baseSeed, `side-route:${index}`)) < 0.5 ? -1 : 1,
        entryZ: 28,
        exitZ: 92,
        bonusScore: 200,
        pickupType: area === 'industrial' ? 'ROCKET_MEDIUM' : (area === 'canyon' ? 'SHIELD' : 'SPEED_UP'),
    }) : null;
    const content = createContent(definition, baseSeed, index, sideRoute);
    const exit = selectExitConnector({ definition, baseSeed, moduleIndex: index, entryDrift: safeEntryDrift });
    const exitDrift = {
        x: safeEntryDrift.x + exit.offsetX,
        y: safeEntryDrift.y + exit.offsetY,
    };
    return Object.freeze({
        id: `${definition.id}:${index}`,
        templateId: definition.id,
        arrangementId: definition.id,
        label: definition.label,
        area,
        rhythm,
        recovery: definition.recovery === true,
        moduleIndex: index,
        originZ: index * ENDLESS_PARCOURS_MODULE_LENGTH,
        length: ENDLESS_PARCOURS_MODULE_LENGTH,
        entranceConnector: resolveEndlessConnector(previousConnector).id,
        exitConnector: exit.id,
        entryDrift: Object.freeze(safeEntryDrift),
        exitDrift: Object.freeze(exitDrift),
        checkpointZ: index * ENDLESS_PARCOURS_MODULE_LENGTH + definition.checkpointZ,
        localCheckpointZ: definition.checkpointZ,
        colliders: Object.freeze(content.colliders),
        pickups: Object.freeze(content.pickups),
        botAnchors: Object.freeze(createSpawnAnchors(definition, baseSeed, index)),
        mirror: content.mirror,
        difficultyTier: Math.max(0, Math.floor(Number(difficultyTier) || 0)),
        sideRoute,
    });
}

/**
 * Baut die Kette ab Baustein 0. Der Versatz summiert sich, deshalb ist die Kette
 * und nicht der einzelne Index die Wahrheit ueber den Streckenverlauf.
 *
 * @param {unknown} baseSeed
 * @param {unknown} count
 * @param {unknown} [difficultyTier]
 */
export function generateEndlessParcoursSequence(baseSeed, count, difficultyTier = 1) {
    const output = [];
    let connector = 'straight';
    let drift = { x: 0, y: 0 };
    let sinceRecovery = 0;
    let previousTemplateId = '';
    let previousArea = '';
    for (let index = 0; index < Math.max(0, Math.floor(Number(count) || 0)); index += 1) {
        const module = generateEndlessParcoursModule({
            baseSeed,
            moduleIndex: index,
            previousConnector: connector,
            entryDrift: drift,
            difficultyTier,
            sinceRecovery,
            previousTemplateId,
            previousArea,
        });
        output.push(module);
        connector = module.exitConnector;
        drift = { x: module.exitDrift.x, y: module.exitDrift.y };
        sinceRecovery = module.recovery || module.templateId === 'combat_free_intro' ? 0 : sinceRecovery + 1;
        previousTemplateId = module.templateId;
        previousArea = module.area;
    }
    return output;
}
