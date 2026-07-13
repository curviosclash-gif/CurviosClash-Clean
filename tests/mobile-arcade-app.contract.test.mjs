import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createRendererBuildDefines,
  createRendererShellBuildConfig,
} from '../dev/vite/rendererShellConfig.js';
import {
  applyMobileClassicSettings,
} from '../src/mobile-classic/MobileClassicApp.js';
import {
  isMobileArcadeRouteAllowed,
  listMobileArcadeRouteAllowlist,
  MOBILE_ARCADE_DEFAULT_MAP_KEY,
  resolveMobileArcadeMapKey,
} from '../src/mobile-arcade/MobileArcadeApp.js';
import { ARCADE_GHOST_DUEL_MODES } from '../src/shared/contracts/ArcadeGhostDuelContract.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import {
  resolveTouchButtonDefinitions,
  TouchInputSource,
  TOUCH_CONTROL_MODES,
} from '../src/ui/TouchInputSource.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

test('Unified Android target builds one mobile shell for Classic and Arcade-Parcours', () => {
  const config = createRendererShellBuildConfig({
    rootDir: process.cwd(),
    chunkSizeWarningLimit: 1300,
    env: {
      VITE_APP_MODE: 'app',
      VITE_APP_TARGET: 'mobile-classic',
    },
  });

  assert.equal(config.outDir, 'dist/mobile-classic');
  assert.deepEqual(Object.keys(config.rollupOptions.input), ['app']);
  assert.match(config.rollupOptions.input.app, /index\.html$/);

  const defines = createRendererBuildDefines({
    pkgVersion: '0.0.0-test',
    buildTime: 'test',
    buildId: 'test',
    env: {
      VITE_APP_MODE: 'app',
      VITE_APP_TARGET: 'mobile-classic',
    },
  });
  assert.equal(defines.__APP_MODE__, '"app"');
  assert.equal(defines.__APP_TARGET__, '"mobile-classic"');
});

test('Unified Mobile Android settings preserve Arcade-Parcours with curated routes', () => {
  const settings = {
    mode: '2p',
    gameMode: 'HUNT',
    mapKey: 'storm_switchyard',
    localSettings: {
      sessionType: 'multiplayer',
      modePath: 'arcade',
      startSetup: {
        arcadeGhostDuelMode: 'bad',
        arcadeGhostTrailCollisionEnabled: true,
        modeSelections: {
          arcade: {
            mapKey: 'micro_maw',
          },
        },
      },
      mobileControls: {
        tiltSensitivity: 9,
      },
    },
    gameplay: {
      planarMode: true,
    },
    hunt: {
      respawnEnabled: true,
    },
  };

  applyMobileClassicSettings(settings);

  assert.equal(settings.mode, '1p');
  assert.equal(settings.gameMode, 'CLASSIC');
  assert.equal(settings.localSettings.sessionType, 'single');
  assert.equal(settings.localSettings.modePath, 'arcade');
  assert.equal(settings.mapKey, 'micro_maw');
  assert.equal(settings.localSettings.startSetup.modeSelections.arcade.mapKey, 'micro_maw');
  assert.equal(
    settings.localSettings.startSetup.arcadeGhostDuelMode,
    ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST,
  );
  assert.equal(settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled, false);
  assert.equal(settings.localSettings.mobileControls.tiltSensitivity, 1.8);
  assert.equal(settings.gameplay.planarMode, false);
  assert.equal(settings.hunt.respawnEnabled, false);

  const fallbackSettings = {
    mapKey: 'storm_switchyard',
    localSettings: {
      modePath: 'arcade',
      startSetup: {},
    },
  };
  applyMobileClassicSettings(fallbackSettings);
  assert.equal(fallbackSettings.mapKey, MOBILE_ARCADE_DEFAULT_MAP_KEY);
  assert.equal(
    fallbackSettings.localSettings.startSetup.arcadeGhostDuelMode,
    ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST,
  );
});

test('Mobile Arcade route allowlist preserves MVP routes and existing route keyspace', () => {
  assert.deepEqual(listMobileArcadeRouteAllowlist(), [
    'parcours_rift_sprint',
    'micro_maw',
    'mirror_docks',
    'glass_serpent',
  ]);
  assert.equal(isMobileArcadeRouteAllowed('mirror_docks'), true);
  assert.equal(isMobileArcadeRouteAllowed('storm_switchyard'), false);
  assert.equal(resolveMobileArcadeMapKey('storm_switchyard'), MOBILE_ARCADE_DEFAULT_MAP_KEY);

  for (const mapKey of listMobileArcadeRouteAllowlist()) {
    const routeId = String(MAP_PRESETS_BASE[mapKey]?.parcours?.routeId || '');
    assert.notEqual(routeId, '');
    assert.doesNotMatch(routeId, /^mobile_/);
  }
});

test('Unified Mobile Android shell carries Arcade HUD, Ghost, and pause affordances', async () => {
  const mobileClassicApp = await readText('src/mobile-classic/MobileClassicApp.js');
  const mobileClassicStyles = await readText('src/mobile-classic/MobileClassicStyles.js');
  const mobileClassicMenuUi = await readText('src/mobile-classic/MobileClassicMenuUi.js');
  const mobileClassicSurface = `${mobileClassicApp}\n${mobileClassicStyles}\n${mobileClassicMenuUi}`;
  const hudRuntimeSystem = await readText('src/ui/HudRuntimeSystem.js');

  assert.match(mobileClassicApp, /modePath === MENU_MODE_PATHS\.ARCADE/);
  assert.match(mobileClassicSurface, /touch-button-pause/);
  assert.match(mobileClassicSurface, /mobile-android-entry-panel/);
  assert.match(mobileClassicMenuUi, /mobileModeEntry/);
  assert.match(mobileClassicMenuUi, /Spielstil waehlen/);
  assert.match(mobileClassicMenuUi, /Start vorbereiten/);
  assert.match(mobileClassicSurface, /#parcours-hud/);
  assert.match(mobileClassicSurface, /#parcours-minimap/);
  assert.match(mobileClassicSurface, /mobile-arcade-ghost-status/);
  assert.match(mobileClassicMenuUi, /Ghost: Selbstduell/);
  assert.match(hudRuntimeSystem, /_updateParcoursHud[\s\S]*tickMinimap/);
});

test('Mobile Arcade touch contract uses tilt controls, pause, and edge-triggered item actions', () => {
  const tiltButtons = resolveTouchButtonDefinitions(TOUCH_CONTROL_MODES.TILT, {
    includePauseButton: true,
  }).map((button) => button.id);

  assert.deepEqual(tiltButtons, ['fire', 'useItem', 'nextItem', 'boost', 'pause']);

  let pauseCount = 0;
  const source = new TouchInputSource({
    controlMode: TOUCH_CONTROL_MODES.TILT,
    includePauseButton: true,
    game: {
      matchFlowUiController: {
        pause() {
          pauseCount += 1;
        },
      },
      settings: {
        localSettings: {},
      },
    },
  });
  source._resolveActionState = () => ({
    canShootNow: true,
    canUseNow: true,
    canCycle: true,
    showMg: false,
  });

  assert.equal(source._requestPause(), true);
  assert.equal(source._requestPause(), false);
  assert.equal(pauseCount, 1);

  source._buttons.fire = true;
  source._buttons.useItem = true;
  source._buttons.nextItem = true;
  const firstPoll = source.poll();
  const secondPoll = source.poll();

  assert.equal(firstPoll.shootItem, true);
  assert.equal(firstPoll.useItem, true);
  assert.equal(firstPoll.nextItem, true);
  assert.equal(secondPoll.shootItem, false);
  assert.equal(secondPoll.useItem, false);
  assert.equal(secondPoll.nextItem, false);

  source.dispose();
});

test('Arcade Android scripts are folded into the unified Android app path', async () => {
  const packageJson = await readJson('package.json');
  const config = await readJson('tools/mobile-classic-app/capacitor.config.json');
  const buildScript = await readText('scripts/build-mobile-classic-app.mjs');
  const capacitorScript = await readText('scripts/capacitor-mobile-classic.mjs');
  const gradleFile = await readText('android-classic/app/build.gradle');
  const manifest = await readText('android-classic/app/src/main/AndroidManifest.xml');
  const readme = await readText('tools/mobile-classic-app/README.md');

  assert.equal(config.appId, 'de.curviosclash.classic');
  assert.equal(config.appName, 'Curvios Clash');
  assert.equal(config.webDir, '../../dist/mobile-classic');
  assert.equal(config.android.path, '../../android-classic');

  assert.equal(packageJson.scripts['app:android:build'], 'node scripts/build-mobile-classic-app.mjs');
  assert.equal(packageJson.scripts['app:android:check'], 'node --test tests/mobile-classic-app.contract.test.mjs tests/mobile-arcade-app.contract.test.mjs');
  assert.equal(packageJson.scripts['app:android:install'], 'node scripts/capacitor-mobile-classic.mjs install');
  assert.equal(packageJson.scripts['app:arcade:android:build'], undefined);
  assert.equal(packageJson.scripts['app:arcade:android:install'], undefined);
  assert.equal(await pathExists('scripts/build-mobile-arcade-app.mjs'), false);
  assert.equal(await pathExists('scripts/capacitor-mobile-arcade.mjs'), false);
  assert.equal(await pathExists('tools/mobile-arcade-app/capacitor.config.json'), false);

  assert.match(buildScript, /curvios\.mobile-android-app\.v1/);
  assert.match(buildScript, /listMobileArcadeRouteAllowlist/);
  assert.match(buildScript, /MOBILE_ARCADE_DEFAULT_MAP_KEY/);
  assert.match(capacitorScript, /dist', 'mobile-classic'/);
  assert.match(capacitorScript, /de\.curviosclash\.classic/);
  assert.doesNotMatch(capacitorScript, /CURVIOS_ANDROID_TARGET|de\.curviosclash\.arcade/);
  assert.match(gradleFile, /mobileAndroidApplicationId = 'de\.curviosclash\.classic'/);
  assert.match(gradleFile, /mobileAndroidAppName = 'Curvios Clash'/);
  assert.doesNotMatch(gradleFile, /mobileAndroidIsArcade|de\.curviosclash\.arcade/);
  assert.match(manifest, /android:label="\$\{appName\}"/);
  assert.match(manifest, /de\.curviosclash\.classic\.MainActivity/);
  assert.match(readme, /Classic and\s+Arcade-Parcours ship together/);
});

