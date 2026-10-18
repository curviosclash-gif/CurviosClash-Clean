import { getArcadeJourneyStage, ARCADE_JOURNEY_STAGES } from './ArcadeJourneyContract.js';

export const ARCADE_JOURNEY_MAP_WIDTH = 900;
export const ARCADE_JOURNEY_MAP_HEIGHT = 1170;

const referenceWorlds = [
    Object.freeze({
        id: 'flight_school', label: 'Flugschule', x: 22, y: 132, w: 228, h: 300,
        copy: 'Der Startpunkt der Reise und die erste Abzweigung.',
    }),
    Object.freeze({
        id: 'tower_city', label: 'Stadt der Türme', x: 285, y: 22, w: 435, h: 92,
        copy: 'Ein offener Themenpfad durch die Stadt.',
    }),
    Object.freeze({
        id: 'storm_coast', label: 'Sturmküste', x: 285, y: 128, w: 435, h: 92,
        copy: 'Ein offener Themenpfad entlang der Küste.',
    }),
    Object.freeze({
        id: 'exclusion_zone', label: 'Sperrzone', x: 285, y: 234, w: 435, h: 92,
        copy: 'Ein offener Themenpfad durch die Sperrzone.',
    }),
    Object.freeze({
        id: 'orbit', label: 'Orbit', x: 745, y: 60, w: 130, h: 340,
        copy: 'Der Orbit-Pfad ist noch offen.',
    }),
];
export const ARCADE_JOURNEY_MAP_WORLDS = Object.freeze(referenceWorlds.map((world, index) => Object.freeze({
    ...world, x: index % 2 * 450, y: Math.floor(index / 2) * 390, w: 450, h: 390,
})));

// Empty stageId marks reference content whose dedicated playable stage is not implemented yet.
// Its goal describes the intended stop and labels that content as open rather than startable.
const referenceNodes = [
    Object.freeze({ id: 'first_flight', worldId: 'flight_school', label: 'Erster Flug', goal: 'Durchfliege alle sechs Ringe und den Zielring der Flugschule.', x: 72, y: 196, stageId: 'flight_school', maxPlayers: 1 }),
    Object.freeze({ id: 'gaps_lesson', worldId: 'flight_school', label: 'Lücken', goal: 'Noch offen: Eigene Lückenroute durch Spurlücken der Flugschule.', x: 150, y: 268, stageId: '', maxPlayers: 1 }),
    Object.freeze({ id: 'first_route', worldId: 'flight_school', label: 'Erster Lauf', goal: 'Bringe den Navigationskern durch alle Checkpoints des Rift-Kurses.', x: 214, y: 200, stageId: 'first_run', maxPlayers: 3 }),
    Object.freeze({ id: 'endless_hunt', worldId: 'flight_school', label: 'Endlosjagd', goal: 'Sammle mindestens 5.000 Punkte, bevor dein Lauf endet.', x: 88, y: 350, stageId: 'endless_hunt', optional: true, maxPlayers: 3 }),

    Object.freeze({ id: 'notre_dame', worldId: 'tower_city', label: 'Notre-Dame', goal: 'Den vollständigen Kurs durch Notre-Dame mit seinen Abzweigungen bis zum Ziel durchfliegen.', x: 330, y: 78, stageId: 'notre_dame', maxPlayers: 3 }),
    Object.freeze({ id: 'brandnacht', worldId: 'tower_city', label: 'Brandnacht', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 66, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'five_fronts', worldId: 'tower_city', label: 'Fünf Fronten', goal: 'Kämpfe in allen fünf Arenen und sammle mindestens 5.000 Punkte.', x: 560, y: 80, stageId: 'five_fronts', maxPlayers: 3 }),
    Object.freeze({ id: 'eiffel_siege', worldId: 'tower_city', label: 'Eiffel-Belagerung', goal: 'Noch offen: Den Turm auf Zeit fällen.', x: 675, y: 66, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'bridge_convoy', worldId: 'storm_coast', label: 'Sturmbrücken-Konvoi', goal: 'Stoppe alle drei Panzer, bevor einer den Brückenausgang erreicht.', x: 330, y: 182, stageId: 'bridge_convoy', maxPlayers: 3 }),
    Object.freeze({ id: 'storm_dam', worldId: 'storm_coast', label: 'Staudamm', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 172, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'lighthouse', worldId: 'storm_coast', label: 'Leuchtturm', goal: 'Noch offen: Das Abschussziel erreichen.', x: 560, y: 186, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'storm_flood', worldId: 'storm_coast', label: 'Sturmflut', goal: 'Noch offen: Vor der Flut entkommen.', x: 675, y: 172, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'reactor', worldId: 'exclusion_zone', label: 'Reaktor', goal: 'Noch offen: Sektoren durch die Sperrzone.', x: 330, y: 288, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'clockwork', worldId: 'exclusion_zone', label: 'Uhrwerk-Schlucht', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 278, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'worm_hunt', worldId: 'exclusion_zone', label: 'Wurmjagd', goal: 'Den Riesenwurm innerhalb von zwei Minuten zerstören.', x: 560, y: 292, stageId: 'worm_hunt', boss: true, maxPlayers: 3 }),
    Object.freeze({ id: 'weapon_mastery', worldId: 'exclusion_zone', label: 'Waffenmeisterschaft', goal: 'Noch offen: Mit jeder Waffe einen Abschuss erzielen.', x: 675, y: 278, stageId: '', optional: true, maxPlayers: 1 }),

    Object.freeze({ id: 'giant_forest', worldId: 'giant_forest', label: 'Riesenwald', goal: 'Noch offen: Sektoren zwischen Riesenbäumen.', x: 330, y: 394, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'dandelion', worldId: 'giant_forest', label: 'Pusteblume', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 384, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'sunflower', worldId: 'giant_forest', label: 'Sonnenwiese', goal: 'Noch offen: Das Abschussziel erreichen.', x: 560, y: 398, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'hydra', worldId: 'giant_forest', label: 'Hydra', goal: 'Noch offen: Alle Köpfe der Hydra besiegen.', x: 675, y: 384, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'orbital_shipyard', worldId: 'orbit', label: 'Orbitalwerft', goal: 'Die gesamte Orbitalwerft unter Beschuss von Bots, Raketenwerfern und MG-Geschützen durchqueren.', x: 810, y: 170, stageId: 'orbital_shipyard', maxPlayers: 3 }),
    Object.freeze({ id: 'sky_ladder', worldId: 'orbit', label: 'Himmelsleiter', goal: 'Reise durch alle vier Höhenstufen bis zum letzten Portal.', x: 810, y: 300, stageId: 'sky_ladder', maxPlayers: 3 }),
];

const freeActions = { endless_hunt: 'endless', five_fronts: 'fiveFronts', five_portals: 'fivePortals', sky_ladder: 'skyLadder', weapon_race: 'weaponRace', demolition: 'demolition', portal_chain_k19: 'k19PortalChain' };
const additionalNodes = [
    { id: 'weapon_race', stageId: 'weapon_race', worldId: 'flight_school', label: 'Waffenrennen', maxPlayers: 1, x: 170, y: 350 },
    { id: 'five_portals', stageId: 'five_portals', worldId: 'flight_school', label: 'Fünf Portale', portalChainId: 'five_portals', maxPlayers: 3, x: 210, y: 400 },
    { id: 'demolition', stageId: 'demolition', worldId: 'tower_city', label: 'Abrisskommando', maxPlayers: 3, x: 615, y: 100 },
    { id: 'portal_chain_k19', stageId: '', worldId: 'orbit', label: 'Portalreise', portalChainId: 'portal_chain_k19', goal: 'Fünf ungewöhnliche Parcours, verbunden durch ihre Ausgangsportale. Freie Tour ohne Reisesternwertung.', maxPlayers: 3, x: 810, y: 380 },
];
export const ARCADE_JOURNEY_MAP_NODES = Object.freeze([...referenceNodes, ...additionalNodes].filter(node => node.stageId || freeActions[node.id]).map(node => {
    const stage = getArcadeJourneyStage(node.stageId);
    const portalChainId = ('portalChainId' in node && node.portalChainId) || stage?.portalChainId || '';
    const worldIndex = ARCADE_JOURNEY_MAP_WORLDS.findIndex(world => world.id === node.worldId);
    const memberIndex = [...referenceNodes, ...additionalNodes].filter(member => member.worldId === node.worldId).indexOf(node);
    return Object.freeze({ ...node, goal: stage?.goal || node.goal, portalChainId,
        x: worldIndex % 2 * 450 + ((memberIndex % 3 + .5) / 3) * 450,
        y: Math.floor(worldIndex / 2) * 390 + 125 + Math.floor(memberIndex / 3) * 145,
        development: !stage && !freeActions[node.id], freeAction: freeActions[node.id] || '',
        kind: portalChainId ? 'tour' : 'boss' in node && node.boss ? 'boss' : ['five_fronts', 'endless_hunt', 'demolition', 'weapon_race'].includes(node.id) ? 'combat' : 'stage' });
}));

export const ARCADE_JOURNEY_MAP_PLANNED_LINKS = Object.freeze([]);

// Only the access contract defines effective Bronze dependencies. Decorative future roads
// never substitute for these edges or for the separate total-star thresholds.
export const ARCADE_JOURNEY_MAP_LINKS = Object.freeze([
    ...ARCADE_JOURNEY_STAGES.filter(stage => stage.predecessorId).map(stage => Object.freeze([
        ARCADE_JOURNEY_MAP_NODES.find(node => node.stageId === stage.predecessorId).id,
        ARCADE_JOURNEY_MAP_NODES.find(node => node.stageId === stage.id).id,
    ])), ...ARCADE_JOURNEY_MAP_PLANNED_LINKS,
]);

const EXPECTED_RUNTIME_STAGE_IDS = new Set([
    'flight_school',
    'first_run',
    'notre_dame',
    'bridge_convoy',
    'orbital_shipyard',
    'endless_hunt',
    'five_fronts',
    'sky_ladder',
    'worm_hunt',
    'weapon_race',
    'five_portals',
    'demolition',
]);

for (const node of ARCADE_JOURNEY_MAP_NODES) {
    if (!node.stageId) continue;
    if (!EXPECTED_RUNTIME_STAGE_IDS.has(node.stageId) || !getArcadeJourneyStage(node.stageId)) {
        throw new Error('Arcade journey map node "' + node.id + '" references an unsupported runtime stage.');
    }
}
