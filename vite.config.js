import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createRendererBuildDefines,
    createRendererShellBuildConfig,
    createRendererShellServerConfig,
} from './dev/vite/rendererShellConfig.js';
import { editorDiskSaveApiPlugin } from './dev/vite/editorDiskApiPlugin.js';
import { developmentCheckpointApiPlugin } from './dev/vite/developmentCheckpointApi.js';
import {
    copyGlbGalleryAssetsPlugin,
    copyObjVehicleAssetsPlugin,
} from './dev/vite/productAssetCopyPlugin.js';
import {
    playwrightHealthApiPlugin,
    playwrightTestRuntimeBridgePlugin,
} from './dev/vite/playwrightVitePlugins.js';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const buildTime = new Date().toISOString();
const buildId = Date.now().toString(36).toUpperCase();
const CHUNK_SIZE_WARNING_LIMIT_KB = 1300;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    const loadedEnv = loadEnv(mode, process.cwd(), '');
    const resolvedEnv = {
        ...process.env,
        ...loadedEnv,
    };

    return {
        plugins: [
            playwrightTestRuntimeBridgePlugin(resolvedEnv),
            playwrightHealthApiPlugin(),
            editorDiskSaveApiPlugin(),
            developmentCheckpointApiPlugin(),
            copyObjVehicleAssetsPlugin(),
            copyGlbGalleryAssetsPlugin(),
        ],
        server: createRendererShellServerConfig(resolvedEnv),
        build: createRendererShellBuildConfig({
            rootDir: __dirname,
            chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
            env: resolvedEnv,
        }),
        define: createRendererBuildDefines({
            pkgVersion: pkg.version,
            buildTime,
            buildId,
            env: resolvedEnv,
        }),
    };
});
