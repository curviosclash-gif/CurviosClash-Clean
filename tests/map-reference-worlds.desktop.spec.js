import { writeFile } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test.describe.configure({ timeout: 180000 });

async function selectMap(page, mapKey) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', mapKey);
    await page.evaluate(() => {
        const slider = document.getElementById('bot-count');
        slider.value = '4';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.GAME_INSTANCE.settings.numBots === 4);
}

for (const mapKey of [
    'standard',
    'wind_cathedral',
    'chrono_forge_nexus',
    'maze',
    'complex',
    'pyramid',
    'vertical_maze',
    'trench',
]) {
    test(`${mapKey}: Blender world renders without duplicate fallback surfaces on desktop`, async ({ page }, testInfo) => {
        test.setTimeout(180000);
        await selectMap(page, mapKey);
        await page.click('#btn-start');
        await page.waitForFunction((key) => window.GAME_INSTANCE?.arena?.currentMapKey === key
            && window.GAME_INSTANCE?.arena?._glbScene, mapKey, { timeout: 45000 });
        const snapshot = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const renderer = game.renderer;
            const camera = renderer.cameras[0];
            const position = camera.position.clone();
            const rotation = camera.quaternion.clone();
            const shots = [];
            try {
                renderer.render();
                shots.push({ name: 'flight', data: renderer.renderer.domElement.toDataURL('image/png') });
                const size = arena.currentMapDefinition.size;
                const scale = arena.bounds.maxX / (size[0] / 2);
                const focus = arena.currentMapDefinition.obstacles.find((obstacle) => obstacle.tunnel)?.pos || [0, 5, 0];
                // Inspect real surfaces within the live camera's clip range even on huge maps.
                const distance = Math.min(size[0] * scale * .32, camera.far * .3);
                for (const [name, x, y, z] of [['overview', -1, .55, .6], ['reverse', 1, .35, -.6]]) {
                    camera.position.set(focus[0]*scale + x*distance, focus[1]*scale + y*distance,
                        focus[2]*scale + z*distance);
                    camera.lookAt(focus[0]*scale, focus[1]*scale, focus[2]*scale);
                    camera.updateMatrixWorld(true);
                    renderer.render();
                    shots.push({ name, data: renderer.renderer.domElement.toDataURL('image/png') });
                }
                return {
                    shots, warnings: arena._glbLoadWarnings, error: arena._glbLoadError,
                    nativeVisible: !!(arena._mergedObstacleMesh || arena._mergedFoamMesh
                        || arena._mergedObstacleEdges || arena._mergedFoamEdges),
                    dynamic: arena._glbDynamicObstacles.length,
                    players: game.entityManager.players.length,
                    render: renderer.renderer.info.render,
                };
            } finally {
                camera.position.copy(position);
                camera.quaternion.copy(rotation);
                camera.updateMatrixWorld(true);
            }
        });
        for (const shot of snapshot.shots) {
            const path = testInfo.outputPath(`${shot.name}.png`);
            await writeFile(path, Buffer.from(shot.data.split(',')[1], 'base64'));
            await testInfo.attach(shot.name, { path, contentType: 'image/png' });
        }
        delete snapshot.shots;
        await testInfo.attach('world-state', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
        expect(snapshot.error).toBeNull();
        expect(snapshot.warnings).toEqual([]);
        expect(snapshot.nativeVisible).toBe(false);
        expect(snapshot.players).toBe(5);
        if (mapKey !== 'chrono_forge_nexus') expect(snapshot.dynamic).toBe(0);
        else expect(snapshot.dynamic).toBeGreaterThan(0);
    });

    test(`${mapKey}: failed world load retains playable fallback and recovers on a new match`, async ({ page }) => {
        const url = `**/assets/maps/${mapKey}/glb/01_world.glb`;
        await page.route(url, (route) => route.abort());
        await selectMap(page, mapKey);
        await page.click('#btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING'
            && window.GAME_INSTANCE.arena._glbLoadError, null, { timeout: 45000 });
        const degraded = await page.evaluate(() => {
            const arena = window.GAME_INSTANCE.arena;
            return { scene: !!arena._glbScene, native: !!arena._mergedObstacleMesh,
                staticCount: arena.obstacles.filter((entry) => !entry.dynamic).length,
                animations: arena._glbAnimation.trackCount, warnings: arena._glbLoadWarnings.length };
        });
        expect(degraded.scene).toBe(false);
        expect(degraded.native).toBe(true);
        expect(degraded.staticCount).toBeGreaterThan(5);
        expect(degraded.animations).toBe(0);
        expect(degraded.warnings).toBeGreaterThan(0);
        await page.unroute(url);
        await page.evaluate(async () => {
            const facade = window.GAME_INSTANCE.runtimeFacade;
            await facade.returnToMenu();
            await facade.startMatch();
        });
        await page.waitForFunction(() => window.GAME_INSTANCE.arena._glbScene, null, { timeout: 45000 });
        const restored = await page.evaluate(() => {
            const arena = window.GAME_INSTANCE.arena;
            return { error: arena._glbLoadError, native: !!arena._mergedObstacleMesh,
                staticCount: arena.obstacles.filter((entry) => !entry.dynamic).length };
        });
        expect(restored.error).toBeNull();
        expect(restored.native).toBe(false);
        expect(restored.staticCount).toBe(degraded.staticCount);
    });
}
