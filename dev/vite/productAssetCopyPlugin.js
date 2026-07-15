import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OBJ_VEHICLE_ASSET_SOURCE_DIR = path.resolve(__dirname, 'assets', 'models', 'jets', 'cc0', 'spaceship_pack', 'dist', 'obj_mtl');
const OBJ_VEHICLE_ASSET_OUTPUT_SEGMENTS = ['assets', 'models', 'jets', 'cc0', 'spaceship_pack', 'dist', 'obj_mtl'];
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
            if (!existsSync(OBJ_VEHICLE_ASSET_SOURCE_DIR)) return;
            const targetDir = path.join(resolvedOutDir, ...OBJ_VEHICLE_ASSET_OUTPUT_SEGMENTS);
            mkdirSync(path.dirname(targetDir), { recursive: true });
            cpSync(OBJ_VEHICLE_ASSET_SOURCE_DIR, targetDir, { recursive: true, force: true });
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
