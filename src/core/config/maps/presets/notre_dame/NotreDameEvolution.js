import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';
import { NOTRE_DAME_MAPS } from './index.js';
import { NOTRE_DAME_FIRE_MAPS } from '../notre_dame_fire/index.js';
import { NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS } from '../notre_dame_fire/NotreDameFireModels.js';
import { NOTRE_DAME_SITE_FRAME_MODEL_ID_BY_FRAME_ID } from './NotreDameSiteFrames.js';
import { NOTRE_DAME_EVOLUTION_MODELS } from './NotreDameEvolutionModels.js';

const DAY = normalizeMapLighting({
    key: { direction: [-60, 85, 25], color: 0xfff4dc, intensity: 1.25 },
    fill: { direction: [30, 25, -20], color: 0x98c9ff, intensity: 0.4 },
    rim: { direction: [-35, 18, -45], color: 0xc8e7ff, intensity: 0.3 },
    hemisphere: { skyColor: 0xb5d8ff, groundColor: 0x74694f },
    fog: { color: 0xb5d8ee, colorHigh: 0x9ec9ec, colorLow: 0xc4d9df, skyBlend: 0.65,
        near: 160, far: 240, height: 7.3, heightFalloff: 0.012, turbulence: 0.05 },
    skyDome: { zenithColor: 0x2586df, horizonColor: 0xb8ddff, nadirColor: 0x839aaf },
    starsVisible: false, exposureOffset: 0.12,
});
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
        hideModelIds: index === 0 ? [hidden[index], ...NOTRE_DAME_FIRE_REMOVED_SITE_MODEL_IDS] : [hidden[index]],
    })),
};

function evolve(intact, burnt, arena) {
    const profile = {
        segments: fireSegments,
        lighting: { ...burnt.lighting, fog: { ...burnt.lighting.fog, colorLow: 0x62352b },
            skyDome: { ...burnt.lighting.skyDome, nadirColor: 0x62352b } },
        siteFrameIds: [...NOTRE_DAME_SITE_FRAME_MODEL_ID_BY_FRAME_ID.keys()],
    };
    return {
        ...intact,
        lighting: DAY,
        lights: burnt.lights,
        fireFx: burnt.fireFx,
        fireAudioProfile: burnt.audioProfile,
        fireProgression: profile,
        destructibles,
        mapHazards: burnt.mapHazards,
        glbModels: [...intact.glbModels, ...NOTRE_DAME_EVOLUTION_MODELS],
        ...(arena ? {} : { parcours: { ...intact.parcours, routeId: 'notre_dame_evolution_v1',
            checkpoints: intact.parcours.checkpoints.map((cp) => cp.id === 'CP02' ? { ...cp, pos: [-165, 24, 0] } : cp) } }),
    };
}
const parcours = evolve(NOTRE_DAME_MAPS.notre_dame, NOTRE_DAME_FIRE_MAPS.notre_dame_fire, false);
const arena = evolve(NOTRE_DAME_MAPS.notre_dame_arena, NOTRE_DAME_FIRE_MAPS.notre_dame_fire_arena, true);
export const NOTRE_DAME_EVOLUTION_MAPS = {
    notre_dame: parcours, notre_dame_arena: arena,
    notre_dame_fire: { ...parcours, hiddenFromMapPicker: true },
    notre_dame_fire_arena: { ...arena, hiddenFromMapPicker: true },
};
