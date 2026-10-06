import { NOTRE_DAME_MAPS } from './index.js';
import { NOTRE_DAME_FIRE_MAPS } from '../notre_dame_fire/index.js';
import { NOTRE_DAME_EVOLUTION_MODELS } from './NotreDameEvolutionModels.js';

const specs = [
    ['roof', 'Dach und Spitze', 120, 15, ['roof_fleche'], [6, 90, 0], []],
    ['nave', 'Langhaus', 210, 60, ['nave'], [-35, 60, 0], ['roof']],
    ['transept', 'Querschiff', 300, 90, ['transept'], [17, 60, 0], ['nave']],
    ['north', 'Nordturm', 420, 300, ['west_facade'], [-83, 93, -20], ['transept']],
    ['south', 'Südturm', 510, 360, ['evolution_south'], [-83, 93, 20], ['north']],
    ['crown', 'Obere Westfassade', 600, 420, ['evolution_crown'], [-83, 73, 0], ['south']],
];
const fireSegments = specs.map(([id, label, breakAt, ignition, meshPrefixes, anchor, requires], index) => ({
    id, label, hp: 700, kind: 'masonry', piece: id, meshPrefixes, anchor,
    breakAt, ignition, duration: 2000, requires, phase: index < 3 ? 'fire' : 'ruin',
    neighbours: index ? [specs[index - 1][0]] : [],
}));
const hidden = ['notre-dame-roof-fleche', 'notre-dame-nave', 'notre-dame-transept',
    'notre-dame-west-facade', 'notre-dame-evolution-north', 'notre-dame-evolution-south'];
const destructibles = {
    segments: fireSegments, pieces: specs.map(([id]) => id),
    breakScenes: specs.map(([id], index) => ({
        id: `nd_${id}`, trigger: { segmentId: id }, pieces: [id],
        modelId: `notre-dame-evolution-${id}`, yawFromEvent: false,
        hideModelIds: [hidden[index]],
    })),
};

// The map may hold eight point lights, so the six nave lamps and the fire lights share slots: each
// fire light is the same slot as the intact lamp named here, and the two fire lights without a lamp
// start dark. fireFx.dayLights is the intact look; the light entry itself is the full-fire look.
const DAY_LAMP_OF_FIRE_LIGHT = {
    ndf_west_front: 'nd_west_front', ndf_apse: 'nd_apse', ndf_attic_west: 'nd_nave_west',
    ndf_attic_east: 'nd_choir', ndf_crossing_breach: 'nd_crossing', ndf_aisle_breach: 'nd_nave_mid',
};
function dayLights(intact, burnt) {
    return burnt.lights.map((fire) => {
        const lamp = intact.lights.find((entry) => entry.id === DAY_LAMP_OF_FIRE_LIGHT[fire.id]);
        const { x, y, z, color, intensity, distance } = lamp || { ...fire, intensity: 0 };
        return { lightId: fire.id, x, y, z, color, intensity, distance };
    });
}

function evolve(intact, burnt, arena) {
    const profile = {
        segments: fireSegments,
        lighting: { ...burnt.lighting, fog: { ...burnt.lighting.fog, colorLow: 0x62352b },
            skyDome: { ...burnt.lighting.skyDome, nadirColor: 0x62352b } },
    };
    return {
        ...intact,
        lights: burnt.lights,
        fireFx: { ...burnt.fireFx, dayLights: dayLights(intact, burnt) },
        fireAudioProfile: burnt.audioProfile,
        fireProgression: profile,
        destructibles,
        mapHazards: burnt.mapHazards,
        glbModels: [...intact.glbModels, ...NOTRE_DAME_EVOLUTION_MODELS],
        ...(arena ? {} : { parcours: { ...intact.parcours, routeId: 'notre_dame_evolution_v1' } }),
    };
}
const parcours = evolve(NOTRE_DAME_MAPS.notre_dame, NOTRE_DAME_FIRE_MAPS.notre_dame_fire, false);
const arena = evolve(NOTRE_DAME_MAPS.notre_dame_arena, NOTRE_DAME_FIRE_MAPS.notre_dame_fire_arena, true);
export const NOTRE_DAME_EVOLUTION_MAPS = {
    notre_dame: parcours, notre_dame_arena: arena,
    notre_dame_fire: { ...parcours, hiddenFromMapPicker: true },
    notre_dame_fire_arena: { ...arena, hiddenFromMapPicker: true },
};
