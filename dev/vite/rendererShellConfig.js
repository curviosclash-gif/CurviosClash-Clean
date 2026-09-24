import path from 'path';

const PLAYWRIGHT_WARMUP_CLIENT_FILES = [
    './index.html',
    './src/core/main.js',
    './src/entities/ai/HuntBridgePolicy.js',
    './src/entities/ai/ObservationBridgePolicyHelpers.js',
];

const RENDERER_INPUT_FILES = {
    app: 'index.html',
    hangar: 'hangar.html',
    editorMap3d: 'editor/map-editor-3d.html',
    vehicleLab: 'prototypes/vehicle-lab/index.html',
};

const RENDERER_APP_TARGETS = Object.freeze({
    GAME: 'game',
    MOBILE_CLASSIC: 'mobile-classic',
});

function resolveRendererAppTarget(env = process.env) {
    return String(env?.VITE_APP_TARGET || '').trim().toLowerCase();
}

function resolveRendererInputFiles(env = process.env) {
    const appTarget = resolveRendererAppTarget(env);
    if (appTarget === RENDERER_APP_TARGETS.MOBILE_CLASSIC) {
        return { app: RENDERER_INPUT_FILES.app };
    }
    if (appTarget === RENDERER_APP_TARGETS.GAME) {
        return {
            app: RENDERER_INPUT_FILES.app,
            hangar: RENDERER_INPUT_FILES.hangar,
        };
    }
    return RENDERER_INPUT_FILES;
}

function resolvePlaywrightWarmupClientFiles(env = process.env) {
    if (!env?.PW_RUN_TAG) return [];
    const explicit = String(env?.PW_VITE_WARMUP || '').trim();
    if (explicit === '0') return [];
    if (explicit === '1') return PLAYWRIGHT_WARMUP_CLIENT_FILES;
    if (String(env?.PW_PREWARM || '').trim() !== '1') return [];
    return PLAYWRIGHT_WARMUP_CLIENT_FILES;
}

function resolveRendererManualChunk(id, env = process.env) {
    if (!id) return undefined;
    const normalizedId = id.replace(/\\/g, '/');
    if (normalizedId.includes('/node_modules/mp4-muxer/') ||
        normalizedId.endsWith('/core/recording/engines/WebCodecsRecorderEngine.js')) {
        return 'recording-webcodecs';
    }
    if (id.includes('node_modules/three/examples/jsm/loaders/OBJLoader.js') ||
        id.includes('node_modules/three/examples/jsm/loaders/MTLLoader.js')) {
        return 'three-loaders';
    }
    if (id.includes('node_modules/three')) {
        return 'three-core';
    }

    if (normalizedId.includes('/core/recording/') ||
        normalizedId.endsWith('/core/MediaRecorderSystem.js') ||
        normalizedId.endsWith('/core/renderer/RecordingCapturePipeline.js') ||
        normalizedId.endsWith('/core/renderer/camera/RecordingOrbitCameraDirector.js')) {
        return 'game-runtime';
    }
    if (normalizedId.includes('/entities/ai/inference/')) {
        return 'ai-inference';
    }
    if (normalizedId.includes('/arcade/') ||
        normalizedId.includes('/hunt/') ||
        normalizedId.includes('/modes/') ||
        normalizedId.includes('/mobile-arcade/') ||
        normalizedId.includes('Arcade')) {
        return 'game-runtime';
    }
    if (normalizedId.includes('/state/recorder/')) {
        return 'recorder';
    }
    if (normalizedId.includes('/config/maps/MapPresetCatalog') ||
        normalizedId.includes('/config/maps/MapPresetCatalogBaseData') ||
        normalizedId.includes('/config/maps/MapPresetCatalogExpertData') ||
        normalizedId.includes('/config/maps/MapPresetCatalogLarge') ||
        normalizedId.includes('/config/maps/presets/')) {
        return 'map-presets';
    }
    if (
        resolveRendererAppTarget(env) !== RENDERER_APP_TARGETS.GAME
        && normalizedId.includes('/menu/MenuTelemetryDashboard')
    ) {
        return 'developer-ui';
    }

    return undefined;
}

/** Fester Entwicklungsport - siehe strictPort unten. */
export const RENDERER_DEV_SERVER_PORT = 5173;

export function createRendererShellServerConfig(env = process.env) {
    const warmupClientFiles = resolvePlaywrightWarmupClientFiles(env);
    const isPlaywright = !!env?.PW_RUN_TAG;

    return {
        open: !isPlaywright && !env?.CI,
        hmr: isPlaywright ? false : undefined,
        // Playwright waehlt seinen Port bewusst pro Lauf und uebergibt ihn auf der
        // Kommandozeile; nur der normale Entwicklungslauf wird hier festgenagelt.
        //
        // Ohne strictPort weicht Vite bei belegtem 5173 still auf einen anderen Port
        // aus. Weil localStorage und IndexedDB an der Herkunft (inklusive Port)
        // haengen, faengt die Telemetrie dann unbemerkt bei null an, und die
        // gesammelten Runden liegen verstreut in Datenbanken, die niemand mehr
        // findet. Ein Abbruch mit klarer Fehlermeldung ist das kleinere Uebel.
        port: isPlaywright ? undefined : RENDERER_DEV_SERVER_PORT,
        strictPort: isPlaywright ? undefined : true,
        warmup: warmupClientFiles.length > 0
            ? { clientFiles: warmupClientFiles }
            : undefined,
    };
}

function resolveRendererBuildOutDir(env = process.env) {
    if (env?.CURVIOS_E2E_BUILD === '1') return 'dist-app-test';
    const appTarget = resolveRendererAppTarget(env);
    if (appTarget === RENDERER_APP_TARGETS.MOBILE_CLASSIC) {
        return 'dist/mobile-classic';
    }
    if (appTarget === RENDERER_APP_TARGETS.GAME) {
        return 'dist-game';
    }
    const appMode = String(env?.VITE_APP_MODE || '').trim().toLowerCase();
    if (appMode === 'app') {
        return 'dist-app';
    }
    return 'dist';
}

export function createRendererShellBuildConfig({ rootDir, chunkSizeWarningLimit, env = process.env }) {
    return {
        outDir: resolveRendererBuildOutDir(env),
        chunkSizeWarningLimit,
        rollupOptions: {
            input: Object.fromEntries(
                Object.entries(resolveRendererInputFiles(env)).map(([entryName, relativePath]) => [
                    entryName,
                    path.resolve(rootDir, relativePath),
                ])
            ),
            output: {
                manualChunks: (id) => resolveRendererManualChunk(id, env),
            },
        },
    };
}

export function createRendererBuildDefines({ pkgVersion, buildTime, buildId, env = process.env }) {
    const isPlaywright = !!env?.PW_RUN_TAG;
    return {
        __APP_VERSION__: JSON.stringify(pkgVersion),
        __BUILD_TIME__: JSON.stringify(buildTime),
        __BUILD_ID__: JSON.stringify(buildId),
        __CURVIOS_E2E__: JSON.stringify(isPlaywright),
        __APP_MODE__: JSON.stringify(env?.VITE_APP_MODE || 'web'),
        __APP_TARGET__: JSON.stringify(resolveRendererAppTarget(env) || 'default'),
        __GAME_DISTRIBUTION__: JSON.stringify(resolveRendererAppTarget(env) === RENDERER_APP_TARGETS.GAME),
        __SIGNALING_URL__: JSON.stringify(env?.VITE_SIGNALING_URL || ''),
        __TURN_URL__: JSON.stringify(env?.VITE_TURN_URL || ''),
        __TURN_USERNAME__: JSON.stringify(env?.VITE_TURN_USER || env?.VITE_TURN_USERNAME || ''),
        __TURN_CREDENTIAL__: JSON.stringify(env?.VITE_TURN_CREDENTIAL || ''),
    };
}
