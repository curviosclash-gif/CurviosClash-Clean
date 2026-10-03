import { test, expect } from './helpers.desktop.js';
import { startGame } from './helpers.js';

test('altitude speed changes dive and climb travel while preserving horizontal speed and steering', async ({ page }) => {
    await startGame(page);

    const result = await page.evaluate(() => {
        const player = window.GAME_INSTANCE?.entityManager?.players?.[0];
        if (!player) return { error: 'player missing' };
        const dt = 1 / 60;
        const neutral = {};

        const fly = (direction, frames = 180) => {
            player.spawn(player.position, player._tmpDir.set(...direction));
            player.waterSubmerged = false;
            player.waterSpeedMultiplier = 1;
            player.position.set(0, 0, 0);
            const start = player.position.clone();
            for (let i = 0; i < frames; i += 1) player.update(dt, neutral, i, null, 1);
            return {
                distance: player.position.distanceTo(start),
                factor: player.altitudeSpeedFactor,
                speed: player.speed,
            };
        };

        const turnAngle = (direction) => {
            player.spawn(player.position, player._tmpDir.set(...direction));
            player.waterSubmerged = false;
            player.waterSpeedMultiplier = 1;
            const startingRotation = player.quaternion.clone();
            player.update(dt, { yawRight: true }, 0, null, 1);
            return startingRotation.angleTo(player.quaternion);
        };

        const horizontal = fly([0, 0, -1]);
        const dive = fly([0, -1, 0]);
        const climb = fly([0, 1, 0]);
        const levelTurnAngle = turnAngle([0, 0, -1]);
        const diveTurnAngle = turnAngle([0, -1, 0]);

        player.altitudeSpeedFactor = 1.08;
        player.spawn(player.position, player._tmpDir.set(0, 0, -1));

        return {
            horizontal,
            dive,
            climb,
            levelTurnAngle,
            diveTurnAngle,
            spawnResetFactor: player.altitudeSpeedFactor,
        };
    });

    expect(result.error).toBeUndefined();
    expect(result.horizontal.distance).toBeGreaterThan(0);
    expect(result.dive.distance).toBeGreaterThan(result.horizontal.distance * 1.08);
    expect(result.climb.distance).toBeLessThan(result.horizontal.distance * 0.92);
    expect(result.horizontal.factor).toBeCloseTo(1, 8);
    expect(result.dive.factor).toBeGreaterThan(1.09);
    expect(result.climb.factor).toBeLessThan(0.91);
    expect(result.diveTurnAngle).toBeCloseTo(result.levelTurnAngle, 8);
    expect(result.spawnResetFactor).toBe(1);
});
