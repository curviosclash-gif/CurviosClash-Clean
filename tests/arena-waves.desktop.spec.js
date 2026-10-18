import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType } from './helpers.js';
import { applyArenaWavesChoice } from '../src/shared/contracts/ArenaWavesContract.js';
import { EIFFEL_TOWER_SIEGE_MODELS } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeModels.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { listSkippedBreakSceneModelIds } from '../src/entities/arena/MapBreakSceneLoadPolicy.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';

async function startFiveFrontsFreeRun(page) {
    await waitForLoadedGame(page);
    await returnToMenu(page);
    await selectSessionType(page, 'single');
    const journey = page.getByRole('region', { name: 'Arcade-Reise', exact: true });
    await expect(journey).toBeVisible();
    await journey.locator('[data-journey-node="five_fronts"]').click();
    const card = journey.locator('[data-journey-stage="five_fronts"]');
    await card.getByLabel('Fünf Fronten: Wertung', { exact: true }).selectOption('free');
    const start = card.locator('[data-journey-start="five_fronts"]');
    await expect(start).toBeEnabled();
    await start.click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.runtimeConfig?.arcade?.runType === 'arena_waves');
}

// Controlled kill-event fixture for overlay/lifecycle integration; real combat is tested by MCP.
async function clearArenaFixture(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        const clearedMap = runtime.mapIndex;
        runtime.update(5); runtime.update(1);
        for (let wave = 0; wave < 2; wave++) {
            const activeSlots = [...runtime._activeSlots];
            if (!activeSlots.length) throw new Error(`Arena ${clearedMap + 1}, Welle ${wave + 1} spawned no bots`);
            for (const slot of activeSlots) {
                const victim = runtime.entityManager.bots[slot]?.player;
                if (!runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: victim?.index })) {
                    throw new Error(`Arena ${clearedMap + 1}, Welle ${wave + 1} did not credit bot slot ${slot}`);
                }
            }
            runtime.update(5);
            runtime.update(1);
        }
        return { clearedMap, completedWaves: runtime.mapStats[clearedMap]?.completedWaves,
            phase: runtime.phase, mapIndex: runtime.mapIndex };
    });
}

test('T-ARC-W3: Five Fronts starts with the selected Hangar MG', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    const seeded = await page.evaluate((profileKey) => {
        const game = window.GAME_INSTANCE;
        const store = game?.settingsManager?.getPlayerRecordStorePort?.();
        const vehicleId = String(game?.settings?.vehicles?.PLAYER_1 || 'ship5');
        const selectedMachineGunId = ['manta', 'spaceship'].includes(vehicleId) ? 'bastion_h3' : 'raptor_r9';
        const record = { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId, level: 10,
            xp: 10000, xpBank: 10000, mgLevel: 2, rocketLevel: 1, shieldLevel: 1,
            selectedMachineGunId };
        const result = store?.saveJsonRecord?.(profileKey, { [vehicleId]: record });
        return { ok: result?.success === true, vehicleId, selectedMachineGunId };
    }, ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    expect(seeded.ok).toBe(true);
    await startFiveFrontsFreeRun(page);
    await page.waitForFunction((gunId) => {
        const game = window.GAME_INSTANCE;
        const runtime = game?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        const human = game?.entityManager?.humanPlayers?.[0];
        return runtime?.upgrades?.machineGunId === gunId
            && human?.arcadeWeaponLoadout?.machineGunId === gunId
            && human?.arcadeWeaponLoadout?.mgLevel === 2;
    }, seeded.selectedMachineGunId, { timeout: 60_000 });
    // The tuning-to-damage factor is covered by tests/arcade-machine-gun-combat.contract.test.mjs.
    const loadout = await page.evaluate(() => window.GAME_INSTANCE.entityManager.humanPlayers[0].arenaWavesLoadout);
    expect(loadout?.machineGunId).toBe(seeded.selectedMachineGunId);
    expect(loadout?.mgTuning).toBe(0);
});

// This intentionally uses the runtime's test-visible arcade seam to avoid waiting
// for combat AI. It still exercises the production menu button and overlay clicks.
test('Five Fronts clears two waves per arena, retains upgrades across map rebuilds, and shows final results', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    await startFiveFrontsFreeRun(page);
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.phase !== 'idle' && runtime?.entityManager?.bots?.length === 24;
    }, null, { timeout: 60_000 });
    const started = await page.evaluate(() => {
        const game = window.GAME_INSTANCE; const runtime = game.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return { map: runtime?.mapIndex, slots: runtime?.entityManager?.bots?.length, endless: !!runtime?.entityManager?.endlessParcoursRuntime, nextWaveInSeconds: runtime?.getHudState?.().nextWaveInSeconds };
    });
    expect(started.map).toBe(0);
    expect(started.slots).toBe(24);
    expect(started.endless).toBe(false);
    expect(started.nextWaveInSeconds).toBeGreaterThan(0);

    expect(await clearArenaFixture(page)).toEqual({ clearedMap: 0, completedWaves: [1, 2], phase: 'upgrade', mapIndex: 1 });
    await page.waitForSelector('#arcade-overlay-panel:not(.hidden) .arcade-overlay-choice-btn');
    await expect(page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn')).toHaveCount(4);
    const upgradeIndex = await page.evaluate(() => {
        const choices = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().choices;
        const preferred = choices.findIndex((choice) => choice === 'mg_tuning' || choice.startsWith('machine_gun:'));
        return preferred >= 0 ? preferred : 0;
    });
    await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').nth(upgradeIndex).click();
    const retained = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().upgrades);
    expect(retained).toBeTruthy();

    await page.evaluate(async () => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.mapIndex === 1 && runtime?.phase === 'countdown'
            && runtime?.getHudState?.().currentMapKey === 'notre_dame_fire_arena';
    }, null, { timeout: 60_000 });
    const transitioned = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        return {
            mapIndex: runtime.mapIndex,
            mapKey: runtime.getHudState().currentMapKey,
            upgrades: runtime.getHudState().upgrades,
            managerRebuilt: runtime.entityManager !== null,
        };
    });
    expect(transitioned.mapIndex).toBe(1);
    expect(transitioned.mapKey).toBe('notre_dame_fire_arena');
    expect(transitioned.managerRebuilt).toBeTruthy();
    expect(transitioned.upgrades).toEqual(retained);

    expect(await clearArenaFixture(page)).toEqual({ clearedMap: 1, completedWaves: [1, 2], phase: 'upgrade', mapIndex: 2 });
    await expect(page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn')).toHaveCount(4);
    const secondChoice = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().choices[0]);
    await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').first().click();
    await page.evaluate(async () => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.mapIndex === 2
            && runtime?.phase === 'countdown'
            && runtime?.getHudState?.().currentMapKey === 'eiffel_tower_siege'
            && game?.arena?.currentMapKey === 'eiffel_tower_siege';
    }, null, { timeout: 360_000 });
    // Five Fronts is an Arcade run, where the tower cannot fall: the arena leaves the collapse
    // scenes out, so the loaded world is the map's models minus the ones the same policy skips.
    const policyConfig = await page.evaluate(() => {
        const config = window.GAME_INSTANCE.arena.runtimeConfig || {};
        return JSON.parse(JSON.stringify({ session: config.session, arcade: config.arcade }));
    });
    const skippedScenes = listSkippedBreakSceneModelIds(MAP_PRESET_CATALOG.eiffel_tower_siege, policyConfig);
    await page.waitForFunction((modelCount) => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?._glbLoadError == null && arena?._glbScene?.children?.length === modelCount;
    }, EIFFEL_TOWER_SIEGE_MODELS.filter((model) => !skippedScenes.has(model.id)).length, { timeout: 360_000 });

    expect((await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().upgrades)))
        .toEqual(applyArenaWavesChoice(retained, secondChoice));
    for (let mapIndex = 2; mapIndex < 5; mapIndex++) {
        expect(await clearArenaFixture(page)).toEqual({ clearedMap: mapIndex, completedWaves: [1, 2],
            phase: mapIndex === 4 ? 'finished' : 'upgrade', mapIndex: Math.min(4, mapIndex + 1) });
        if (mapIndex === 4) break;
        await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').first().click();
        await page.evaluate(async () => window.GAME_INSTANCE.runtimeFacade.restartRound());
        await page.waitForFunction(next => {
            const game = window.GAME_INSTANCE;
            const runtime = game.runtimeFacade._arcadeSupport.arenaWavesRuntime;
            return runtime.mapIndex === next && runtime.phase === 'countdown'
                && game.arena.currentMapKey === runtime.getHudState().currentMapKey;
        }, mapIndex + 1);
    }
    const maps = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport
        .arenaWavesRuntime.getHudState().postRunSummary.maps);
    expect(maps).toHaveLength(5);
    expect(maps.every(map => map.completedWaves.join(',') === '1,2')).toBe(true);
    await page.waitForSelector('#arcade-overlay-panel:not(.hidden)');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Fünf Fronten geschafft');
    await expect(page.locator('#arcade-overlay-panel button')).toBeFocused();
});
