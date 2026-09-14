import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

async function startFight(page) {
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 2, null, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);
}

test('Fight renders marked fan pickups, odd/even rocket fans and a capped twelve-shot MG fan', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await startFight(page);

    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const player = manager.humanPlayers[0];
        const powerups = manager.powerupManager;
        const projectileSystem = manager._projectileSystem;
        const forward = player.getAimDirection(player._tmpDir).clone().normalize();
        const right = forward.clone().set(1, 0, 0).applyQuaternion(player.quaternion).normalize();

        const pickup = powerups.spawnAtAnchor({
            ownerId: 'fan-pickup-proof',
            type: 'FAN_3',
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
        });
        const pickupResult = powerups.checkPickup(
            player.position,
            player.hitboxRadius,
            (type) => player.addToInventory(type)
        );
        player.selectedItemIndex = 0;
        player.itemUseCooldownRemaining = 0;
        const useResult = manager._huntCombatSystem.useInventoryItem(player, 0);

        const fireRocket = (fanType) => {
            player.activeEffects.length = 0;
            player.applyPowerup(fanType);
            player.inventory = [];
            player.rocketInventory = ['ROCKET_WEAK'];
            player.selectedItemIndex = 0;
            player.shootCooldown = 0;
            projectileSystem.clear();
            const shot = manager._huntCombatSystem.shootItemProjectile(player, -1, true);
            return {
                shot,
                directions: projectileSystem.projectiles.map((projectile) => (
                    projectile.velocity.clone().normalize().toArray()
                )),
            };
        };
        const odd = fireRocket('FAN_3');
        const even = fireRocket('FAN_4');

        player.activeEffects.length = 0;
        player.applyPowerup('FAN_3');
        player.applyPowerup('FAN_4');
        player.applyPowerup('FAN_5');
        player.applyPowerup('FAN_5');
        const tracerBefore = manager._overheatGunSystem._tracers.length;
        const mgResults = [];
        for (let i = 0; i < 3; i += 1) {
            player.shootCooldown = 0;
            mgResults.push(manager._overheatGunSystem.tryFire(player));
        }

        const showcase = ['FAN_3', 'FAN_4', 'FAN_5'].map((type, index) => {
            const position = player.position.clone()
                .addScaledVector(forward, 9)
                .addScaledVector(right, (index - 1) * 4);
            const item = powerups.spawnAtAnchor({
                ownerId: `fan-showcase-${index}`,
                type,
                x: position.x,
                y: position.y,
                z: position.z,
            });
            return {
                type,
                markerText: item?.mesh?.userData?.markerText,
                fanProjectiles: item?.mesh?.userData?.fanProjectiles,
                labelCount: item?.mesh?.children?.filter((child) => child.userData?.weaponFanLabel).length || 0,
                color: item?.mesh?.children?.find((child) => child.material?.color)?.material.color.getHex(),
            };
        });

        const offsets = (directions) => directions.map(([x, y, z]) => {
            const direction = forward.clone().set(x, y, z);
            const dot = Math.max(-1, Math.min(1, direction.dot(forward)));
            const sign = Math.sign(direction.dot(right)) || 1;
            return Math.acos(dot) * 180 / Math.PI * sign;
        });
        return {
            pickupSpawned: !!pickup,
            pickupCollected: pickupResult?.ok === true,
            activated: useResult.ok,
            odd: { count: odd.directions.length, offsets: offsets(odd.directions) },
            even: { count: even.directions.length, offsets: offsets(even.directions) },
            mgCounts: mgResults.map((entry) => entry.projectileCount),
            tracerDelta: manager._overheatGunSystem._tracers.length - tracerBefore,
            activeEffects: player.activeEffects.map((effect) => ({ type: effect.type, remaining: effect.remaining })),
            showcase,
        };
    });

    expect(result.pickupSpawned).toBe(true);
    expect(result.pickupCollected).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.odd.count).toBe(3);
    expect(result.odd.offsets[0]).toBeCloseTo(-15, 4);
    expect(result.odd.offsets[1]).toBeCloseTo(0, 4);
    expect(result.odd.offsets[2]).toBeCloseTo(15, 4);
    expect(result.even.count).toBe(4);
    expect(result.even.offsets[0]).toBeCloseTo(-15, 4);
    expect(result.even.offsets[1]).toBeCloseTo(-5, 4);
    expect(result.even.offsets[2]).toBeCloseTo(5, 4);
    expect(result.even.offsets[3]).toBeCloseTo(15, 4);
    expect(result.mgCounts).toEqual([12, 12, 12]);
    expect(result.tracerDelta).toBe(36);
    expect(result.activeEffects.every((effect) => effect.remaining === 40)).toBe(true);
    expect(result.showcase.map((entry) => entry.markerText)).toEqual(['×3', '×4', '×5']);
    expect(result.showcase.map((entry) => entry.fanProjectiles)).toEqual([3, 4, 5]);
    expect(result.showcase.every((entry) => entry.labelCount === 1)).toBe(true);
    expect(new Set(result.showcase.map((entry) => entry.color)).size).toBe(3);

    await page.waitForFunction(() => document.querySelector(
        '.active-effect-badge[data-type="WEAPON_FAN_TOTAL"]'
    )?.textContent.includes('×12'));
    await expect(page.locator('.active-effect-badge[data-type="WEAPON_FAN_TOTAL"]').first()).toContainText('Fächer gesamt');
    for (const type of ['FAN_3', 'FAN_4', 'FAN_5']) {
        await expect(page.locator(`.active-effect-badge[data-type="${type}"]`).first()).toContainText('s');
    }
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const player = manager.humanPlayers[0];
        player.shootCooldown = 0;
        manager._overheatGunSystem.tryFire(player);
    });
    await waitForRenderFrames(page, 2);
    await page.screenshot({ path: testInfo.outputPath('weapon-fan-pickups.png') });
    expect(errors.filter((message) => !message.includes('/assets/maps/maze/glb/01_world.glb'))).toHaveLength(0);
});
