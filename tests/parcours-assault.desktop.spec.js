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

    const turretExercise = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game?.entityManager;
        const system = manager?._staticTurretSystem;
        const target = manager?.humanPlayers?.[0];
        const turret = system?.turrets?.find((entry) => entry?.weapon === 'mg');
        const arena = game?.arena;
        if (!system || !target?.position || !turret?.position || !arena?.checkCollisionFast) {
            return { positioned: false, shotsFired: 0 };
        }

        const radii = [0.25, 0.4, 0.55].map((ratio) => Math.max(6, turret.range * ratio));
        const lineProbe = turret.position.clone();
        let positioned = false;
        for (const radius of radii) {
            for (let angleIndex = 0; angleIndex < 24; angleIndex += 1) {
                const angle = (Math.PI * 2 * angleIndex) / 24;
                const x = turret.position.x + Math.cos(angle) * radius;
                const y = turret.position.y;
                const z = turret.position.z + Math.sin(angle) * radius;
                target.position.set(x, y, z);
                if (arena.checkCollisionFast(target.position, 0.18)) continue;

                let blocked = false;
                const steps = Math.max(2, Math.ceil(radius / 0.5));
                for (let step = 1; step < steps; step += 1) {
                    lineProbe.lerpVectors(turret.position, target.position, step / steps);
                    if (arena.checkCollisionFast(lineProbe, 0.18)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) {
                    positioned = true;
                    break;
                }
            }
            if (positioned) break;
        }

        if (!positioned) return { positioned: false, shotsFired: 0 };
        target.spawnProtectionTimer = 0;
        target.velocity?.set?.(0, 0, 0);
        turret.cooldownRemaining = 0;
        turret.acquireRemaining = 0;
        turret.target = null;
        for (let tick = 0; tick < 30 && turret.shotsFired === 0; tick += 1) {
            system.update(0.1);
        }
        return { positioned: true, shotsFired: turret.shotsFired };
    });

    expect(turretExercise.positioned).toBeTruthy();
    expect(turretExercise.shotsFired).toBeGreaterThan(0);

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
