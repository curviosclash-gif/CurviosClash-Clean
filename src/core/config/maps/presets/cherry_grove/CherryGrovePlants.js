// Existing editable nature assets, arranged as eighteen deterministic groups. Plants stay
// below the flight lanes; the large cherry trunks alone provide the grove's solid obstacles.
// Retain the grove's original atmospheric range; larger trees do not require a longer
// camera far plane. Culling accounts for their new reach separately.
export const CHERRY_GROVE_FOG_FAR = 330;
const WIND_BEAT_SECONDS = 61 / 30;
const SPECIES = Object.freeze([
    ['Daisy', 4.2], ['Buttercup', 3.2], ['RedClover', 3.8],
    ['Yarrow', 4.4], ['RibwortPlantain', 3.5], ['Cornflower', 4.8],
    ['Poppy', 5.2], ['Chicory', 5.8], ['Lavender', 5.0],
    ['WildStrawberry', 2.8], ['Fern', 6.5], ['FountainGrass', 5.5],
]);

const GROUPS = Object.freeze([
    [-92, -115], [93, -114], [-178, -46], [178, -42], [-100, 40], [100, 42],
    [-155, 105], [154, 109], [-82, 166], [85, 170], [-35, -48], [38, -45],
    [-174, 32], [173, 37], [-23, 129], [25, 130], [-110, -153], [110, -151],
]);

export const CHERRY_GROVE_PLANTS = Object.freeze([
    ...GROUPS.flatMap(([x, z], group) => Array.from({ length: 3 }, (_, member) => {
        const speciesIndex = (group * 5 + member) % SPECIES.length;
        const [name, size] = SPECIES[speciesIndex];
        const targetSize = size * (0.88 + member * 0.12);
        const angle = group * 2.399 + member * 2.094;
        return Object.freeze({
            id: `cherry-plant-${group + 1}-${name.toLowerCase()}-${member + 1}`,
            url: `assets/models/meadow_plants/${name}/glb/${name}.glb`,
            position: [x + Math.cos(angle) * 4, 4, z + Math.sin(angle) * 4],
            rotation: [0, angle, 0], targetSize,
            collision: false, role: 'optionalProp', maxRenderDistance: Math.ceil(CHERRY_GROVE_FOG_FAR / 3 + targetSize * 1.225),
            animationClock: { beatSeconds: WIND_BEAT_SECONDS, phaseOffsetBeats: (group % 5) / 5 },
        });
    })),
    ...Array.from({ length: 6 }, (_, index) => {
        const root = index % 2 === 0;
        const family = root ? 'root' : 'vine';
        const variant = String(index % 3 + 1).padStart(2, '0');
        const [x, z] = GROUPS[index];
        return Object.freeze({
            id: `cherry-${family}-${index + 1}`,
            url: `assets/models/verdant_wildwuchs/${family}_v${variant}.glb`,
            position: [x + 9, 4, z + 7], rotation: [0, index * 1.173, 0],
            targetSize: root ? 9 : 7, collision: false, role: 'optionalProp',
            maxRenderDistance: Math.ceil(CHERRY_GROVE_FOG_FAR / 3 + (root ? 9 : 7) * 1.225),
        });
    }),
]);
