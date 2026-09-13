import { createHash } from 'node:crypto';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';

// Authoring uses the same tessellation as the playable fallback, including rotated
// tunnel mouths. Keeping a second approximation in Python would close flight paths.
export function createMapWorldSource(key, catalog = MAP_PRESET_CATALOG) {
    if (key === 'custom' || !Object.hasOwn(catalog, key)) throw new Error(`Unknown built-in map: ${key}`);
    const definition = catalog[key];
    const arena = {};
    const compiler = new ArenaGeometryCompilePipeline(arena);
    compiler.beginBuildStage();
    const meshes = [];
    for (const [index, obstacle] of (definition.obstacles || []).entries()) {
        if (obstacle.renderWithGlb === true) continue;
        compiler.compileObstacleStage({ obstacleDefs: [obstacle], scale: 1 });
        for (const field of ['_pendingObstacleGeos', '_pendingFoamGeos']) {
            for (const geometry of arena[field]) {
                const position = geometry.getAttribute('position');
                meshes.push({
                    id: `obstacle_${index}`, kind: field === '_pendingFoamGeos' ? 'foam' : 'hard',
                    positions: Array.from(position.array),
                    indices: geometry.index ? Array.from(geometry.index.array)
                        : Array.from({ length: position.count }, (_, vertex) => vertex),
                    authored: obstacle,
                });
                geometry.dispose();
            }
            arena[field] = [];
        }
        for (const field of ['_pendingObstacleEdgeGeos', '_pendingFoamEdgeGeos']) {
            for (const geometry of arena[field]) geometry.dispose();
            arena[field] = [];
        }
    }
    return {
        key, seed: createHash('sha256').update(key).digest().readUInt32LE(0),
        geometryDigest: createHash('sha256').update(JSON.stringify({
            size: definition.size, layoutVersion: definition.layoutVersion || 1, meshes,
        })).digest('hex'),
        definition: JSON.parse(JSON.stringify(definition)), meshes,
    };
}
