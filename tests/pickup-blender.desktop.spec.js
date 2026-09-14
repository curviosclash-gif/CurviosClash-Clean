import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const CLOSEUPS = [
    'SPEED_UP', 'SHIELD', 'HEALTH', 'SLOW_TIME', 'MAGNET', 'FOG',
    'ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA',
    'FAN_3', 'FAN_4', 'FAN_5',
];

async function waitForBlenderPickups(page, previousMeshId = null) {
    await page.waitForFunction((previousId) => {
        const game = window.GAME_INSTANCE;
        const items = game?.entityManager?.powerupManager?.items || [];
        return game?.state === 'PLAYING' && items.length === 25
            && items.every((item) => item.mesh.uuid !== previousId)
            && items.every((item) => typeof item.mesh.userData.blenderPickupModel === 'string');
    }, previousMeshId, { timeout: 30_000 });
}

test('desktop loads Blender pickups, preserves authored shapes and reloads after restart', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'item_showcase');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        document.getElementById('bot-count').value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await waitForBlenderPickups(page);

    const result = await page.evaluate((closeups) => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager.powerupManager;
        const runtime = game.renderer;
        const camera = runtime.cameras[0];
        const originalPosition = camera.position.clone();
        const originalQuaternion = camera.quaternion.clone();
        const captures = [];
        const capture = (name) => {
            camera.updateMatrixWorld(true);
            runtime.render();
            captures.push({ name, image: runtime.renderer.domElement.toDataURL('image/png') });
        };
        try {
            camera.position.set(0, 80, 160);
            camera.lookAt(0, 12, 9);
            capture('pickup-overview');
            for (const type of closeups) {
                const item = manager.items.find((entry) => entry.type === type);
                const rotation = item.mesh.quaternion.clone();
                const scale = item.mesh.scale.clone();
                try {
                    item.mesh.quaternion.identity();
                    item.mesh.scale.set(item.baseScaleX, item.baseScaleY, item.baseScaleZ);
                    item.mesh.updateMatrixWorld(true);
                    const bounds = item.box.clone().setFromObject(item.mesh);
                    const size = bounds.getSize(item.mesh.position.clone());
                    const center = bounds.getCenter(item.mesh.position.clone());
                    const extent = Math.max(size.x, size.y, size.z);
                    camera.position.copy(center).add(size.set(extent * 1.5, extent * 0.6, extent * 2.8));
                    camera.lookAt(center);
                    capture(`pickup-${type.toLowerCase()}`);
                    if (type === 'SHIELD') {
                        camera.position.copy(center).add(size.set(extent * 2, extent, extent * 12));
                        camera.lookAt(center);
                        capture('pickup-shield-distance');
                    }
                } finally {
                    item.mesh.quaternion.copy(rotation);
                    item.mesh.scale.copy(scale);
                    item.mesh.updateMatrixWorld(true);
                }
            }
            const models = manager.items.map((item) => {
                let triangles = 0;
                let labels = 0;
                const colors = new Set();
                item.mesh.traverse((node) => {
                    if (node.userData.weaponFanLabel) labels++;
                    if (!node.isMesh) return;
                    triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
                    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                        if (material.color) colors.add(material.color.getHex());
                    }
                });
                return {
                    type: item.type, model: item.mesh.userData.blenderPickupModel,
                    rocketTier: item.mesh.userData.rocketTier,
                    fanProjectiles: item.mesh.userData.fanProjectiles,
                    markerText: item.mesh.userData.markerText,
                    triangles, labels, colors: [...colors],
                    expectedColor: manager.entityRuntimeConfig.POWERUP.TYPES[item.type].color,
                };
            });
            return { captures, models, pickupRadius: manager.entityRuntimeConfig.POWERUP.PICKUP_RADIUS };
        } finally {
            camera.position.copy(originalPosition);
            camera.quaternion.copy(originalQuaternion);
            camera.updateMatrixWorld(true);
        }
    }, CLOSEUPS);

    expect(result.models).toHaveLength(25);
    expect(new Set(result.models.map((entry) => entry.type)).size).toBe(25);
    expect(result.pickupRadius).toBe(2.5);
    for (const entry of result.models) {
        expect(entry.triangles, entry.type).toBeGreaterThan(0);
        expect(entry.triangles, entry.type).toBeLessThanOrEqual(2500);
        expect(entry.colors, entry.type).toContain(entry.expectedColor);
        if (entry.type.startsWith('ROCKET_') && entry.type !== 'ROCKET_TURRET') {
            expect(entry.rocketTier).toBe(entry.type.slice('ROCKET_'.length));
        }
        if (entry.type.startsWith('FAN_')) {
            const count = Number(entry.type.slice(4));
            expect(entry.fanProjectiles).toBe(count);
            expect(entry.markerText).toBe(`×${count}`);
            expect(entry.labels).toBeGreaterThan(0);
        }
    }
    for (const capture of result.captures) {
        const imagePath = testInfo.outputPath(`${capture.name}.png`);
        await writeFile(imagePath, Buffer.from(capture.image.split(',')[1], 'base64'));
        await testInfo.attach(capture.name, { path: imagePath, contentType: 'image/png' });
    }

    await page.evaluate(() => {
        window.GAME_INSTANCE.entityManager.powerupManager.spawnAtAnchor({
            ownerId: 'blender-shape-proof', type: 'SHIELD', model: 'item_star',
            x: 0, y: 18, z: -40,
        });
    });
    await page.waitForFunction(() => {
        const item = window.GAME_INSTANCE.entityManager.powerupManager.items
            .find((entry) => entry.ownerId === 'blender-shape-proof');
        return item?.mesh.userData.blenderPickupModel === 'item_star';
    }, null, { timeout: 15_000 });
    const overrideImage = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.renderer;
        const item = window.GAME_INSTANCE.entityManager.powerupManager.items
            .find((entry) => entry.ownerId === 'blender-shape-proof');
        const camera = runtime.cameras[0];
        const position = camera.position.clone();
        const quaternion = camera.quaternion.clone();
        try {
            camera.position.copy(item.mesh.position).add(position.clone().set(5, 2, 10));
            camera.lookAt(item.mesh.position);
            camera.updateMatrixWorld(true);
            runtime.render();
            return runtime.renderer.domElement.toDataURL('image/png');
        } finally {
            camera.position.copy(position);
            camera.quaternion.copy(quaternion);
            camera.updateMatrixWorld(true);
        }
    });
    const overridePath = testInfo.outputPath('pickup-authored-star.png');
    await writeFile(overridePath, Buffer.from(overrideImage.split(',')[1], 'base64'));
    await testInfo.attach('pickup-authored-star', { path: overridePath, contentType: 'image/png' });
    const previousMeshId = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.entityManager.powerupManager.removeByOwnerId('blender-shape-proof');
        return game.entityManager.powerupManager.items[0].mesh.uuid;
    });
    await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await waitForBlenderPickups(page, previousMeshId);
    expect(errors).toEqual([]);
});
