import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(rootDirectory, 'package.json'), 'utf8'));
const assetEntries = [
    ['assets', 'items'],
    ['assets', 'portals'],
    ['assets', 'trails'],
    ['assets', 'models', 'jets', 'cc0'],
    ['assets', 'models', 'downloaded_cc0'],
    ['assets', 'maps', 'chrono_forge', 'glb'],
    ['assets', 'maps', 'kinetic_tide', 'glb'],
    ['assets', 'maps', 'kinetic_tide', 'props'],
];

function productAssetsPlugin() {
    return {
        name: 'curvios-game-assets',
        apply: 'build',
        writeBundle() {
            for (const segments of assetEntries) {
                const source = path.join(rootDirectory, ...segments);
                if (!existsSync(source)) continue;
                const destination = path.join(rootDirectory, 'dist-game', ...segments);
                mkdirSync(path.dirname(destination), { recursive: true });
                cpSync(source, destination, { recursive: true, force: true });
            }
        },
    };
}

export default defineConfig(({ mode }) => {
    const environment = { ...process.env, ...loadEnv(mode, rootDirectory, '') };
    const buildTime = new Date().toISOString();
    const gameToolingAdapter = path.join(rootDirectory, 'src/product/GameDistributionToolingAdapter.js');
    return {
        plugins: [productAssetsPlugin()],
        resolve: {
            alias: {
                '../mobile-classic/MobileClassicApp.js': path.join(
                    rootDirectory,
                    'src/product/DesktopMobileClassicAdapter.js'
                ),
                [path.join(rootDirectory, 'src/core/PlaytestLaunchParams.js')]: gameToolingAdapter,
                [path.join(rootDirectory, 'src/core/PlaytestReturnControl.js')]: gameToolingAdapter,
                [path.join(rootDirectory, 'src/dev/tuning/TuningRuntimeIpcBridge.js')]: gameToolingAdapter,
                [path.join(rootDirectory, 'src/state/AuthoringTelemetryStore.js')]: gameToolingAdapter,
                [path.join(rootDirectory, 'src/shared/contracts/AuthoringTelemetryContract.js')]: gameToolingAdapter,
                [path.join(rootDirectory, 'src/ui/menu/MenuDeveloperStateSync.js')]: gameToolingAdapter,
            },
        },
        build: {
            outDir: 'dist-game',
            chunkSizeWarningLimit: 1600,
            rollupOptions: {
                input: {
                    app: path.join(rootDirectory, 'index.html'),
                    hangar: path.join(rootDirectory, 'hangar.html'),
                },
            },
        },
        define: {
            __APP_VERSION__: JSON.stringify(packageJson.version),
            __BUILD_TIME__: JSON.stringify(buildTime),
            __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA || 'local'),
            __CURVIOS_E2E__: 'false',
            __APP_MODE__: JSON.stringify('app'),
            __APP_TARGET__: JSON.stringify('game'),
            __GAME_DISTRIBUTION__: 'true',
            __SIGNALING_URL__: JSON.stringify(environment.VITE_SIGNALING_URL || ''),
            __TURN_URL__: JSON.stringify(environment.VITE_TURN_URL || ''),
            __TURN_USERNAME__: JSON.stringify(environment.VITE_TURN_USER || environment.VITE_TURN_USERNAME || ''),
            __TURN_CREDENTIAL__: JSON.stringify(environment.VITE_TURN_CREDENTIAL || ''),
        },
    };
});
