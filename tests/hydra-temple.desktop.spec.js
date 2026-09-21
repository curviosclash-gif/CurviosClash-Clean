import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';

test('Hydra-Tempelring starts a three-bot Hunt with independent static and animated GLBs', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await expect(page.locator('#map-select option[value="hydra_temple"]')).toHaveCount(1);
    await page.selectOption('#map-select', 'hydra_temple');
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.arena?.currentMapKey === 'hydra_temple'
        && window.GAME_INSTANCE?.entityManager?._mapUnitSystem?.units?.length === 1,
    null, { timeout: 120_000 });

    await expect.poll(() => page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const unit = game?.entityManager?._mapUnitSystem?.units?.[0];
        return !!unit?.root?.userData?.hydra?.model
            && (game?.arena?._glbScene?.children?.length || 0) >= 1;
    }), { timeout: 60_000 }).toBe(true);

    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const unit = game.entityManager._mapUnitSystem.units[0];
        const visual = unit.root.userData.hydra;
        return {
            mode: game.activeGameMode,
            bots: game.entityManager.players.filter((player) => player.isBot).length,
            species: unit.definition.species,
            hp: unit.hp,
            sockets: visual.sockets.filter(Boolean).length,
            clips: [...visual.clips.keys()].sort(),
            fallbackVisible: visual.fallback.visible,
            mapLoadError: !!game.arena._glbLoadError,
        };
    });
    expect(state.mode).toBe('HUNT');
    expect(state.bots).toBe(3);
    expect(state.species).toBe('hydra_v3');
    expect(state.hp).toBe(600);
    expect(state.sockets).toBe(5);
    expect(state.clips).toEqual([
        'Idle', 'Snap_1', 'Snap_2', 'Snap_3', 'Snap_4', 'Snap_5',
        'Spit_1', 'Spit_2', 'Spit_3', 'Spit_4', 'Spit_5', 'Walk',
    ]);
    expect(state.fallbackVisible).toBe(false);
    expect(state.mapLoadError).toBe(false);
});
