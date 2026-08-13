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
import { desktopNetworkPolicyPlugin } from './dev/vite/desktopNetworkPolicyPlugin.js';

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
    const isGameDistribution = mode === 'game';
    if (isGameDistribution) {
        resolvedEnv.VITE_APP_MODE = 'app';
        resolvedEnv.VITE_APP_TARGET = 'game';
    }
    const gameToolingAdapter = path.resolve(__dirname, 'src/product/GameDistributionToolingAdapter.js');

    return {
        plugins: [
            ...(isGameDistribution ? [] : [
                playwrightTestRuntimeBridgePlugin(resolvedEnv),
                playwrightHealthApiPlugin(),
                editorDiskSaveApiPlugin(),
                developmentCheckpointApiPlugin(),
            ]),
            copyObjVehicleAssetsPlugin(),
            copyGlbGalleryAssetsPlugin(),
            desktopNetworkPolicyPlugin(resolvedEnv),
        ],
        server: createRendererShellServerConfig(resolvedEnv),
        resolve: isGameDistribution ? {
            alias: {
                '../mobile-classic/MobileClassicApp.js': path.resolve(
                    __dirname,
                    'src/product/DesktopMobileClassicAdapter.js'
                ),
                [path.resolve(__dirname, 'src/core/PlaytestLaunchParams.js')]: gameToolingAdapter,
                [path.resolve(__dirname, 'src/core/PlaytestReturnControl.js')]: gameToolingAdapter,
                [path.resolve(__dirname, 'src/dev/tuning/TuningRuntimeIpcBridge.js')]: gameToolingAdapter,
                [path.resolve(__dirname, 'src/state/AuthoringTelemetryStore.js')]: gameToolingAdapter,
                [path.resolve(__dirname, 'src/shared/contracts/AuthoringTelemetryContract.js')]: gameToolingAdapter,
                [path.resolve(__dirname, 'src/ui/menu/MenuDeveloperStateSync.js')]: gameToolingAdapter,
            },
        } : undefined,
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
