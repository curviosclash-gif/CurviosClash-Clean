import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('Angriffsparcours starts on desktop with checkpoints, bots, MG and rockets', async ({ page }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'parcours_assault');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'parcours_assault'
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
        window.GAME_INSTANCE?.arena?.currentMapKey === 'parcours_assault'
        && window.GAME_INSTANCE?.arena?.checkpointRings?.length === 10
        && window.GAME_INSTANCE?.entityManager?.bots?.length === 4
        && window.GAME_INSTANCE?.entityManager?._staticTurretSystem?.turrets?.length === 4
    ), null, { timeout: 20000 });

    await page.evaluate(() => {
        window.GAME_INSTANCE?.entityManager?._staticTurretSystem?.update?.(2);
    });

    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game?.entityManager;
        return {
            mapKey: game?.arena?.currentMapKey || '',
            routeId: manager?.getParcoursRouteSnapshot?.()?.routeId || '',
            checkpointRingCount: game?.arena?.checkpointRings?.length || 0,
            botCount: manager?.bots?.length || 0,
            aliveBotCount: manager?.bots?.filter((entry) => entry?.player?.alive)?.length || 0,
            botRoles: manager?.bots?.map((entry) => entry?.player?.scenarioRole || '') || [],
            turretCount: manager?._staticTurretSystem?.turrets?.length || 0,
            turretShots: manager?._staticTurretSystem?.turrets
                ?.reduce((total, entry) => total + (entry?.shotsFired || 0), 0) || 0,
            modeType: manager?.gameModeStrategy?.modeType || '',
            hasMachineGun: manager?.gameModeStrategy?.hasMachineGun?.() === true,
            rocketPickups: game?.arena?.getAuthoredItemAnchors?.()
                ?.filter((entry) => String(entry?.pickupType || '').startsWith('ROCKET_'))
                .map((entry) => entry.pickupType) || [],
        };
    });

    expect(state.mapKey).toBe('parcours_assault');
    expect(state.routeId).toBe('assault_mg_rockets_v2');
    expect(state.checkpointRingCount).toBe(10);
    expect(state.botCount).toBe(4);
    expect(state.aliveBotCount).toBe(4);
    expect(state.botRoles).toEqual(['guard', 'flanker', 'pursuer', 'interceptor']);
    expect(state.turretCount).toBe(4);
    expect(state.turretShots).toBeGreaterThan(0);
    expect(state.modeType).toBe('HUNT');
    expect(state.hasMachineGun).toBeTruthy();
    expect(state.rocketPickups).toEqual(['ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA']);
});
