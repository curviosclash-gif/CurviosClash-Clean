import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OBJ_ASSET_COPY_ENTRIES = [
    ['assets', 'items'],
    ['assets', 'portals'],
    ['assets', 'trails'],
    ['assets', 'models', 'jets', 'cc0', 'WWIairplane.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_low.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_high.obj'],
    ['assets', 'models', 'jets', 'cc0', 'funky_aircraft_control.obj'],
    ['assets', 'models', 'jets', 'cc0', 'pinnace_lo.obj'],
    ['assets', 'models', 'jets', 'cc0', 'spaceship_pack', 'dist', 'obj_mtl'],
    ['assets', 'maps', 'chrono_forge', 'glb'],
    ['assets', 'maps', 'kinetic_tide', 'glb'],
    ['assets', 'maps', 'verdant_aperture', 'glb'],
    ['assets', 'maps', 'notre_dame', 'glb'],
];
const GLB_GALLERY_ASSET_SOURCE_DIR = path.resolve(__dirname, 'assets', 'models', 'downloaded_cc0');
const GLB_GALLERY_ASSET_OUTPUT_SEGMENTS = ['assets', 'models', 'downloaded_cc0'];

export function copyObjVehicleAssetsPlugin() {
    let resolvedOutDir = path.resolve(__dirname, 'dist');

    return {
        name: 'copy-obj-vehicle-assets',
        apply: 'build',
        configResolved(config) {
            resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist');
        },
        writeBundle() {
            for (const pathSegments of OBJ_ASSET_COPY_ENTRIES) {
                const sourcePath = path.resolve(__dirname, ...pathSegments);
                if (!existsSync(sourcePath)) continue;
                const targetPath = path.join(resolvedOutDir, ...pathSegments);
                mkdirSync(path.dirname(targetPath), { recursive: true });
                cpSync(sourcePath, targetPath, { recursive: true, force: true });
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
