import {
    test,
    expect,
    loadGame,
    openStartSetupSection,
    returnToMenu,
} from './core-targeted.shared.js';

const SUPPORTED_MODE_PATHS = Object.freeze(['normal', 'fight', 'arcade']);
const DEFAULT_MODE_PATHS = Object.freeze(['normal', 'fight', 'arcade']);

function resolveModePathsFromEnv() {
    const raw = String(process.env.PW_GHOST_SELFDUEL_MODE_PATHS || '').trim().toLowerCase();
    if (!raw) return [...DEFAULT_MODE_PATHS];
    const parts = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && SUPPORTED_MODE_PATHS.includes(entry));
    if (parts.length === 0) return [...DEFAULT_MODE_PATHS];
    return Array.from(new Set(parts));
}

const SEEDED_GHOST_CLIP = Object.freeze({
    frames: [
        {
            time: 0,
            players: [{ idx: 0, alive: true, x: 0, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, bot: false }],
        },
        {
            time: 3.8,
            players: [{ idx: 0, alive: true, x: 6, y: 2, z: 0, qx: 0, qy: 0.35, qz: 0, qw: 0.94, bot: false }],
        },
    ],
    players: [{ idx: 0, color: 0xffffff, isBot: false, modelScale: 1 }],
    sourceDuration: 3.8,
    displayDuration: 3.8,
});

async function openModePath(page, modePath) {
    await page.evaluate((targetModePath) => {
        const game = globalThis.GAME_INSTANCE;
        if (!game?.settings) return;
        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = String(targetModePath || 'normal').trim().toLowerCase() || 'normal';
        const changedKeys = [
            'session.type',
            'session.modePath',
            'session.gameMode',
            'session.hunt.respawnEnabled',
            'mapKey',
        ];
        game.settingsManager?.applyMenuCompatibilityRules?.(game.settings, { changedKeys });
        game.uiManager?.syncByChangeKeys?.(changedKeys);
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
            trigger: 'desktop_allmaps_mode_setup',
            modePath: game.settings.localSettings.modePath,
        });
    }, modePath);
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10000 });
    await openStartSetupSection(page, 'match');
}

async function listVisibleMapKeys(page) {
    return page.evaluate(() => {
        const select = document.getElementById('map-select');
        if (!(select instanceof HTMLSelectElement)) return [];
        return Array.from(select.options)
            .map((option) => String(option.value || '').trim())
            .filter((value) => value && value !== 'custom');
    });
}

async function seedGhostForMapAndEnableSelfDuel(page, { modePath, mapKey }) {
    return page.evaluate(async ({ modePath, mapKey, seededGhostClip }) => {
        const game = globalThis.GAME_INSTANCE;
        if (!game?.settings) {
            return { ok: false, reason: 'missing_game' };
        }

        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        if (!game.settings.localSettings.startSetup || typeof game.settings.localSettings.startSetup !== 'object') {
            game.settings.localSettings.startSetup = {};
        }

        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = modePath;
        game.settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
        game.settings.mapKey = mapKey;

        const mapSelect = document.getElementById('map-select');
        if (mapSelect instanceof HTMLSelectElement) {
            mapSelect.value = mapKey;
            mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const changedKeys = [
            'session.type',
            'session.modePath',
            'session.gameMode',
            'session.hunt.respawnEnabled',
            'mapKey',
            'startSetup.arcadeGhostDuelMode',
        ];
        game.settingsManager?.applyMenuCompatibilityRules?.(game.settings, { changedKeys });
        await Promise.resolve(game.runtimeFacade?.onSettingsChanged?.({ changedKeys }));
        game.uiManager?.syncByChangeKeys?.(changedKeys);

        const routeId = String(
            game?.config?.MAPS?.[mapKey]?.parcours?.routeId
            || game?.arena?.currentMapDefinition?.parcours?.routeId
            || mapKey
        ).trim();
        if (!routeId) {
            return { ok: false, reason: 'missing_route', mapKey };
        }

        const seedResult = game.runtimeFacade?.applyArcadeParcoursEvent?.({
            type: 'finish',
            routeId,
            routeAliases: routeId === mapKey ? [] : [mapKey],
            totalTimeMs: 3800,
            penaltyTimeMs: 0,
            segmentSplitsMs: [],
            ghostClip: seededGhostClip,
            persistLibraryOnly: true,
            source: 'desktop_allmaps_seed',
        });
        if (!seedResult?.longestGhostUpdated && seedResult?.longestGhostReason !== 'not_longer') {
            return {
                ok: false,
                reason: `runtime_seed_failed:${seedResult?.longestGhostReason || 'missing_result'}`,
                mapKey,
                routeId,
            };
        }

        return { ok: true, routeId };
    }, {
        modePath,
        mapKey,
        seededGhostClip: SEEDED_GHOST_CLIP,
    });
}

async function waitForMatchStart(page) {
    return page.waitForFunction(() => {
        const game = globalThis.GAME_INSTANCE;
        if (game?.state === 'PLAYING') return 'playing';
        if (game?.state === 'PAUSED') return 'paused';
        const pendingStart = game?.runtimeFacade?.sessionHandler?._pendingStartMatch;
        return pendingStart ? false : 'settled_without_playing';
    }, null, { timeout: 60000 }).then((handle) => handle.jsonValue()).catch(() => 'timeout');
}

async function readGhostRuntimeState(page) {
    return page.evaluate(() => {
        const game = globalThis.GAME_INSTANCE;
        const ghostState = game?.entityManager?.getLastRoundGhostState?.();
        return {
            active: ghostState?.active === true,
            entryCount: Number(ghostState?.entryCount || 0),
            frameCount: Number(ghostState?.frameCount || 0),
            trailCount: Number(ghostState?.trailCount || 0),
            trailPointCount: Number(ghostState?.trailPointCount || 0),
            trailSegmentCount: Number(ghostState?.trailSegmentCount || 0),
            configuredMode: String(game?.settings?.localSettings?.startSetup?.arcadeGhostDuelMode || ''),
            runtimeMode: String(game?.runtimeConfig?.arcade?.ghostDuelMode || ''),
            sessionType: String(game?.settings?.localSettings?.sessionType || ''),
            modePath: String(game?.settings?.localSettings?.modePath || ''),
            currentMapKey: String(game?.arena?.currentMapKey || ''),
            currentRouteId: String(game?.arena?.currentMapDefinition?.parcours?.routeId || ''),
        };
    });
}

test('Ghost-Selbstduell funktioniert im Desktop-Electron in Single normal/fight/arcade auf allen sichtbaren Maps', async ({ page }) => {
    const modePaths = resolveModePathsFromEnv();
    const timeoutPerModeMs = 900000;
    test.setTimeout(Math.max(900000, timeoutPerModeMs * modePaths.length));
    await loadGame(page);

    const failures = [];

    for (let modeIndex = 0; modeIndex < modePaths.length; modeIndex += 1) {
        const modePath = modePaths[modeIndex];
        await openModePath(page, modePath);
        const mapKeys = await listVisibleMapKeys(page);
        expect(mapKeys.length, `Keine Maps sichtbar fuer modePath=${modePath}`).toBeGreaterThan(0);

        for (let mapIndex = 0; mapIndex < mapKeys.length; mapIndex += 1) {
            const mapKey = mapKeys[mapIndex];
            try {
                const seedResult = await seedGhostForMapAndEnableSelfDuel(page, { modePath, mapKey });
                if (!seedResult.ok) {
                    failures.push({
                        modePath,
                        mapKey,
                        reason: `seed_failed:${seedResult.reason || 'unknown'}`,
                    });
                    continue;
                }

                await page.click('#submenu-game:not(.hidden) #btn-start', { force: true });
                const startState = await waitForMatchStart(page);
                if (startState !== 'playing') {
                    const menuState = await page.evaluate(() => {
                        const game = globalThis.GAME_INSTANCE;
                        return {
                            gameState: String(game?.state || ''),
                            startValidationIssue: game?.uiManager?.resolveStartValidationIssue?.() || null,
                            mapKey: String(game?.settings?.mapKey || ''),
                            modePath: String(game?.settings?.localSettings?.modePath || ''),
                            sessionType: String(game?.settings?.localSettings?.sessionType || ''),
                        };
                    });
                    failures.push({
                        modePath,
                        mapKey,
                        routeId: seedResult.routeId || '',
                        reason: 'start_timeout_not_playing',
                        startState,
                        menuState,
                    });
                    continue;
                }

                const playbackActive = await page.waitForFunction(() => {
                    const game = globalThis.GAME_INSTANCE;
                    const ghostState = game?.entityManager?.getLastRoundGhostState?.();
                    return ghostState?.active === true
                        && Number(ghostState?.entryCount || 0) > 0
                        && Number(ghostState?.trailCount || 0) > 0
                        && Number(ghostState?.trailSegmentCount || 0) > 0;
                }, null, { timeout: 12000 }).then(() => true).catch(() => false);

                const runtimeState = await readGhostRuntimeState(page);
                const hasActiveGhostState = runtimeState.active
                    && runtimeState.entryCount > 0
                    && runtimeState.trailCount > 0
                    && runtimeState.trailSegmentCount > 0;
                if (!(playbackActive || hasActiveGhostState)) {
                    failures.push({
                        modePath,
                        mapKey,
                        routeId: seedResult.routeId || '',
                        reason: 'playback_or_trail_inactive',
                        playbackActive,
                        runtimeState,
                    });
                }
            } finally {
                await returnToMenu(page);
                await openStartSetupSection(page, 'match');
            }
        }
    }

    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
