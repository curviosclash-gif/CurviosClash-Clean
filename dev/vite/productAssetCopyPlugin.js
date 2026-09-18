import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OBJ_ASSET_COPY_ENTRIES = [
    ['assets', 'models', 'optimized_cc0'],
    ['assets', 'models', 'giant_dandelion', 'giant_dandelion_shootable.glb'],
    ['assets', 'models', 'ancient_tree', 'variants', 'variant_06', 'ancient_tree_06_lod1.glb'],
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
const WILDWUCHS_ASSET_SEGMENTS = ['assets', 'models', 'verdant_wildwuchs'];

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
            const wildwuchsSource = path.resolve(__dirname, ...WILDWUCHS_ASSET_SEGMENTS);
            if (existsSync(wildwuchsSource)) {
                const targetDir = path.join(resolvedOutDir, ...WILDWUCHS_ASSET_SEGMENTS);
                mkdirSync(targetDir, { recursive: true });
                for (const entry of readdirSync(wildwuchsSource, { withFileTypes: true })) {
                    if (entry.isFile() && entry.name.endsWith('.glb')) {
                        cpSync(path.join(wildwuchsSource, entry.name), path.join(targetDir, entry.name), { force: true });
                    }
                }
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
