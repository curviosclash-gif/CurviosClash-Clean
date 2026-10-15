// One table for everything the map pickers show about a catalog map. Order inside a collection is
// the picker order. Players count humans and bots together; the ranges are rough guidance, not
// limits. It sits in src/shared (not next to the presets) so the menu (ui) and the Arcade map
// change (core) can read it without importing each other's layer.
import {
    MAP_PICKER_FALLBACK_COLLECTION,
    normalizeMapPickerMeta,
} from '../contracts/MapPickerMetaContract.js';

const SMALL = { min: 2, recommended: 4, max: 6 };
const MID = { min: 2, recommended: 6, max: 10 };
const LARGE = { min: 2, recommended: 8, max: 16 };
const RACE = { min: 1, recommended: 4, max: 8 };

const entry = (collection, difficulty, players, tags, description, tier = 'public') =>
    Object.freeze(normalizeMapPickerMeta({ collection, tier, difficulty, players, tags, description }));

const RAW_META = {
    // Arenen
    standard: entry('arena', 1, SMALL, [], 'Die Standardarena: kleine Fläche mit wenigen Hindernissen und einem Portal.'),
    empty: entry('arena', 1, SMALL, [], 'Leere Box ohne Hindernisse, nur für Tests und Messungen.', 'dev'),
    maze: entry('arena', 2, SMALL, [], 'Labyrinth aus Wänden auf einer Ebene, mit zwei Portalen als Abkürzung.'),
    complex: entry('arena', 2, MID, [], 'Etwas größere Arena mit elf Hindernissen und zwei Portalen.'),
    pyramid: entry('arena', 3, LARGE, [], 'Krone des Sonnengottes: riesige, 160 Einheiten hohe Pyramide mit acht Item-Ankern und einem Portal.'),
    vertical_maze: entry('arena', 3, MID, [], 'Labyrinth über mehrere Ebenen, in dem man auch nach oben und unten ausweichen muss.'),
    trench: entry('arena', 2, SMALL, [], 'Langer, schmaler Graben (60 breit, 160 lang) für Duelle in Flugrichtung.'),
    notre_dame_arena: entry('arena', 3, LARGE, ['destructible', 'huge'], 'Notre-Dame als Kampfarena; einzelne Bauteile der Kathedrale lassen sich zerstören.'),
    notre_dame_fire_arena: entry('arena', 3, LARGE, ['destructible', 'huge'], 'Alte Notre-Dame-Arena mit Brandvariante; wird auf die neue Notre-Dame-Arena umgeleitet.'),
    eiffel_tower_arena: entry('arena', 3, LARGE, [], 'Der Eiffelturm als Kampfarena mit Gittertürmen, Toren und vier Flugzeugen.'),
    eiffel_tower_siege: entry('arena', 4, LARGE, ['destructible', 'secretRoom', 'boss'], 'Belagerung: der Turm lässt sich in HUNT zerschießen; im Arcade-Szenario wartet im Tresor ein Boss.'),
    reactor_site: entry('arena', 4, LARGE, ['destructible', 'secretRoom'], 'Sperrzone mit einem Kraftwerk, das in HUNT gesprengt werden kann, und einem Geheimraum.'),
    burg_falkenwacht_arena: entry('arena', 3, LARGE, ['huge'], 'Burg Falkenwacht als Arena: Mauern, Türme und Höfe auf 460 mal 360 Einheiten.'),
    hydra_temple: entry('arena', 3, SMALL, ['boss'], 'Runder Tempel, in dem eine Hydra auftritt; die Hydra erscheint nur in HUNT.'),
    toybox_titan: entry('arena', 3, SMALL, [], 'Riesiges Kinderzimmer, in dem man zwischen Spielzeug kämpft; Szenario für HUNT.'),
    bloom_core: entry('arena', 3, MID, [], 'Blütenkern: eine Arena, die sich während der Runde wie eine Blüte öffnet.'),

    // Themenwelten
    foam_forest: entry('themed', 2, MID, [], 'Schaumwald: 100 mal 100 Einheiten mit neun Hindernissen, ohne Portale.'),
    crossfire: entry('themed', 2, MID, [], 'Kreuzfeuer: weite Fläche mit nur zwei Hindernissen und zwei Portalen, viel Sichtlinie.'),
    checkerboard: entry('themed', 2, MID, [], 'Schachbrett: 100 mal 100 Einheiten mit vier Hindernissen, ohne Portale.'),
    the_pit: entry('themed', 1, MID, [], 'Die Arena: 120 mal 120 Einheiten mit nur einem Hindernis und zwei Portalen.'),
    core_fusion: entry('themed', 2, MID, [], 'Kern-Fusion: ein einzelnes großes Hindernis und zwei Portale auf 100 mal 100 Einheiten.'),
    pillar_hall: entry('themed', 2, MID, [], 'Säulen-Halle: neun Säulen und Wände geben Deckung, aber keine Portale.'),
    spiral_tower: entry('themed', 2, SMALL, [], 'Spiralen-Turm: 80 mal 80 Einheiten, aber 70 Einheiten hoch, mit einem Portal.'),
    portal_madness: entry('themed', 3, MID, [], 'Portal-Wahnsinn: sechs Portale verbinden die 100 mal 100 Einheiten große Fläche.'),
    the_loop: entry('themed', 2, MID, [], 'Die Schleife: 120 mal 120 Einheiten mit fünf Hindernissen, ohne Portale.'),

    // Abenteuer
    rift_bazaar: entry('adventure', 3, MID, [], 'Rift-Bazaar: 150 mal 150 Einheiten mit 23 Hindernissen, 20 Modellen und fünf Toren.'),
    neon_abyss: entry('adventure', 3, MID, [], 'Neon Abyss: 55 Hindernisse, acht Portale, sechs Tore und vier Flugzeuge.'),
    crystal_ruins: entry('adventure', 3, MID, [], 'Crystal Ruins: Ruinenfeld mit Kristallen, sechs Portalen und sechs Toren.'),
    vulkan_odyssey: entry('adventure', 3, RACE, ['parcours'], 'Vulkan Odyssey: langer Parcours mit 13 Checkpoints durch eine 380 Einheiten breite Vulkanlandschaft.'),
    frozen_helix: entry('adventure', 3, RACE, ['parcours'], 'Frozen Helix: Parcours mit 11 Checkpoints in einer 110 Einheiten hohen Anlage.'),
    neon_circuit: entry('adventure', 3, RACE, ['parcours'], 'Neon Circuit: Rennstrecke mit 10 Checkpoints, Tunneln und Tubes.'),
    sky_islands: entry('adventure', 3, RACE, ['parcours'], 'Sky Islands: Parcours mit 8 Checkpoints über schwebende Inseln.'),
    abyssal_descent: entry('adventure', 4, RACE, ['parcours'], 'Abyssal Descent: Parcours mit 11 Checkpoints, 200 Einheiten tief in einem schmalen Schacht.'),
    magma_maze: entry('adventure', 4, RACE, ['parcours'], 'Magma Maze: Parcours mit 11 Checkpoints durch ein Labyrinth mit Tunneln.'),
    chrono_forge_nexus: entry('adventure', 4, RACE, ['parcours'], 'Chrono-Forge Nexus: Parcours mit 16 Checkpoints und sieben Toren in einer großen Schmiede.'),
    eclipse_foundry: entry('adventure', 4, RACE, ['parcours', 'huge'], 'Eclipse Foundry: große Gießerei mit 19 Checkpoints und neun Toren.'),
    kinetic_tide: entry('adventure', 4, RACE, ['parcours', 'huge'], 'Kinetic Tide: 460 Einheiten breiter Parcours mit 19 Checkpoints und beweglichen Teilen.'),
    verdant_aperture: entry('adventure', 3, MID, [], 'Verdant Aperture: 300 mal 300 Einheiten mit 232 Hindernissen, 48 Modellen und Szenario für HUNT.'),
    dandelion_sky: entry('adventure', 3, LARGE, ['secretRoom', 'huge'], 'Pusteblumen-Himmel: riesige Blume; die Wurzelkammer öffnet sich, wenn alle Samen gelöst sind (nicht in Classic).'),
    sunflower_meadow: entry('adventure', 3, LARGE, ['secretRoom', 'huge'], 'Sonnenblumen-Wiese: riesige Blumenwiese mit Geheimraum (nicht in Classic).'),
    aetherion_orrery: entry('adventure', 4, RACE, ['parcours'], 'Aetherion Orrery: Parcours mit 15 Checkpoints durch ein kreisendes Planetarium.'),
    giant_forest: entry('adventure', 3, LARGE, ['huge'], 'Riesenwald: mit 640 mal 640 Einheiten die größte Karte, nicht in Classic.'),
    notre_dame: entry('adventure', 4, RACE, ['destructible', 'parcours', 'huge'], 'Notre-Dame: Parcours mit 20 Checkpoints durch die Kathedrale; Bauteile lassen sich zerstören.'),
    notre_dame_fire: entry('adventure', 4, RACE, ['destructible', 'parcours', 'huge'], 'Alte Notre-Dame-Brandvariante; wird auf die neue Notre-Dame-Karte umgeleitet.'),
    eiffel_tower: entry('adventure', 4, RACE, ['parcours'], 'Eiffelturm: Parcours mit 16 Checkpoints um und durch das Stahlgerüst.'),
    orbital_shipyard: entry('adventure', 4, RACE, ['parcours'], 'Orbitalwerft: Parcours mit 19 Checkpoints durch ein Kapitalschiff im Trockendock.'),
    cloud_harbor: entry('adventure', 4, RACE, ['parcours'], 'Wolkenhafen: Parcours mit 19 Checkpoints durch eine Himmelsstadt mit Zeppelinen, Windmühlen und Seilbahn.'),
    burg_falkenwacht: entry('adventure', 4, RACE, ['parcours', 'huge'], 'Burg Falkenwacht: Parcours mit 20 Checkpoints durch Tore, Höfe und Türme.'),
    clockwork_canyon: entry('adventure', 3, MID, [], 'Clockwork Canyon: Schlucht mit Zahnrädern, vier Portalen und sechs Toren.'),
    storm_bridge_siege: entry('adventure', 3, SMALL, ['destructible', 'secretRoom'], 'Sturmbrücke: eine Brücke, die in HUNT zerstört werden kann, mit Geheimraum.'),
    storm_lighthouse_siege: entry('adventure', 3, MID, ['destructible', 'secretRoom'], 'Sturmleuchtturm: ein Leuchtturm, der in HUNT einstürzt, mit Geheimraum.'),
    storm_dam_siege: entry('adventure', 3, SMALL, ['destructible', 'secretRoom'], 'Sturmdamm: ein Staudamm, der in HUNT bricht, mit Geheimraum.'),
    skyline_siege: entry('adventure', 3, MID, ['destructible'], 'Skyline Belagerung: ein Hochhaus aus drei Segmenten, das in HUNT zerstört werden kann.'),
    cherry_grove: entry('adventure', 2, MID, [], 'Kirschhain: 210 mal 210 Einheiten mit 20 Modellen und zwei Portalen; Szenario für HUNT.'),

    // Parcours
    tutorial_classic: entry('parcours', 1, RACE, ['parcours'], 'Lehrparcours mit 6 Checkpoints für den Einstieg in Classic.'),
    parcours_assault: entry('parcours', 3, RACE, ['parcours'], 'Angriffsparcours mit 9 Checkpoints, in dem man unterwegs mit MG und Raketen schießt.'),
    parcours_rift: entry('parcours', 3, RACE, ['parcours'], 'Parcours Rift: Standardstrecke mit 11 Checkpoints, Tunneln und zwei Portalen.'),
    parcours_rift_sprint: entry('parcours', 2, RACE, ['parcours'], 'Rift Sprint: dieselbe Landschaft, aber nur 5 Checkpoints für einen kurzen Lauf.'),
    parcours_rift_precision: entry('parcours', 4, RACE, ['parcours'], 'Rift Precision: dieselbe Landschaft mit 11 Checkpoints, enge Ringe verlangen genaues Fliegen.'),
    micro_maw: entry('parcours', 1, RACE, ['parcours'], 'Mikro-Maul: kleiner Parcours mit 7 Checkpoints durch einen engen Schlund.'),
    mirror_docks: entry('parcours', 3, RACE, ['parcours'], 'Spiegelwerft: Parcours mit 10 Checkpoints durch gespiegelte Docks und zwei Portale.'),
    glass_serpent: entry('parcours', 3, RACE, ['parcours'], 'Glasschlange: Parcours mit 11 Checkpoints durch lange Tubes.'),
    storm_switchyard: entry('parcours', 3, RACE, ['parcours'], 'Sturmweiche: Parcours mit 11 Checkpoints durch ein Verschiebegleis mit 21 Hindernissen.'),
    wind_cathedral: entry('parcours', 3, RACE, ['parcours'], 'Windkathedrale: 120 Einheiten hoher Parcours mit 11 Checkpoints.'),
    chrono_spillway: entry('parcours', 4, RACE, ['parcours'], 'Chrono-Abfluss: langer Parcours mit 13 Checkpoints und drei Toren.'),
    aether_relay: entry('parcours', 2, RACE, ['parcours'], 'Aether-Relay: Parcours mit 11 Checkpoints und 19 Modellen, ohne Portale.'),
    neon_carnival: entry('parcours', 4, RACE, ['parcours', 'huge'], 'Neon-Jahrmarkt: 480 Einheiten breit, 13 Checkpoints zwischen zehn bewegten Fahrgeschäften.'),
    sky_ladder_abyss: entry('parcours', 4, RACE, ['parcours'], 'Himmelsleiter I: Parcours mit 14 Checkpoints, verbunden durch eine Portalkette.'),
    sky_ladder_foundry: entry('parcours', 4, RACE, ['parcours'], 'Himmelsleiter II: 220 Einheiten hoher Schacht mit 15 Checkpoints.'),
    sky_ladder_storm: entry('parcours', 5, RACE, ['parcours'], 'Himmelsleiter III: Parcours mit 14 Checkpoints und sechs Toren.'),
    sky_ladder_star: entry('parcours', 5, RACE, ['parcours'], 'Himmelsleiter IV: letzte Stufe mit 16 Checkpoints und Tunneln.'),

    // Expertenkarten
    expert_gauntlet: entry('expert', 5, LARGE, [], 'Expert Gauntlet: 300 mal 300 Einheiten, 94 Hindernisse, acht Portale; nicht im Kartenmenü gelistet.'),
    mega_maze: entry('expert', 4, MID, [], 'Mega-Labyrinth: dichtes Labyrinth mit 25 Hindernissen und vier Portalen.'),
    mega_maze_xl: entry('expert', 5, LARGE, [], 'Mega-Labyrinth XL: doppelt so groß, 58 Hindernisse und sechs Portale.'),
    die_festung: entry('expert', 5, LARGE, [], 'Die Festung: wie Expert Gauntlet mit 94 Hindernissen und acht Portalen; nicht im Kartenmenü gelistet.'),

    // Showcase & Tests
    glb_hangar: entry('showcase', 1, SMALL, [], 'Testhalle für GLB-Modelle, nur für die Entwicklung.', 'dev'),
    upgrade_showcase: entry('showcase', 1, SMALL, [], 'Zeigt die drei Upgrade-Tore, nur für Tests.', 'dev'),
    item_showcase: entry('showcase', 1, LARGE, [], 'Zeigt alle Items an 31 Ankern, nur für Tests und Aufnahmen.', 'dev'),
    showcase_nexus: entry('showcase', 2, MID, [], 'Mischkarte mit Toren, Portalen, Flugzeugen und Items, nur für Tests.', 'dev'),
    glb_gallery: entry('showcase', 1, SMALL, [], 'Galerie mit allen 120 Modellen, nur für Editor und Entwicklung.', 'dev'),

    // Eigene Karten
    custom: entry('custom', 2, SMALL, [], 'Deine im Editor gespeicherte Karte.'),
};

/** @type {Readonly<Record<string, ReturnType<typeof normalizeMapPickerMeta>>>} */
export const MAP_PICKER_META = Object.freeze(RAW_META);

const FALLBACK_META = Object.freeze(normalizeMapPickerMeta({ collection: MAP_PICKER_FALLBACK_COLLECTION.id }));

/**
 * @param {unknown} mapKey
 * @returns {ReturnType<typeof normalizeMapPickerMeta>}
 */
export function getMapPickerMeta(mapKey) {
    const key = typeof mapKey === 'string' ? mapKey.trim() : '';
    return Object.hasOwn(MAP_PICKER_META, key) ? MAP_PICKER_META[key] : FALLBACK_META;
}
