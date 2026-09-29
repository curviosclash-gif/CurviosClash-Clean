import { normalizeArcadeScenario } from '../../shared/contracts/ArcadeScenarioContract.js';

// Arcade scenarios ("Einsätze"): sectors that bring content the template pools never reach -
// map units, hunt weapons, water. `slot: 'sector'` scenarios replace a regular sector inside
// their sector range, `slot: 'finale'` scenarios can take the boss sector.
const RAW_ARCADE_SCENARIOS = [
    {
        id: 'worm_hunt',
        label: 'Wurmjagd',
        briefing: 'Der Riesenwurm ist erwacht. Erlege ihn, bevor die Zeit abläuft.',
        slot: 'sector',
        mapKey: 'standard',
        combatProfile: 'hunt',
        squadId: 'scout_duo',
        objective: { id: 'destroy_units', label: 'Wurmjagd', unitKind: 'creature', count: 1, durationSec: 120, scoreWeight: 1.4 },
        minSector: 3,
        maxSector: 6,
    },
    {
        id: 'storm_flood',
        label: 'Sturmflut',
        briefing: 'Nach 20 Sekunden bricht der Damm. Halte 90 Sekunden gegen das Jägerrudel durch.',
        slot: 'sector',
        mapKey: 'storm_dam_siege',
        waterZoneTriggerSec: 20,
        squadId: 'hunter_pack',
        objective: { id: 'survive_window', label: 'Sturmflut', durationSec: 90, scoreWeight: 1.3 },
        minSector: 3,
    },
    {
        id: 'hydra_finale',
        label: 'Hydra-Tempel',
        briefing: 'Im Tempel wartet die Hydra. Besiege sie, um den Lauf zu gewinnen.',
        slot: 'finale',
        mapKey: 'hydra_temple',
        combatProfile: 'hunt',
        squadId: 'striker_tri',
        objective: { id: 'destroy_units', label: 'Hydra besiegen', unitKind: 'creature', count: 1, durationSec: 0, scoreWeight: 1.5 },
        minSector: 3,
    },
];

export const ARCADE_SCENARIOS = Object.freeze(RAW_ARCADE_SCENARIOS.map(normalizeArcadeScenario).filter(Boolean));

// Scenario sectors sit one before every parcours slot (3, 7, 11 ...), so a default run of five
// sectors reads: two warm-up sectors, a scenario, a parcours, the finale.
const SCENARIO_SECTOR_INTERVAL = 4;
const SCENARIO_SECTOR_OFFSET = 3;
const FINALE_SCENARIO_CHANCE = 0.5;
const MIN_SECTORS_FOR_SCENARIOS = 3;

function pick(pool, randomFn) {
    if (pool.length === 0) return null;
    return pool[Math.min(pool.length - 1, Math.floor(randomFn() * pool.length))];
}

/**
 * The scenario a sector plays, or null for a regular sector.
 * `randomFn` must be a stream of its own: drawing from the plan stream would reshuffle every
 * sector after the first scenario.
 */
export function resolveArcadeScenarioForSector({ sectorNumber, sectorCount, isBoss, isParcours }, randomFn) {
    if (isParcours || sectorCount < MIN_SECTORS_FOR_SCENARIOS || sectorNumber < MIN_SECTORS_FOR_SCENARIOS) return null;
    const inRange = (scenario) => sectorNumber >= scenario.minSector && sectorNumber <= scenario.maxSector;
    if (isBoss) {
        if (randomFn() >= FINALE_SCENARIO_CHANCE) return null;
        return pick(ARCADE_SCENARIOS.filter((scenario) => scenario.slot === 'finale' && inRange(scenario)), randomFn);
    }
    if (sectorNumber % SCENARIO_SECTOR_INTERVAL !== SCENARIO_SECTOR_OFFSET % SCENARIO_SECTOR_INTERVAL) return null;
    return pick(ARCADE_SCENARIOS.filter((scenario) => scenario.slot === 'sector' && inRange(scenario)), randomFn);
}

/** The fields a scenario lays over the sector entry of its slot. */
export function applyArcadeScenarioToSectorEntry(entry, scenario) {
    if (!scenario) return entry;
    return {
        ...entry,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        briefing: scenario.briefing,
        mapKey: scenario.mapKey,
        mapKeyLocked: true,
        combatProfile: scenario.combatProfile,
        waterZoneTriggerSec: scenario.waterZoneTriggerSec,
        squadId: scenario.squadId || entry.squadId,
        ...(scenario.botCount === null ? {} : { botCount: scenario.botCount }),
        objectiveId: scenario.objective.id,
        objective: scenario.objective,
        modifierId: null,
        scoreBonus: 0,
    };
}

export default {
    ARCADE_SCENARIOS,
    applyArcadeScenarioToSectorEntry,
    resolveArcadeScenarioForSector,
};
