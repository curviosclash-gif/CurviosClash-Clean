import {
    test,
    expect,
    loadGame,
    openStartSetupSection,
    returnToMenu,
} from './core-targeted.shared.js';

const MODE_PATHS = ['normal', 'fight', 'arcade'];

async function openModePath(page, modePath) {
    await page.evaluate((targetModePath) => {
        const game = globalThis.GAME_INSTANCE;
        if (!game?.settings) return;
        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = String(targetModePath || 'normal').trim().toLowerCase() || 'normal';
        if (!game.settings.localSettings.startSetup || typeof game.settings.localSettings.startSetup !== 'object') {
            game.settings.localSettings.startSetup = {};
        }
        game.settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
        const changedKeys = [
            'session.type',
            'session.modePath',
            'session.gameMode',
            'session.hunt.respawnEnabled',
            'startSetup.arcadeGhostDuelMode',
            'mapKey',
        ];
        game.settingsManager?.applyMenuCompatibilityRules?.(game.settings, { changedKeys });
        game.uiManager?.syncByChangeKeys?.(changedKeys);
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
            trigger: 'desktop_roundtrip_mode_setup',
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

async function selectMapAndEnableGhost(page, modePath, mapKey) {
    return page.evaluate(({ modePath: nextModePath, mapKey: nextMapKey }) => {
        const game = globalThis.GAME_INSTANCE;
        if (!game?.settings) return { ok: false, reason: 'missing_game' };
        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        if (!game.settings.localSettings.startSetup || typeof game.settings.localSettings.startSetup !== 'object') {
            game.settings.localSettings.startSetup = {};
        }
        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = String(nextModePath || 'normal').trim().toLowerCase() || 'normal';
        game.settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
        game.settings.mapKey = nextMapKey;

        const mapSelect = document.getElementById('map-select');
        if (mapSelect instanceof HTMLSelectElement) {
            mapSelect.value = nextMapKey;
            mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        game.uiManager?.syncByChangeKeys?.([
            'session.type',
            'session.modePath',
            'session.gameMode',
            'session.hunt.respawnEnabled',
            'startSetup.arcadeGhostDuelMode',
            'mapKey',
        ]);

        const arenaRouteId = String(game?.arena?.currentMapDefinition?.parcours?.routeId || '').trim();
        const settingsMapKey = String(game?.settings?.mapKey || '').trim();
        return {
            ok: true,
            routeHint: arenaRouteId || settingsMapKey || nextMapKey,
            settingsMapKey,
            modePath: String(game?.settings?.localSettings?.modePath || ''),
        };
    }, { modePath, mapKey });
}

async function triggerRoundEndForPersistence(page) {
    return page.evaluate(() => {
        const game = globalThis.GAME_INSTANCE;
        const players = Array.isArray(game?.entityManager?.players) ? game.entityManager.players : [];
        const winner = players.find((entry) => entry && entry.isBot !== true) || players[0] || null;
        const preGhostState = game?.entityManager?.getLastRoundGhostState?.() || null;
        const preRecorder = game?.recorder?.getLastRoundMetrics?.() || null;
        const preRecorderDebug = {
            shouldCaptureFrames: game?.recorder?.shouldCaptureFrames?.() === true,
            frameCaptureEnabled: game?.recorder?.isFrameCaptureEnabled?.() === true,
            snapshotCount: Number(game?.recorder?._snapshotStore?.snapshotCount || 0),
            frameCounter: Number(game?.recorder?._frameCounter || 0),
            orderedSnapshotCount: Array.isArray(game?.recorder?._snapshotStore?.getOrderedSnapshots?.())
                ? game.recorder._snapshotStore.getOrderedSnapshots().length
                : 0,
            roundStartTime: Number(game?.recorder?.roundStartTime || 0),
        };
        game?.matchFlowUiController?.onRoundEnd?.(winner, { reason: 'ELIMINATION' });
        const postRecorder = game?.recorder?.getLastRoundMetrics?.() || null;
        const postRecorderDebug = {
            shouldCaptureFrames: game?.recorder?.shouldCaptureFrames?.() === true,
            frameCaptureEnabled: game?.recorder?.isFrameCaptureEnabled?.() === true,
            snapshotCount: Number(game?.recorder?._snapshotStore?.snapshotCount || 0),
            frameCounter: Number(game?.recorder?._frameCounter || 0),
            orderedSnapshotCount: Array.isArray(game?.recorder?._snapshotStore?.getOrderedSnapshots?.())
                ? game.recorder._snapshotStore.getOrderedSnapshots().length
                : 0,
            roundStartTime: Number(game?.recorder?.roundStartTime || 0),
        };
        const storageRaw = localStorage.getItem('cuviosclash.arcade-ghost-library.v1');
        let storageEntries = 0;
        try {
            const parsed = JSON.parse(storageRaw || '{}');
            storageEntries = parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;
        } catch {
            storageEntries = -1;
        }
        return {
            gameState: String(game?.state || ''),
            preGhostState,
            preRecorder,
            preRecorderDebug,
            postRecorder,
            postRecorderDebug,
            storageEntries,
        };
    });
}

async function readPlaybackDebug(page) {
    return page.evaluate(() => {
        const game = globalThis.GAME_INSTANCE;
        const ghostState = game?.entityManager?.getLastRoundGhostState?.() || null;
        let librarySize = 0;
        let libraryKeys = [];
        try {
            const parsed = JSON.parse(localStorage.getItem('cuviosclash.arcade-ghost-library.v1') || '{}');
            libraryKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
            librarySize = libraryKeys.length;
        } catch {
            libraryKeys = [];
            librarySize = -1;
        }
        return {
            modePath: String(game?.settings?.localSettings?.modePath || ''),
            sessionType: String(game?.settings?.localSettings?.sessionType || ''),
            configuredGhostMode: String(game?.settings?.localSettings?.startSetup?.arcadeGhostDuelMode || ''),
            runtimeGhostMode: String(game?.runtimeConfig?.arcade?.ghostDuelMode || ''),
            settingsMapKey: String(game?.settings?.mapKey || ''),
            arenaMapKey: String(game?.arena?.currentMapKey || ''),
            arenaRouteId: String(game?.arena?.currentMapDefinition?.parcours?.routeId || ''),
            ghostState,
            librarySize,
            libraryKeys,
        };
    });
}

test('Ghost-Selbstduell Roundtrip persistiert und spielt auf Desktop-Electron in Single normal/fight/arcade ab', async ({ page }) => {
    test.setTimeout(900000);
    await loadGame(page);
    const failures = [];

    for (let modeIndex = 0; modeIndex < MODE_PATHS.length; modeIndex += 1) {
        const modePath = MODE_PATHS[modeIndex];
        await openModePath(page, modePath);
        const mapKeys = await listVisibleMapKeys(page);
        expect(mapKeys.length, `Keine Maps sichtbar fuer modePath=${modePath}`).toBeGreaterThan(0);
        const mapKey = mapKeys[0];

        const selection = await selectMapAndEnableGhost(page, modePath, mapKey);
        if (!selection.ok) {
            failures.push({ modePath, mapKey, reason: `selection_failed:${selection.reason || 'unknown'}` });
            continue;
        }

        await page.click('#submenu-game:not(.hidden) #btn-start', { force: true });
        const startedFirst = await page.waitForFunction(
            () => globalThis.GAME_INSTANCE?.state === 'PLAYING',
            null,
            { timeout: 20000 }
        ).then(() => true).catch(() => false);
        if (!startedFirst) {
            failures.push({ modePath, mapKey, reason: 'first_start_timeout' });
            await returnToMenu(page);
            continue;
        }

        await page.waitForTimeout(3500);
        const roundEndResult = await triggerRoundEndForPersistence(page);
        await page.waitForFunction(
            () => ['ROUND_END', 'MATCH_END'].includes(String(globalThis.GAME_INSTANCE?.state || '')),
            null,
            { timeout: 10000 }
        ).catch(() => {});
        await returnToMenu(page);

        await openModePath(page, modePath);
        await selectMapAndEnableGhost(page, modePath, mapKey);
        await page.click('#submenu-game:not(.hidden) #btn-start', { force: true });
        const startedSecond = await page.waitForFunction(
            () => globalThis.GAME_INSTANCE?.state === 'PLAYING',
            null,
            { timeout: 20000 }
        ).then(() => true).catch(() => false);
        if (!startedSecond) {
            const debug = await readPlaybackDebug(page);
            failures.push({
                modePath,
                mapKey,
                reason: 'second_start_timeout',
                roundEndResult,
                debug,
            });
            await returnToMenu(page);
            continue;
        }

        const playbackActive = await page.waitForFunction(() => {
            const game = globalThis.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.();
            return ghostState?.active === true
                && Number(ghostState?.entryCount || 0) > 0
                && Number(ghostState?.trailCount || 0) > 0
                && Number(ghostState?.trailSegmentCount || 0) > 0;
        }, null, { timeout: 6000 }).then(() => true).catch(() => false);

        if (!playbackActive) {
            const debug = await readPlaybackDebug(page);
            failures.push({
                modePath,
                mapKey,
                reason: 'playback_or_trail_inactive_after_roundtrip',
                roundEndResult,
                debug,
            });
        }

        await returnToMenu(page);
    }

    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
