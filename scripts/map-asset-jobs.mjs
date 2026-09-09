import { parseArgs } from 'node:util';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

export const BLENDER_ASSET_GENERATORS = Object.freeze({
    chrono_forge: 'generate_chrono_forge_blender_assets.py',
    kinetic_tide: 'generate_kinetic_tide_assets.py',
    verdant_aperture: 'generate_verdant_aperture_assets.py',
    aetherion_orrery: 'generate_aetherion_orrery_assets.py',
    notre_dame: 'generate_notre_dame_assets.py',
    notre_dame_fire: 'generate_notre_dame_fire_assets.py',
    eiffel_tower: 'generate_eiffel_tower_assets.py',
    burg_falkenwacht: 'generate_falkenwacht_assets.py',
    standard: 'generate_map_world.py',
    wind_cathedral: 'generate_map_world.py',
    chrono_forge_nexus: 'generate_map_world.py',
});

export function parseMapAssetArgs(args) {
    const { values } = parseArgs({ args, options: {
        map: { type: 'string', multiple: true },
        part: { type: 'string' },
        all: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        blender: { type: 'string' },
        'output-dir': { type: 'string' },
    } });
    if (values.all === !!values.map?.length) throw new Error('Choose --map <key> or --all.');
    if (values.part && values.all) throw new Error('--part requires an explicit --map.');
    return { mapKeys: values.map, all: values.all, part: values.part,
        dryRun: values['dry-run'], blender: values.blender, outputDir: values['output-dir'] };
}

export function resolveMapAssetJobs(options, catalog = MAP_PRESET_CATALOG) {
    const selected = options.all ? Object.keys(catalog).filter((key) => key !== 'custom') : options.mapKeys;
    const jobs = new Map();
    const nativeMaps = [];
    for (const key of [...new Set(selected || [])]) {
        if (key === 'custom' || !Object.hasOwn(catalog, key)) throw new Error(`Unknown built-in map: ${key}`);
        const models = catalog[key].glbModels || [];
        let found = false;
        for (const model of models) {
            const match = /^assets\/maps\/([a-z0-9_]+)\/glb\/([a-z0-9_]+)\.glb$/.exec(model.url || '');
            if (!match) continue;
            const [, pack, part] = match;
            if (!Object.hasOwn(BLENDER_ASSET_GENERATORS, pack)) throw new Error(`Missing generator for ${pack}.`);
            found = true;
            if (options.part && part !== options.part) continue;
            if (!jobs.has(pack)) jobs.set(pack, { pack, script: BLENDER_ASSET_GENERATORS[pack], parts: new Set() });
            jobs.get(pack).parts.add(part);
        }
        if (!found) nativeMaps.push(key);
    }
    if (options.part && jobs.size === 0) throw new Error(`Part ${options.part} is not used by the selected maps.`);
    if (options.part && jobs.has('burg_falkenwacht')) {
        throw new Error('Falkenwacht generates placement and collision together; select the whole map.');
    }
    return {
        selectedMaps: [...new Set(selected || [])], nativeMaps,
        jobs: [...jobs.values()].map((job) => ({
            ...job, parts: [...job.parts].sort(),
            affectedMaps: Object.entries(catalog).filter(([, map]) => (map.glbModels || [])
                .some((model) => model.url?.startsWith(`assets/maps/${job.pack}/glb/`)
                    && (!options.part || model.url.endsWith(`/${options.part}.glb`))))
                .map(([key]) => key),
        })),
    };
}
