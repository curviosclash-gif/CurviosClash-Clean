import { normalizeArcadeScenario } from '../../shared/contracts/ArcadeScenarioContract.js';
import { BLOOM_CORE_FINAL_OPEN_SECONDS } from '../../shared/contracts/BloomCoreTimingContract.js';

const WORM_HUNT_WORM_COUNT = 100;
const WORM_HUNT_WORMS = Array.from({ length: WORM_HUNT_WORM_COUNT }, (_, index) => {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const x = -31.5 + column * 7;
    const z = -31.5 + row * 7;
    return {
        id: `worm_hunt_creature_${index + 1}`,
        kind: 'creature',
        path: [[x, 0, z], [x + 3, 0, z]],
        loop: true,
        speed: 8,
        maxHp: 6,
        hitboxRadius: 3,
        respawnSeconds: 0,
        allowedModes: ['ARCADE'],
    };
});

// Arcade scenarios ("Einsätze"): sectors that bring content the template pools never reach -
// map units, hunt weapons, water. `slot: 'sector'` scenarios replace a regular sector inside
// their sector range, `slot: 'finale'` scenarios can take the boss sector.
const RAW_ARCADE_SCENARIOS = [
    {
        id: 'worm_hunt',
        label: 'Wurmjagd',
        briefing: '100 Würmer sind erwacht. Erlege alle, bevor die Zeit abläuft.',
        slot: 'sector',
        mapKey: 'standard',
        combatProfile: 'hunt',
        squadId: 'scout_duo',
        objective: { id: 'destroy_units', label: 'Wurmjagd', unitKind: 'creature', count: WORM_HUNT_WORM_COUNT, durationSec: 120, scoreWeight: 1.4 },
        mapUnitsMode: 'replace',
        mapUnits: WORM_HUNT_WORMS,
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
        id: 'spiessrutenlauf',
        label: 'Spießrutenlauf',
        briefing: 'Durchquere die Spiegelwerft, während ihre Geschütze auf dich feuern.',
        slot: 'parcours',
        mapKey: 'mirror_docks',
        combatProfile: 'hunt',
        preserveObjective: true,
        minSector: 4,
        mapUnits: [],
    },
    {
        id: 'rift_precision_run', label: 'Rift-Präzision',
        briefing: 'Fliege die engen Ringe des Rift-Kurses und halte die Linie bis zum Ziel.',
        slot: 'parcours', mapKey: 'parcours_rift_precision', combatProfile: 'hunt',
        preserveObjective: true, minSector: 4,
    },
    {
        id: 'glass_serpent_run', label: 'Glasschlange',
        briefing: 'Folge dem Glasparcours durch alle Checkpoints bis zum Ausgang.',
        slot: 'parcours', mapKey: 'glass_serpent', combatProfile: 'hunt',
        preserveObjective: true, minSector: 4,
    },
    {
        id: 'wind_cathedral_run', label: 'Windkathedrale',
        briefing: 'Halte den Kurs durch die Windkathedrale bis zum Zielportal.',
        slot: 'parcours', mapKey: 'wind_cathedral', combatProfile: 'hunt',
        preserveObjective: true, minSector: 4,
    },
    {
        id: 'bomber_alarm',
        label: 'Bomberalarm',
        briefing: 'Ein Bomber kreist über dem Sektor. Weiche seinen Angriffen aus.',
        slot: 'sector',
        mapKey: 'standard',
        combatProfile: 'hunt',
        minSector: 3,
        maxSector: 6,
        mapUnits: [{
            id: 'arcade_bomber_alarm',
            kind: 'bomber',
            path: [[-34, 24, 0], [34, 24, 0]],
            speed: 30,
            allowedModes: ['ARCADE'],
        }],
        mapUnitsMode: 'replace',
        objective: { id: 'destroy_units', label: 'Bomberalarm', unitKind: 'bomber', count: 1, durationSec: 120, scoreWeight: 1.3 },
    },
    {
        id: 'bridge_convoy',
        label: 'Konvoi auf der Brücke',
        briefing: 'Drei Panzer rollen zum Brückenausgang. Stoppe alle drei, bevor einer das Ziel erreicht.',
        slot: 'sector', mapKey: 'storm_bridge_siege', combatProfile: 'hunt', botCount: 0,
        minSector: 3, maxSector: 6,
        mapUnitsMode: 'replace',
        mapUnits: [9, 3, -3].map((x, index) => ({
            id: `arcade_convoy_tank_${index + 1}`, kind: 'tank',
            // The authored deck runs along X, with its top at Y=7.2 and width 3.6.
            path: [[x, 7.2, 0], [-9, 7.2, 0]],
            loop: false, stopAtEnd: true, speed: [0.46, 0.285, 0.133][index],
            modelScale: 0.45, hitboxRadius: 1.575,
            drive: { steering: false, obstacleStop: false, chase: false },
            maxHp: 170, respawnSeconds: 0, targetPlayers: 'humans', allowedModes: ['ARCADE'],
        })),
        objective: { id: 'intercept', label: 'Alle Panzer stoppen', unitKind: 'tank', count: 3, durationSec: 0, scoreWeight: 1.5 },
    },
    {
        id: 'vault_breaker',
        label: 'Tresorknacker',
        briefing: 'Schieße zuerst ein Turmbein weg. Das Portal zum Tresor öffnet sich danach; besiege den Boss darin.',
        slot: 'sector', mapKey: 'eiffel_tower_siege', combatProfile: 'hunt', botCount: 0,
        minSector: 3, maxSector: 6,
        objective: { id: 'breach_vault', label: 'Bein brechen · Boss besiegen', unitKind: 'boss', count: 1, durationSec: 0, safetyTimeoutSec: 120, scoreWeight: 1.6 },
    },
    {
        id: 'bloom_escape',
        label: 'Ausbruch',
        briefing: 'Halte durch, bis sich die wachsende Blütenarena vollständig geöffnet hat.',
        slot: 'sector', mapKey: 'bloom_core', squadId: 'hunter_pack',
        minSector: 3, maxSector: 6,
        objective: { id: 'survive_window', label: 'Arena vollständig öffnen', durationSec: BLOOM_CORE_FINAL_OPEN_SECONDS, scoreWeight: 1.4 },
    },
    {
        id: 'hydra_finale',
        label: 'Hydra-Tempel',
        briefing: 'Im Tempel wartet die Hydra. Besiege sie, um den Lauf zu gewinnen.',
        slot: 'finale',
        mapKey: 'hydra_temple',
        combatProfile: 'hunt',
        squadId: 'striker_tri',
        objective: { id: 'destroy_units', label: 'Hydra besiegen', unitKind: 'creature', count: 1, durationSec: 0, safetyTimeoutSec: 120, scoreWeight: 1.5 },
        minSector: 3,
    },
    {
        id: 'vault_finale', label: 'Tresor-Finale',
        briefing: 'Brich das Turmbein auf, öffne den Tresor und besiege den Boss.',
        slot: 'finale', mapKey: 'eiffel_tower_siege', combatProfile: 'hunt', botCount: 0,
        objective: { id: 'breach_vault', label: 'Tresor öffnen · Boss besiegen', unitKind: 'boss', count: 1, durationSec: 0, safetyTimeoutSec: 120, scoreWeight: 1.6 },
        minSector: 3,
    },
    {
        id: 'bloom_finale', label: 'Blüten-Finale',
        briefing: 'Halte durch, bis die Blütenarena ganz geöffnet ist.',
        slot: 'finale', mapKey: 'bloom_core', squadId: 'hunter_pack',
        objective: { id: 'survive_window', label: 'Arena vollständig öffnen', durationSec: BLOOM_CORE_FINAL_OPEN_SECONDS, scoreWeight: 1.4 },
        minSector: 3,
    },
];

export function normalizeArcadeScenarioCatalog(rawScenarios = []) {
    const scenarioIds = new Set();
    const normalized = [];
    for (const rawScenario of Array.isArray(rawScenarios) ? rawScenarios : []) {
        const scenario = normalizeArcadeScenario(rawScenario);
        if (!scenario) continue;
        if (scenarioIds.has(scenario.id)) throw new Error(`Duplicate Arcade scenario id: ${scenario.id}`);
        scenarioIds.add(scenario.id);
        normalized.push(scenario);
    }
    return normalized;
}

export const ARCADE_SCENARIOS = Object.freeze(normalizeArcadeScenarioCatalog(RAW_ARCADE_SCENARIOS));

// Scenario sectors sit one before every parcours slot (3, 7, 11 ...), so a default run of five
// sectors reads: two warm-up sectors, a scenario, a parcours, the finale.
const SCENARIO_SECTOR_INTERVAL = 4;
const SCENARIO_SECTOR_OFFSET = 3;
const FINALE_SCENARIO_CHANCE = 0.5;
const PARCOURS_SCENARIO_CHANCE = 0.4;
const MIN_SECTORS_FOR_SCENARIOS = 3;
const LATE_SECTOR_SCENARIO_IDS = new Set(['worm_hunt', 'bomber_alarm', 'bridge_convoy']);

function pick(pool, randomFn) {
    if (pool.length === 0) return null;
    return pool[Math.min(pool.length - 1, Math.floor(randomFn() * pool.length))];
}

/**
 * The scenario a sector plays, or null for a regular sector.
 * `randomFn` must be a stream of its own: drawing from the plan stream would reshuffle every
 * sector after the first scenario.
 */
export function resolveArcadeScenarioForSector({
    sectorNumber, sectorCount, isBoss, isParcours, allowedScenarioIds, excludedScenarioIds, allowLateSectorScenarios = false,
}, randomFn) {
    if (sectorCount < MIN_SECTORS_FOR_SCENARIOS || sectorNumber < MIN_SECTORS_FOR_SCENARIOS) return null;
    const allowedIds = allowedScenarioIds instanceof Set ? allowedScenarioIds : null;
    const excludedIds = excludedScenarioIds instanceof Set ? excludedScenarioIds : null;
    const inRange = (scenario) => sectorNumber >= scenario.minSector
        && (sectorNumber <= scenario.maxSector
            || (allowLateSectorScenarios && LATE_SECTOR_SCENARIO_IDS.has(scenario.id)))
        && (!allowedIds || allowedIds.has(scenario.id));
    const candidates = (slot) => {
        const all = ARCADE_SCENARIOS.filter((scenario) => scenario.slot === slot && inRange(scenario));
        const fresh = excludedIds ? all.filter((scenario) => !excludedIds.has(scenario.id)) : all;
        return fresh.length ? fresh : all;
    };
    if (isParcours) {
        if (randomFn() >= PARCOURS_SCENARIO_CHANCE) return null;
        return pick(candidates('parcours'), randomFn);
    }
    if (isBoss) {
        if (randomFn() >= FINALE_SCENARIO_CHANCE) return null;
        return pick(candidates('finale'), randomFn);
    }
    if (sectorNumber % SCENARIO_SECTOR_INTERVAL !== SCENARIO_SECTOR_OFFSET % SCENARIO_SECTOR_INTERVAL) return null;
    return pick(candidates('sector'), randomFn);
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
        ...(scenario.preserveObjective ? {} : {
            objectiveId: scenario.objective.id,
            objective: scenario.objective,
        }),
        mapUnits: scenario.mapUnits,
        mapUnitsMode: scenario.mapUnitsMode,
        modifierId: null,
        scoreBonus: 0,
    };
}

export default {
    ARCADE_SCENARIOS,
    normalizeArcadeScenarioCatalog,
    applyArcadeScenarioToSectorEntry,
    resolveArcadeScenarioForSector,
};
