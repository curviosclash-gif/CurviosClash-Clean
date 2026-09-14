import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const PROFILES = [
    {
        mapKey: 'magma_maze',
        normalNear: 30,
        normalFar: 130,
        fogNear: 10,
        fogFar: 130 / 3,
    },
    {
        mapKey: 'burg_falkenwacht_arena',
        normalNear: 450,
        normalFar: 600,
        fogNear: 5,
        fogFar: 20,
    },
];

async function startSplitScreenFight(page, mapKey) {
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.selectOption('#map-select', mapKey);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((expectedMapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === expectedMapKey
            && game?.entityManager?.humanPlayers?.length === 2;
    }, mapKey, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);
}

for (const profile of PROFILES) {
    test(`${profile.mapKey}: global fog renders for every split-screen player and restores the map`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await startSplitScreenFight(page, profile.mapKey);

        const active = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const renderer = game.renderer;
            renderer.setViewDistance(0);
            const normalFogColor = renderer.scene.fog.color.getHex();
            const player = manager.humanPlayers[0];
            player.inventory = ['FOG'];
            player.selectedItemIndex = 0;
            player.itemUseCooldownRemaining = 0;
            const result = manager.runtimePorts.combat.huntCombatSystem.useInventoryItem(player, 0);
            const highAltitudeRenderErrors = [];
            for (const camera of renderer.cameras) {
                camera.position.y = 600;
                camera.updateMatrixWorld(true);
                renderer.renderer.render(renderer.scene, camera);
                highAltitudeRenderErrors.push(renderer.renderer.getContext().getError());
            }
            return {
                used: result.ok,
                inventory: player.inventory.slice(),
                state: manager.getGlobalFogState(),
                fogNear: renderer.scene.fog.near,
                fogFar: renderer.scene.fog.far,
                fogColor: renderer.scene.fog.color.getHex(),
                normalFogColor,
                highAltitudeRenderErrors,
                humanCount: manager.humanPlayers.length,
                cameraCount: renderer.cameras.length,
                viewportLayout: renderer.viewportLayout,
            };
        });

        expect(active.used).toBe(true);
        expect(active.inventory).toEqual([]);
        expect(active.state.active).toBe(true);
        expect(active.state.remainingSeconds).toBeGreaterThan(7);
        expect(active.state.visibilityRange).toBeCloseTo(profile.fogFar, 5);
        expect(active.fogNear).toBeCloseTo(profile.fogNear, 5);
        expect(active.fogFar).toBeCloseTo(profile.fogFar, 5);
        expect(active.fogColor).toBe(active.normalFogColor);
        expect(active.highAltitudeRenderErrors).toEqual(Array(active.cameraCount).fill(0));
        expect(active.humanCount).toBe(2);
        expect(active.cameraCount).toBeGreaterThanOrEqual(2);
        expect(active.viewportLayout).not.toBe('single');

        await page.waitForFunction(() => (
            document.querySelectorAll('.active-effect-badge[data-type="FOG"]').length >= 2
        ));
        const badges = page.locator('.active-effect-badge[data-type="FOG"]');
        await expect(badges).toHaveCount(2);
        await expect(badges.first()).toContainText('Nebel');
        await page.screenshot({ path: testInfo.outputPath(`${profile.mapKey}-global-fog.png`) });

        const restored = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const system = game.entityManager._globalFogEffectSystem;
            system.update(system.remainingSeconds);
            return {
                state: system.getState(),
                fogNear: game.renderer.scene.fog.near,
                fogFar: game.renderer.scene.fog.far,
            };
        });
        expect(restored.state.active).toBe(false);
        expect(restored.state.remainingSeconds).toBe(0);
        expect(restored.fogNear).toBeCloseTo(profile.normalNear, 5);
        expect(restored.fogFar).toBeCloseTo(profile.normalFar, 5);
        expect(errors).toHaveLength(0);
    });
}

test('four-player planar HUD shows the shared fog timer to all four players', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    if (!await page.locator('#four-player-planar-setup').isVisible()) {
        await page.locator('#btn-four-player-planar').click({ force: true });
    }
    await page.locator('[data-four-player-planar-mode]').selectOption('classic');
    await page.locator('[data-four-player-planar-bots]').evaluate((element) => {
        element.value = '0';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('[data-four-player-planar-start]').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 4);

    const used = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const player = manager.humanPlayers[0];
        player.inventory = ['FOG'];
        player.selectedItemIndex = 0;
        return manager.runtimePorts.combat.huntCombatSystem.useInventoryItem(player, 0).ok;
    });
    expect(used).toBe(true);
    await page.waitForFunction(() => (
        Array.from(document.querySelectorAll('#four-player-planar-hud [data-fpp-item]'))
            .filter((node) => node.textContent.includes('Nebel')).length === 4
    ));
    const rows = page.locator('#four-player-planar-hud [data-fpp-item]');
    await expect(rows).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) await expect(rows.nth(index)).toContainText('Nebel');

    await page.evaluate(() => {
        const system = window.GAME_INSTANCE.entityManager._globalFogEffectSystem;
        system.update(system.remainingSeconds);
    });
    await page.waitForFunction(() => (
        Array.from(document.querySelectorAll('#four-player-planar-hud [data-fpp-item]'))
            .every((node) => !node.textContent.includes('Nebel'))
    ));
    expect(errors).toHaveLength(0);
});
