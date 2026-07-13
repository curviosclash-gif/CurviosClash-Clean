import path from 'path';

const PLAYWRIGHT_WARMUP_CLIENT_FILES = [
    './index.html',
    './src/core/main.js',
    './src/entities/ai/HuntBridgePolicy.js',
    './src/entities/ai/ObservationBridgePolicyHelpers.js',
];

const RENDERER_INPUT_FILES = {
    app: 'index.html',
    editorMap3d: 'editor/map-editor-3d.html',
};

const RENDERER_APP_TARGETS = Object.freeze({
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

function resolveRendererManualChunk(id) {
    if (!id) return undefined;
    if (id.includes('node_modules/three/examples/jsm/loaders/OBJLoader.js') ||
        id.includes('node_modules/three/examples/jsm/loaders/MTLLoader.js')) {
        return 'three-loaders';
    }
    if (id.includes('node_modules/three')) {
        return 'three-core';
    }

    const normalizedId = id.replace(/\\/g, '/');
    if (normalizedId.includes('/entities/ai/training/') ||
        normalizedId.includes('/state/training/')) {
        return 'training';
    }
    if (normalizedId.includes('/state/validation/')) {
        return 'validation';
    }
    if (normalizedId.includes('/trainer/') && !normalizedId.includes('node_modules')) {
        return 'trainer';
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
    if (normalizedId.includes('/menu/MenuTelemetryDashboard') ||
        normalizedId.includes('/menu/MenuTelemetryStore') ||
        normalizedId.includes('/state/TelemetryHistoryStore')) {
        return 'developer-ui';
    }

    return undefined;
}

export function createRendererShellServerConfig(env = process.env) {
    const warmupClientFiles = resolvePlaywrightWarmupClientFiles(env);
    const isPlaywright = !!env?.PW_RUN_TAG;

    return {
        open: !isPlaywright && !env?.CI,
        hmr: isPlaywright ? false : undefined,
        warmup: warmupClientFiles.length > 0
            ? { clientFiles: warmupClientFiles }
            : undefined,
    };
}

function resolveRendererBuildOutDir(env = process.env) {
    const appTarget = resolveRendererAppTarget(env);
    if (appTarget === RENDERER_APP_TARGETS.MOBILE_CLASSIC) {
        return 'dist/mobile-classic';
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
                manualChunks: resolveRendererManualChunk,
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
        __SIGNALING_URL__: JSON.stringify(env?.VITE_SIGNALING_URL || ''),
        __TURN_URL__: JSON.stringify(env?.VITE_TURN_URL || ''),
        __TURN_USERNAME__: JSON.stringify(env?.VITE_TURN_USER || env?.VITE_TURN_USERNAME || ''),
        __TURN_CREDENTIAL__: JSON.stringify(env?.VITE_TURN_CREDENTIAL || ''),
    };
}
