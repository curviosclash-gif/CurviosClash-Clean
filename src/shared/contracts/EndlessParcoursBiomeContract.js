import { deriveEndlessSeed } from './EndlessParcoursContract.js';

export const ENDLESS_BIOMES = Object.freeze({
    industrial: Object.freeze({ label: 'Industrie', color: 0x51616b, trim: 0xffb33f, glow: 0xe97f22, fog: 0x344854, near: 55, far: 200, particle: 0xd2b68b }),
    crystal: Object.freeze({ label: 'Kristallhöhle', color: 0x394560, trim: 0x9e80ff, glow: 0x8154ea, fog: 0x494460, near: 45, far: 180, particle: 0xc0adff }),
    deepsea: Object.freeze({ label: 'Tiefsee', color: 0x224b59, trim: 0x65dbcf, glow: 0x28b6b4, fog: 0x164851, near: 20, far: 115, particle: 0x8ae4e6 }),
    energy: Object.freeze({ label: 'Energie', color: 0x253c50, trim: 0x59deff, glow: 0x159abf, fog: 0x294d68, near: 50, far: 195, particle: 0x76dfff }),
    ruins: Object.freeze({ label: 'Ruinen', color: 0x6b6856, trim: 0xb9cc87, glow: 0x728958, fog: 0x5b6354, near: 40, far: 165, particle: 0xc8c6a8 }),
});

/** Appearance only: the existing route, difficulty and flooded-volume rules remain authoritative. */
export function resolveEndlessBiome(module, baseSeed, underwater = false) {
    if (underwater) return 'deepsea';
    if (module.area === 'energy') return 'energy';
    if (module.area !== 'canyon') return 'industrial';
    return deriveEndlessSeed(baseSeed, `biome:${module.areaBlock}`) % 2 ? 'crystal' : 'ruins';
}
