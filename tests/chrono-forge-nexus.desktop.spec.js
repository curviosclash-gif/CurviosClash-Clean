import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('Chrono-Forge Nexus loads and advances all eight Blender loops on desktop', async ({ page }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'chrono_forge_nexus');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'chrono_forge_nexus'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'chrono_forge_nexus'
        && window.GAME_INSTANCE?.arena?._glbAnimationMixers?.length === 8
    ), null, { timeout: 30000 });

    const before = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimationMixers.map((mixer) => mixer.time)
    ));
    await expect.poll(
        () => page.evaluate((baseline) => {
            const game = window.GAME_INSTANCE;
            const mixers = game?.arena?._glbAnimationMixers || [];
            return game?.state === 'PLAYING'
                && mixers.length === baseline.length
                && mixers.every((mixer, index) => mixer.time > baseline[index]);
        }, before),
        {
            message: 'all Chrono-Forge animation mixers should advance after match start',
            timeout: 5000,
        }
    ).toBeTruthy();
    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            mixerTimes: arena._glbAnimationMixers.map((mixer) => mixer.time),
            loadError: arena._glbLoadError,
            warnings: arena._glbLoadWarnings,
            colliderMode: arena._glbFootprint?.colliderMode,
        };
    });

    expect(state.mapKey).toBe('chrono_forge_nexus');
    expect(state.loadError).toBeNull();
    expect(state.warnings).toEqual([]);
    expect(state.colliderMode).toBe('dynamic');
    expect(state.mixerTimes).toHaveLength(8);
    expect(state.mixerTimes.every((time, index) => time > before[index])).toBeTruthy();

    // The moving setpieces must carry collision with them instead of leaving a hitbox
    // behind at the pose they were authored in.
    const probe = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const centerOf = (box) => ({
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
        });
        return arena._glbDynamicObstacles.map((obstacle, index) => ({
            index,
            center: centerOf(obstacle.box),
        }));
    });
    expect(probe.length).toBeGreaterThan(0);

    await expect.poll(
        () => page.evaluate((baseline) => {
            const arena = window.GAME_INSTANCE.arena;
            const centerOf = (box) => ({
                x: (box.min.x + box.max.x) / 2,
                y: (box.min.y + box.max.y) / 2,
                z: (box.min.z + box.max.z) / 2,
            });
            return baseline.some((entry) => {
                const obstacle = arena._glbDynamicObstacles[entry.index];
                if (!obstacle) return false;
                const current = centerOf(obstacle.box);
                const travelled = Math.hypot(
                    current.x - entry.center.x,
                    current.y - entry.center.y,
                    current.z - entry.center.z,
                );
                if (travelled < 1) return false;
                // Solid where the mesh is now, free where it used to be.
                return arena.checkCollisionFast(current, 0.5)
                    && !arena.checkCollisionFast(entry.center, 0.5);
            });
        }, probe),
        {
            message: 'an animated setpiece should collide at its current pose and no longer at its old one',
            timeout: 20000,
        }
    ).toBeTruthy();
});
