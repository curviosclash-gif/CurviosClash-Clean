export const GAME_EXPORT_SCHEMA_VERSION = 'curviosclash-game-export.v1';

export const GAME_EXPORT_ROOT_FILES = new Set([
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    '.nvmrc',
    'app-shell.css',
    'hangar.html',
    'index.html',
    'style.css',
]);

export const GAME_EXPORT_SCRIPT_FILES = new Set([
    'scripts/check-game-build.mjs',
    'scripts/check-game-repository.mjs',
    'scripts/check-game-package.mjs',
    'scripts/package-game-app.mjs',
    'scripts/release-verify.mjs',
    'scripts/test-installed-game.mjs',
    'scripts/test-installer.ps1',
    'scripts/verify-ffmpeg-binary.mjs',
]);

export const GAME_EXPORT_TEST_FILES = new Set([
    'tests/arcade-mode-path-game-mode.contract.test.mjs',
    'tests/game-distribution.contract.test.mjs',
    'tests/lan-signaling-hardening.contract.test.mjs',
    'tests/offline-session-compatibility.contract.test.mjs',
    'tests/online-signaling-config.contract.test.mjs',
    'tests/persistence-version-migration.contract.test.mjs',
    'tests/recording-video-export.contract.test.mjs',
    'tests/seeded-spawn-and-mode-clock.contract.test.mjs',
]);

export const GAME_EXPORT_ELECTRON_FILES = new Set([
    'electron/cinematic-replay-video-export-job.cjs',
    'electron/entry.cjs',
    'electron/hangar-preload.cjs',
    'electron/hangar-window.cjs',
    'electron/ipc-sender-guard.cjs',
    'electron/main.cjs',
    'electron/package-lock.json',
    'electron/preload.cjs',
    'electron/recording-video-export-job.cjs',
    'electron/runtime-resources/package.json',
    'electron/session-data-runtime.cjs',
    'electron/static-server.cjs',
    'electron/test-render-window.cjs',
    'electron/window-security-options.cjs',
]);

const FORBIDDEN_ASSET_SOURCE_PATTERN = /(?:^|\/)(?:blender|source)(?:\/|$)|\.(?:blend|psd|kra|xcf)$/i;

export function isGameExportSourcePath(relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    if (GAME_EXPORT_ROOT_FILES.has(normalized)) return true;
    if (GAME_EXPORT_SCRIPT_FILES.has(normalized)) return true;
    if (GAME_EXPORT_TEST_FILES.has(normalized)) return true;
    if (GAME_EXPORT_ELECTRON_FILES.has(normalized)) return true;
    if (normalized.startsWith('electron/settings-studio/')) return true;
    if (normalized.startsWith('assets/')) return !FORBIDDEN_ASSET_SOURCE_PATTERN.test(normalized);
    if (normalized.startsWith('src/')) {
        return normalized !== 'src/shared/vehicle-lab/ModularVehicleMeshBridge.js'
            && normalized !== 'src/core/PlaytestLaunchParams.js'
            && normalized !== 'src/core/PlaytestReturnControl.js'
            && normalized !== 'src/shared/contracts/AuthoringTelemetryContract.js'
            && normalized !== 'src/state/AuthoringTelemetrySession.js'
            && normalized !== 'src/state/AuthoringTelemetryStore.js'
            && normalized !== 'src/ui/menu/MenuDeveloperStateSync.js'
            && !normalized.startsWith('src/ui/menu/MenuTelemetryDashboard')
            && !normalized.startsWith('src/ui/menu/MenuTelemetryHeatmap')
            && !normalized.startsWith('src/dev/')
            && !normalized.startsWith('src/mobile-arcade/')
            && !normalized.startsWith('src/mobile-classic/');
    }
    return normalized === 'server/lan-signaling.js'
        || normalized === 'server/package.json'
        || normalized === 'server/package-lock.json';
}

export const GAME_EXPORT_TEMPLATE_MAPPINGS = Object.freeze({
    'game-export/README.md': 'README.md',
    'game-export/package.json': 'package.json',
    'game-export/package-lock.json': 'package-lock.json',
    'game-export/vite.config.js': 'vite.config.js',
    'game-export/electron-package.json': 'electron/package.json',
    'game-export/electron-builder.yml': 'electron/game-builder.yml',
    'game-export/ffmpeg-win32-x64.json': 'build/ffmpeg-win32-x64.json',
    'game-export/release.yml': '.github/workflows/release.yml',
    'game-export/window-security-options.cjs': 'electron/window-security-options.cjs',
});

export const GAME_EXPORT_FORBIDDEN_PATH_PATTERNS = Object.freeze([
    /(?:^|\/)\.opencode(?:\/|$)/i,
    /(?:^|\/)(?:android-classic|editor|prototypes|tools)(?:\/|$)/i,
    /(?:^|\/)dev\/training(?:\/|$)/i,
    /(?:^|\/)src\/dev(?:\/|$)/i,
    /(?:^|\/)(?:tuning-console|vehicle-lab)(?:\/|$)/i,
    /(?:^|\/)(?:AuthoringTelemetry|MenuDeveloperStateSync|MenuTelemetryDashboard|MenuTelemetryHeatmap)[^/]*\.js$/i,
    /(?:^|\/)node_modules(?:\/|$)/i,
    /^(?:dist|dist-app|dist-game|release)(?:\/|$)/i,
]);
