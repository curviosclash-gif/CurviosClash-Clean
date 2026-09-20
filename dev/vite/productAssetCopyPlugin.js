import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OBJ_ASSET_COPY_ENTRIES = [
    ['assets', 'models', 'optimized_cc0'],
    ['assets', 'models', 'giant_dandelion', 'giant_dandelion_shootable.glb'],
    ['assets', 'models', 'giant_dandelion', 'giant_dandelion_lod2.glb'],
    ['assets', 'models', 'ancient_tree', 'variants', 'variant_06', 'ancient_tree_06_lod1.glb'],
    // Two files per variant: the drawn crown, and the coarse collision body the giant forest
    // places invisibly inside it. Shipping the crown alone would leave that map's trees flyable.
    ...Array.from({ length: 10 }, (_, index) => {
        const variant = String(index + 1).padStart(2, '0');
        return ['assets', 'models', 'ancient_tree', 'variants', `variant_${variant}`, `ancient_tree_${variant}_lod2.glb`];
    }),
    ...Array.from({ length: 10 }, (_, index) => {
        const variant = String(index + 1).padStart(2, '0');
        return ['assets', 'models', 'ancient_tree', 'variants', `variant_${variant}`, `ancient_tree_${variant}_collision.glb`];
    }),
    ['assets', 'items'],
    ['assets', 'portals'],
    ['assets', 'trails'],
    ['assets', 'models', 'jets', 'cc0', 'WWIairplane.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_low.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_high.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_control.obj'],
    ['assets', 'models', 'jets', 'cc0', 'pinnace_lo.obj'],
    ['assets', 'models', 'jets', 'cc0', 'spaceship_pack', 'dist', 'obj_mtl'],
];
const GLB_GALLERY_ASSET_SOURCE_DIR = path.resolve(__dirname, 'assets', 'models', 'downloaded_cc0');
const GLB_GALLERY_ASSET_OUTPUT_SEGMENTS = ['assets', 'models', 'downloaded_cc0'];
// Model packs that keep their editable Blender sources, previews and manifests next to their
// runtime files. Only the .glb files belong in the renderer build; copying the directory whole
// would ship the .blend sources with the game.
const GLB_ONLY_MODEL_DIRS = [
    ['assets', 'models', 'verdant_wildwuchs'],
    ['assets', 'models', 'glowing_mushroom'],
];

function copyGlbTree(sourceDir, targetDir) {
    if (!existsSync(sourceDir)) return;
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyGlbTree(sourcePath, targetPath);
        } else if (entry.isFile() && entry.name.endsWith('.glb')) {
            mkdirSync(path.dirname(targetPath), { recursive: true });
            cpSync(sourcePath, targetPath, { force: true });
        }
    }
}

export function copyObjVehicleAssetsPlugin() {
    let resolvedOutDir = path.resolve(__dirname, 'dist');

    return {
        name: 'copy-obj-vehicle-assets',
        apply: 'build',
        configResolved(config) {
            resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist');
        },
        writeBundle() {
            // Each map pack owns a runtime glb directory and editable sources in
            // blender. Discover runtime packs so a new map cannot be omitted here.
            const mapsRoot = path.resolve(__dirname, 'assets', 'maps');
            const mapEntries = readdirSync(mapsRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => ['assets', 'maps', entry.name, 'glb']);
            for (const pathSegments of [...OBJ_ASSET_COPY_ENTRIES, ...mapEntries]) {
                const sourcePath = path.resolve(__dirname, ...pathSegments);
                if (!existsSync(sourcePath)) continue;
                const targetPath = path.join(resolvedOutDir, ...pathSegments);
                mkdirSync(path.dirname(targetPath), { recursive: true });
                cpSync(sourcePath, targetPath, { recursive: true, force: true });
            }
            for (const entry of readdirSync(mapsRoot, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const pathSegments = ['assets', 'maps', entry.name, 'props'];
                copyGlbTree(
                    path.resolve(__dirname, ...pathSegments),
                    path.join(resolvedOutDir, ...pathSegments)
                );
            }
            for (const pathSegments of GLB_ONLY_MODEL_DIRS) {
                copyGlbTree(
                    path.resolve(__dirname, ...pathSegments),
                    path.join(resolvedOutDir, ...pathSegments)
                );
            }
        },
    };
}
export function copyGlbGalleryAssetsPlugin() {
    let resolvedOutDir = path.resolve(__dirname, 'dist');

    return {
        name: 'copy-glb-gallery-assets',
        apply: 'build',
        configResolved(config) {
            resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist');
        },
        writeBundle() {
            if (!existsSync(GLB_GALLERY_ASSET_SOURCE_DIR)) return;
            const targetDir = path.join(resolvedOutDir, ...GLB_GALLERY_ASSET_OUTPUT_SEGMENTS);
            mkdirSync(path.dirname(targetDir), { recursive: true });
            cpSync(GLB_GALLERY_ASSET_SOURCE_DIR, targetDir, { recursive: true, force: true });
        },
    };
}
