import { getArcadeJourneyStage } from './ArcadeJourneyContract.js';

export const ARCADE_JOURNEY_MAP_WIDTH = 900;
export const ARCADE_JOURNEY_MAP_HEIGHT = 470;

export const ARCADE_JOURNEY_MAP_WORLDS = Object.freeze([
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
        id: 'giant_forest', label: 'Riesenwald', x: 285, y: 340, w: 435, h: 92,
        copy: 'Ein offener Themenpfad zwischen den Riesenbäumen.',
    }),
    Object.freeze({
        id: 'orbit', label: 'Orbit', x: 745, y: 60, w: 130, h: 340,
        copy: 'Der Orbit-Pfad ist noch offen.',
    }),
]);

// Empty stageId marks reference content whose dedicated playable stage is not implemented yet.
// Its goal describes the intended stop and labels that content as open rather than startable.
export const ARCADE_JOURNEY_MAP_NODES = Object.freeze([
    Object.freeze({ id: 'first_flight', worldId: 'flight_school', label: 'Erster Flug', goal: 'Durchfliege alle sechs Ringe und den Zielring der Flugschule.', x: 72, y: 196, stageId: 'flight_school', maxPlayers: 1 }),
    Object.freeze({ id: 'gaps_lesson', worldId: 'flight_school', label: 'Lücken', goal: 'Noch offen: Eigene Lückenroute durch Spurlücken der Flugschule.', x: 150, y: 268, stageId: '', maxPlayers: 1 }),
    Object.freeze({ id: 'first_route', worldId: 'flight_school', label: 'Erster Lauf', goal: 'Meistere alle Pflichtsektoren. Danach kannst du freiwillig weiterfliegen.', x: 214, y: 200, stageId: 'first_run', maxPlayers: 3 }),
    Object.freeze({ id: 'endless_hunt', worldId: 'flight_school', label: 'Endlosjagd', goal: 'Sammle mindestens 5.000 Punkte, bevor dein Lauf endet.', x: 88, y: 350, stageId: 'endless_hunt', optional: true, maxPlayers: 3 }),

    Object.freeze({ id: 'notre_dame', worldId: 'tower_city', label: 'Notre-Dame', goal: 'Noch offen: Sektoren durch das Kirchenschiff.', x: 330, y: 78, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'brandnacht', worldId: 'tower_city', label: 'Brandnacht', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 66, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'five_fronts', worldId: 'tower_city', label: 'Fünf Fronten', goal: 'Kämpfe in allen fünf Arenen und sammle mindestens 5.000 Punkte.', x: 560, y: 80, stageId: 'five_fronts', maxPlayers: 3 }),
    Object.freeze({ id: 'eiffel_siege', worldId: 'tower_city', label: 'Eiffel-Belagerung', goal: 'Noch offen: Den Turm auf Zeit fällen.', x: 675, y: 66, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'storm_bridge', worldId: 'storm_coast', label: 'Sturmbrücke', goal: 'Noch offen: Sektoren über die Brücke.', x: 330, y: 182, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'storm_dam', worldId: 'storm_coast', label: 'Staudamm', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 172, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'lighthouse', worldId: 'storm_coast', label: 'Leuchtturm', goal: 'Noch offen: Das Abschussziel erreichen.', x: 560, y: 186, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'storm_flood', worldId: 'storm_coast', label: 'Sturmflut', goal: 'Noch offen: Vor der Flut entkommen.', x: 675, y: 172, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'reactor', worldId: 'exclusion_zone', label: 'Reaktor', goal: 'Noch offen: Sektoren durch die Sperrzone.', x: 330, y: 288, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'clockwork', worldId: 'exclusion_zone', label: 'Uhrwerk-Schlucht', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 278, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'worm_hunt', worldId: 'exclusion_zone', label: 'Wurmjagd', goal: 'Den Riesenwurm innerhalb von zwei Minuten zerstören.', x: 560, y: 292, stageId: 'worm_hunt', boss: true, maxPlayers: 3 }),
    Object.freeze({ id: 'weapon_mastery', worldId: 'exclusion_zone', label: 'Waffenrennen', goal: 'Noch offen: Mit jeder Waffe einen Abschuss erzielen.', x: 675, y: 278, stageId: '', optional: true, maxPlayers: 1 }),

    Object.freeze({ id: 'giant_forest', worldId: 'giant_forest', label: 'Riesenwald', goal: 'Noch offen: Sektoren zwischen Riesenbäumen.', x: 330, y: 394, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'dandelion', worldId: 'giant_forest', label: 'Pusteblume', goal: 'Noch offen: Spuren ausweichen, Letzter gewinnt (ohne Waffen).', x: 445, y: 384, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'sunflower', worldId: 'giant_forest', label: 'Sonnenwiese', goal: 'Noch offen: Das Abschussziel erreichen.', x: 560, y: 398, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'hydra', worldId: 'giant_forest', label: 'Hydra', goal: 'Noch offen: Alle Köpfe der Hydra besiegen.', x: 675, y: 384, stageId: '', boss: true, maxPlayers: 3 }),

    Object.freeze({ id: 'orbital_shipyard', worldId: 'orbit', label: 'Orbitalwerft', goal: 'Noch offen: Die Orbitalwerft durchqueren.', x: 810, y: 170, stageId: '', maxPlayers: 3 }),
    Object.freeze({ id: 'sky_ladder', worldId: 'orbit', label: 'Himmelsleiter', goal: 'Reise durch alle vier Höhenstufen bis zum letzten Portal.', x: 810, y: 300, stageId: 'sky_ladder', maxPlayers: 3 }),
]);

export const ARCADE_JOURNEY_MAP_LINKS = Object.freeze([
    ['first_flight', 'gaps_lesson'],
    ['gaps_lesson', 'first_route'],
    ['gaps_lesson', 'endless_hunt'],
    ['first_route', 'notre_dame'],
    ['first_route', 'storm_bridge'],
    ['first_route', 'reactor'],
    ['first_route', 'giant_forest'],
    ['notre_dame', 'brandnacht'],
    ['brandnacht', 'five_fronts'],
    ['five_fronts', 'eiffel_siege'],
    ['storm_bridge', 'storm_dam'],
    ['storm_dam', 'lighthouse'],
    ['lighthouse', 'storm_flood'],
    ['reactor', 'clockwork'],
    ['clockwork', 'worm_hunt'],
    ['clockwork', 'weapon_mastery'],
    ['giant_forest', 'dandelion'],
    ['dandelion', 'sunflower'],
    ['sunflower', 'hydra'],
    ['eiffel_siege', 'orbital_shipyard'],
    ['storm_flood', 'orbital_shipyard'],
    ['worm_hunt', 'sky_ladder'],
    ['hydra', 'sky_ladder'],
].map((link) => Object.freeze(link)));

const EXPECTED_RUNTIME_STAGE_IDS = new Set([
    'flight_school',
    'first_run',
    'endless_hunt',
    'five_fronts',
    'sky_ladder',
    'worm_hunt',
]);

for (const node of ARCADE_JOURNEY_MAP_NODES) {
    if (!node.stageId) continue;
    if (!EXPECTED_RUNTIME_STAGE_IDS.has(node.stageId) || !getArcadeJourneyStage(node.stageId)) {
        throw new Error('Arcade journey map node "' + node.id + '" references an unsupported runtime stage.');
    }
}
