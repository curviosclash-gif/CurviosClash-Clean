import { ORBITAL_JOURNEY_SCENARIO_ID, ORBITAL_JOURNEY_TURRETS } from './OrbitalJourneyDefenseContract.js';
export const ARCADE_JOURNEY_STORAGE_KEY = 'cuviosclash.arcade-journey.v1';
export const ARCADE_JOURNEY_SCHEMA = 'arcade-journey.v1';
export const ARCADE_JOURNEY_MAIN_STAGE_IDS = Object.freeze(['first_run', 'notre_dame', 'bridge_convoy', 'orbital_shipyard', 'sky_ladder']);

// Journey gates apply only to these entries; the free-play map catalogue stays independent.
export const ARCADE_JOURNEY_WORLDS = Object.freeze([
    Object.freeze({ id: 'departure', label: 'Aufbruch', starsRequired: 0, reward: 'Aufbruch-Abzeichen', rewardStageIds: Object.freeze(['flight_school', 'first_run', 'weapon_race']), copy: 'Lerne die Sektoren kennen und wähle deinen eigenen Weg.' }),
    Object.freeze({ id: 'portals', label: 'Hinter den Portalen', starsRequired: 1, reward: 'Portal-Abzeichen', rewardStageIds: Object.freeze(['five_portals', 'sky_ladder']), copy: 'Folge den Ringen bis zum letzten Ausgangsportal.' }),
    Object.freeze({ id: 'frontier', label: 'An den Fronten', starsRequired: 2, reward: 'Fronten-Abzeichen', rewardStageIds: Object.freeze(['five_fronts', 'demolition', 'endless_hunt', 'worm_hunt']), copy: 'Behaupte dich gegen Wellen und durchbrich die Festungen.' }),
]);

const stages = [
    { id: 'flight_school', worldId: 'departure', label: 'Flugschule · Etappe 1', runType: 'classic_tutorial', mapKey: 'tutorial_classic', botCount: 0,
        goal: 'Durchfliege alle sechs Ringe und den Zielring der Flugschule.', metric: 'completion', silver: 1, gold: 1, maxPlayers: 1, optional: true },
    { id: 'first_run', worldId: 'departure', label: 'Erster Lauf', runType: 'gauntlet', mapKey: 'parcours_rift', botCount: 0, sectorCount: 1, parcours: true,
        leaderboardVersion: 3, legacyLeaderboardMetric: 'score', legacyLeaderboardVersions: [1, 2], leaderboardLabel: 'Rift-Einzelkurs',
        goal: 'Durchfliege alle Checkpoints des Rift-Kurses bis zum Ziel. Silber: 120 Sekunden, Gold: 75 Sekunden, inklusive Strafzeit.', metric: 'time', silver: 120000, gold: 75000,
        briefing: ['Das Portalnetz ist zerbrochen und die Regionen sind voneinander abgeschnitten.', 'Bringe den Navigationskern durch den Rift-Kurs zum ersten Relais.'],
        consequence: 'Das erste Relais ist wieder online; der Kern zeigt den Weg nach Notre-Dame.' },
    { id: 'notre_dame', worldId: 'departure', label: 'Notre-Dame', runType: 'gauntlet', mapKey: 'notre_dame', botCount: 0, sectorCount: 1, parcours: true,
        predecessorId: 'first_run', goal: 'Durchfliege den vollständigen Notre-Dame-Kurs mit seinen Abzweigungen bis zum Ziel. Silber: 270 Sekunden, Gold: 180 Sekunden, inklusive Strafzeit.', metric: 'time', silver: 270000, gold: 180000,
        briefing: ['Das Relais von Notre-Dame liegt hinter einem verzweigten Flugkurs.', 'Bringe den Navigationskern durch alle Checkpoints zum Ausgangsportal.'],
        consequence: 'Notre-Dame sendet wieder; die nächste Spur führt zum Konvoi auf der Sturmbrücke.' },
    { id: 'bridge_convoy', worldId: 'frontier', label: 'Sturmbrücken-Konvoi', runType: 'gauntlet', mapKey: 'storm_bridge_siege', botCount: 0, sectorCount: 1,
        scenarioId: 'bridge_convoy', predecessorId: 'notre_dame', goal: 'Stoppe alle drei Panzer des Konvois, bevor einer den Brückenausgang erreicht.', metric: 'time', silver: 150000, gold: 90000,
        briefing: ['Ein feindlicher Konvoi trägt die Verbindung zur Orbitalwerft fort.', 'Stoppe alle drei Panzer auf der Sturmbrücke, bevor einer den Ausgang erreicht.'],
        consequence: 'Der Konvoi ist gestoppt; sein Signal öffnet die Route zur Orbitalwerft.' },
    { id: 'orbital_shipyard', worldId: 'portals', label: 'Orbitalwerft', runType: 'gauntlet', mapKey: 'orbital_shipyard', botCount: 2, sectorCount: 1, parcours: true,
        combatScenarioId: ORBITAL_JOURNEY_SCENARIO_ID, staticTurrets: ORBITAL_JOURNEY_TURRETS, predecessorId: 'bridge_convoy',
        goal: 'Durchfliege die gesamte Orbitalwerft unter Beschuss von zwei Bots, Raketenwerfern und MG-Geschützen. Silber: 150 Sekunden, Gold: 100 Sekunden, inklusive Strafzeit.', metric: 'time', silver: 150000, gold: 100000,
        briefing: ['Der Rivale hält die Orbitalwerft unter Beschuss.', 'Bringe den Kern durch den vollständigen Werftkurs bis zum Ausgangsportal.'],
        consequence: 'Die Werft ist verbunden; das letzte offene Relais liegt auf der Himmelsleiter.' },
    { id: 'weapon_race', worldId: 'departure', label: 'Waffenrennen', runType: 'weapon_race', mapKey: 'parcours_assault', botCount: 4, sectorCount: 1,
        goal: 'Erreiche als Erster das Ziel.', metric: 'place', silver: 1, gold: 1, maxPlayers: 1, optional: true },
    { id: 'five_portals', worldId: 'portals', label: 'Fünf Portale', runType: 'five_portals', portalChainId: 'five_portals', mapKey: 'micro_maw', botCount: 0,
        goal: 'Durchfliege alle fünf Karten und das letzte Ausgangsportal.', metric: 'time', silver: 360000, gold: 240000 },
    { id: 'sky_ladder', worldId: 'portals', label: 'Himmelsleiter', runType: 'five_portals', portalChainId: 'sky_ladder', mapKey: 'sky_ladder_abyss', botCount: 0,
        goal: 'Durchquere alle vier Höhenstufen und erreiche das letzte Ausgangsportal.', predecessorId: 'orbital_shipyard', metric: 'time', silver: 300000, gold: 180000,
        briefing: ['Der Rivale folgt dem Kern zur Himmelsleiter.', 'Durchquere alle vier Höhenstufen und erreiche das letzte Ausgangsportal.'],
        consequence: 'Das letzte Relais ist wieder online; der Navigationskern hat die Himmelsleiter erreicht.' },
    { id: 'five_fronts', worldId: 'frontier', label: 'Fünf Fronten', runType: 'arena_waves', mapKey: 'notre_dame_arena', botCount: 24,
        leaderboardVersion: 2, legacyLeaderboardMetric: 'score', legacyLeaderboardVersions: [1], leaderboardLabel: 'Zwei Wellen je Arena',
        goal: 'Besiege zwei Wellen in jeder der fünf Arenen. Silber: 25.000 Punkte, Gold: 32.000 Punkte.', metric: 'score', bronze: 15000, silver: 25000, gold: 32000, optional: true },
    { id: 'demolition', worldId: 'frontier', label: 'Abrisskommando', runType: 'demolition', mapKey: 'notre_dame_arena', botCount: 0,
        goal: 'Schließe alle drei Belagerungen ab.', predecessorId: 'five_fronts', metric: 'ratio', silver: 0.7, gold: 0.9 },
    { id: 'endless_hunt', worldId: 'frontier', label: 'Endlosjagd', runType: 'endless_parcours', mapKey: 'standard', botCount: 0,
        goal: 'Sammle mindestens 5.000 Punkte, bevor dein Lauf endet.', predecessorId: 'five_fronts', metric: 'score', bronze: 5000, silver: 15000, gold: 30000 },
    { id: 'worm_hunt', worldId: 'frontier', label: 'Wurmjagd', runType: 'gauntlet', mapKey: 'standard', botCount: 2,
        scenarioId: 'worm_hunt', sectorCount: 1, predecessorId: 'first_run',
        goal: 'Erlege alle 100 Würmer innerhalb von zwei Minuten. Silber: 90 Sekunden, Gold: 60 Sekunden.', metric: 'time', silver: 90000, gold: 60000 },
];

export const ARCADE_JOURNEY_STAGES = Object.freeze(stages.map((stage) => Object.freeze({ maxPlayers: 3, leaderboardVersion: 1, ...stage })));
export const getArcadeJourneyStage = (id) => ARCADE_JOURNEY_STAGES.find((stage) => stage.id === id) || null;

export function getArcadeJourneyMaxStars(stageId) {
    const stage = getArcadeJourneyStage(stageId);
    return stage ? stage.metric === 'completion' ? 1 : 3 : 0;
}

/** @param {string} value @param {{runType?: string, portalChainId?: string, dailyChallenge?: boolean}} [context] */
export function normalizeArcadeJourneyStageId(value, context = {}) {
    const { runType, portalChainId, dailyChallenge } = context;
    const stage = getArcadeJourneyStage(value);
    if (!stage || dailyChallenge === true || stage.runType !== runType) return '';
    if (stage.portalChainId && stage.portalChainId !== portalChainId) return '';
    return stage.id;
}

export function getArcadeJourneyStageStars(progress, stageId) {
    if (progress?.schema !== ARCADE_JOURNEY_SCHEMA) return 0;
    return Math.max(0, ...['normal', 'hard', 'nightmare'].map((tier) => {
        const value = progress?.stages?.[stageId]?.medals?.[tier]?.medal;
        return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 0;
    }));
}
export function isArcadeJourneyStageCompleted(progress, stageId) {
    return progress?.schema === ARCADE_JOURNEY_SCHEMA
        && (progress.stages?.[stageId]?.completed === true || getArcadeJourneyStageStars(progress, stageId) > 0);
}
export function isArcadeJourneyMainComplete(progress) {
    return ARCADE_JOURNEY_MAIN_STAGE_IDS.every((id) => isArcadeJourneyStageCompleted(progress, id));
}

export function getArcadeJourneyStars(progress, stageId = '') {
    if (stageId) return getArcadeJourneyStageStars(progress, stageId);
    return ARCADE_JOURNEY_STAGES.reduce((total, stage) => total + getArcadeJourneyStageStars(progress, stage.id), 0);
}

export function resolveArcadeJourneyAccess(stageId, progress, { playerCount = 1, legacyAccess = false } = {}) {
    const stage = getArcadeJourneyStage(stageId);
    if (!stage) return { unlocked: false, reason: 'unknown_stage' };
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > stage.maxPlayers) {
        return { unlocked: false, reason: 'player_count', label: `Für ${stage.maxPlayers === 1 ? 'einen Spieler' : 'bis zu drei Spieler'}` };
    }
    if (legacyAccess || (progress?.schema === ARCADE_JOURNEY_SCHEMA && progress?.allStagesUnlocked === true)) {
        return { unlocked: true, reason: '' };
    }
    if (stage.predecessorId && !isArcadeJourneyStageCompleted(progress, stage.predecessorId)) {
        return { unlocked: false, reason: 'predecessor', label: `„${getArcadeJourneyStage(stage.predecessorId).label}“ abschließen` };
    }
    const world = ARCADE_JOURNEY_WORLDS.find((entry) => entry.id === stage.worldId);
    if (!ARCADE_JOURNEY_MAIN_STAGE_IDS.includes(stage.id) && getArcadeJourneyStars(progress) < world.starsRequired) {
        return { unlocked: false, reason: 'stars', label: `${world.starsRequired} Sterne für diese Welt` };
    }
    return { unlocked: true, reason: '' };
}

export function evaluateArcadeJourneyMedal(stageId, result) {
    const stage = getArcadeJourneyStage(stageId);
    if (!stage || result?.aborted === true) return 0;
    if (stage.metric === 'completion') return result?.succeeded === true && result?.value === 1 ? 1 : 0;
    const value = result?.value;
    if (!Number.isFinite(value) || value < 0) return 0;
    // Endless runs end at defeat; reaching the authored points goal is their completion.
    if (stage.id !== 'endless_hunt' && result?.succeeded !== true) return 0;
    if (stage.metric === 'time') return value > 0 ? (value <= stage.gold ? 3 : value <= stage.silver ? 2 : 1) : 0;
    if (stage.metric === 'place') return value === 1 ? 3 : 0;
    return value >= stage.gold ? 3 : value >= stage.silver ? 2 : value >= (stage.bronze || 0) ? 1 : 0;
}

export function getArcadeJourneyNextStage(stageId, progress, playerCount = 1) {
    const offset = ARCADE_JOURNEY_MAIN_STAGE_IDS.indexOf(stageId);
    return ARCADE_JOURNEY_MAIN_STAGE_IDS.slice(Math.max(0, offset + 1))
        .map(getArcadeJourneyStage)
        .find(stage => !isArcadeJourneyStageCompleted(progress, stage.id)
            && resolveArcadeJourneyAccess(stage.id, progress, { playerCount }).unlocked) || null;
}
