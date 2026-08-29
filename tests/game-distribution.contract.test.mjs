import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const isExportedRepository = existsSync('.game-export.json');
const sourcePath = (templatePath, exportedPath) => (
    isExportedRepository ? exportedPath : templatePath
);

test('game build has exactly the player and hangar HTML entry points', () => {
    const exportedViteConfig = readFileSync(sourcePath('game-export/vite.config.js', 'vite.config.js'), 'utf8');
    if (!isExportedRepository) {
        const rendererConfig = readFileSync('dev/vite/rendererShellConfig.js', 'utf8');
        assert.match(rendererConfig, /GAME: 'game'/);
        assert.match(rendererConfig, /app: RENDERER_INPUT_FILES\.app,[\s\S]*hangar: RENDERER_INPUT_FILES\.hangar/);
    }
    assert.doesNotMatch(exportedViteConfig, /editor\/map-editor|prototypes\/vehicle-lab/);
});

test('game Electron main strips authoring-only capabilities and denies popups', async () => {
    const source = readFileSync('electron/main.cjs', 'utf8');
    const gameMain = isExportedRepository
        ? source
        : (await import('../scripts/export-game-repo.mjs')).transformElectronMain(source);
    assert.match(gameMain, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
    assert.doesNotMatch(
        gameMain,
        /editor|playtest|tuning|globalShortcut|session\.defaultSession|UNTRUSTED_IPC_SENDER_CODE/i
    );
});

test('game menu bindings route developer telemetry to the distribution adapter', async () => {
    const source = readFileSync('src/ui/menu/MenuDevPanelBindings.js', 'utf8');
    const gameBindings = isExportedRepository
        ? source
        : (await import('../scripts/export-game-repo.mjs')).transformMenuDevPanelBindings(source);
    assert.match(gameBindings, /\.\.\/\.\.\/product\/GameDistributionToolingAdapter\.js/);
    assert.doesNotMatch(gameBindings, /MenuDeveloperStateSync/);
});

test('offline installers have stable architecture-specific names and per-user NSIS policy', () => {
    const builderConfig = readFileSync(sourcePath('game-export/electron-builder.yml', 'electron/game-builder.yml'), 'utf8');
    assert.match(builderConfig, /artifactName: CurviosClash-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
    assert.match(builderConfig, /perMachine: false/);
    assert.match(builderConfig, /allowElevation: false/);
    assert.match(builderConfig, /deleteAppDataOnUninstall: false/);
    assert.match(builderConfig, /four-player-planar\/FourPlayerPlanarContract\.js/);
    assert.match(builderConfig, /shared\/telemetry\/TelemetryPreferencesStore\.js/);
    assert.doesNotMatch(builderConfig, /tuning|editor\/|vehicle-lab/i);
});

test('game Electron manifest stays aligned with its locked runtime', () => {
    const manifest = JSON.parse(readFileSync(
        sourcePath('game-export/electron-package.json', 'electron/package.json'),
        'utf8'
    ));
    const lock = JSON.parse(readFileSync('electron/package-lock.json', 'utf8'));
    assert.equal(manifest.devDependencies.electron, lock.packages[''].devDependencies.electron);
    assert.equal(manifest.devDependencies['electron-builder'], lock.packages[''].devDependencies['electron-builder']);
});

test('release waits for native x64 and ARM64 installed-product proofs', () => {
    const workflow = readFileSync(sourcePath('game-export/release.yml', '.github/workflows/release.yml'), 'utf8');
    assert.match(workflow, /runner: windows-latest/);
    assert.match(workflow, /runner: windows-11-arm/);
    assert.match(workflow, /needs: package-and-test/);
    assert.match(workflow, /npm run test:installer/);
    assert.match(workflow, /actions\/download-artifact@v7/);
    assert.match(workflow, /npm run release:verify/);
    assert.match(workflow, /RELEASE-SIGNING\.txt/);
    assert.match(workflow, /--notes-file release\/RELEASE-NOTES\.md/);
});

test('installer smoke runs copied bytes outside the checkout and preserves its proof', () => {
    const installerTest = readFileSync('scripts/test-installer.ps1', 'utf8');
    assert.match(installerTest, /artifact-outside-checkout/);
    assert.match(installerTest, /Copy-Item -LiteralPath \$sourceInstaller/);
    assert.match(installerTest, /Join-Path \$releaseDirectory "installer-proof-\$Arch\.json"/);
});

test('FFmpeg x64 binary source and decompressed SHA-256 are pinned', () => {
    const contract = JSON.parse(readFileSync(sourcePath('game-export/ffmpeg-win32-x64.json', 'build/ffmpeg-win32-x64.json'), 'utf8'));
    assert.equal(contract.package, 'ffmpeg-static@5.3.0');
    assert.equal(contract.architecture, 'x64');
    assert.match(contract.url, /^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\//);
    assert.match(contract.sha256, /^[a-f0-9]{64}$/);
});
