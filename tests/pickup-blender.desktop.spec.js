import { writeFile } from 'node:fs/promises';
import { LEGACY_PICKUP_MODEL_TYPES } from '../src/entities/powerup/PowerupVisualCatalog.js';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const CLOSEUPS = [
    'SPEED_UP', 'SLOW_DOWN', 'THICK', 'THIN', 'SHIELD',
    'HEALTH', 'SLOW_TIME', 'GHOST', 'FOG', 'INVERT',
    'SWAP', 'TRAIL_GAP', 'EMP', 'MAGNET', 'DECOY',
    'MINE', 'MG_TURRET', 'ROCKET_TURRET',
    'ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA', 'ROCKET_GUIDED',
    'FAN_3', 'FAN_4', 'FAN_5', 'FLAMETHROWER', 'LIGHTNING', 'RAILGUN', 'REPAIR_DRONE',
];

async function waitForBlenderPickups(page, previousMeshId = null) {
    await page.waitForFunction(({ previousId, expectedCount }) => {
        const game = window.GAME_INSTANCE;
        const items = game?.entityManager?.powerupManager?.items || [];
        return game?.state === 'PLAYING' && items.length === expectedCount
            && items.every((item) => item.mesh.uuid !== previousId)
            && items.every((item) => typeof item.mesh.userData.blenderPickupModel === 'string');
    }, { previousId: previousMeshId, expectedCount: CLOSEUPS.length }, { timeout: 30_000 });
}

test('desktop loads Blender pickups, preserves authored shapes and reloads after restart', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    // Fight lists the model showcases only behind their own collection filter.
    await page.selectOption('#map-filter-select', 'showcase');
    await page.selectOption('#map-select', 'item_showcase');
    // The filter is saved in the profile; later specs expect the full list again.
    await page.selectOption('#map-filter-select', 'all');
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
        const pilotTypes = ['SPEED_UP', 'SHIELD', 'HEALTH', 'ROCKET_HEAVY'];
        const sourceCanvas = runtime.renderer.domElement;
        const readabilitySheet = document.createElement('canvas');
        readabilitySheet.width = 704;
        readabilitySheet.height = 288;
        const sheetContext = readabilitySheet.getContext('2d');
        sheetContext.fillStyle = '#162234';
        sheetContext.fillRect(0, 0, readabilitySheet.width, readabilitySheet.height);
        const seriesSheet = document.createElement('canvas');
        seriesSheet.width = 880;
        seriesSheet.height = Math.ceil(closeups.length / 5) * 144;
        const seriesContext = seriesSheet.getContext('2d');
        seriesContext.fillStyle = '#162234';
        seriesContext.fillRect(0, 0, seriesSheet.width, seriesSheet.height);
        const copyNativePanel = (context, index, columns, label) => {
            const x = (index % columns) * 176;
            const y = Math.floor(index / columns) * 144;
            context.drawImage(sourceCanvas, sourceCanvas.width / 2 - 80,
                sourceCanvas.height / 2 - 52, 160, 104, x + 8, y + 4, 160, 104);
            context.fillStyle = '#e4edf5';
            context.font = '12px sans-serif';
            context.fillText(label, x + 8, y + 128);
        };
        const projectedExtent = (mesh) => {
            const point = mesh.position.clone();
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            mesh.traverse((node) => {
                if (!node.isMesh) return;
                const positions = node.geometry.attributes.position;
                for (let index = 0; index < positions.count; index++) {
                    point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld).project(camera);
                    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
                    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
                }
            });
            return Math.max((maxX - minX) * sourceCanvas.width / 2,
                (maxY - minY) * sourceCanvas.height / 2);
        };
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
                    if (pilotTypes.includes(type) || type.startsWith('FAN_')
                        || type === 'THICK' || type === 'THIN') {
                        const views = [['front', [0, 0.15, 3.1]], ['back', [0.65, 0.4, -3.1]]];
                        if (type === 'ROCKET_HEAVY') views.push(['nozzle', [0.4, -2, 2.5]]);
                        for (const [view, offset] of views) {
                            camera.position.copy(center).add(size.fromArray(offset).multiplyScalar(extent));
                            camera.lookAt(center);
                            capture(`pickup-${type.toLowerCase()}-${view}`);
                        }
                    }
                    for (const [row, pixels] of (pilotTypes.includes(type) ? [64, 32] : [64]).entries()) {
                        let distanceScale = 1;
                        for (let step = 0; step < 4; step++) {
                            camera.position.copy(center).add(size.set(extent * 1.5, extent * 0.6, extent * 2.8)
                                .multiplyScalar(distanceScale));
                            camera.lookAt(center);
                            camera.updateMatrixWorld(true);
                            distanceScale *= projectedExtent(item.mesh) / pixels;
                        }
                        runtime.render();
                        // Copy native pixels, without enlarging the item, for visual review at play distance.
                        if (pixels === 64) {
                            copyNativePanel(seriesContext, closeups.indexOf(type), 5, `${type} · 64px`);
                        }
                        if (pilotTypes.includes(type)) {
                            copyNativePanel(sheetContext, row * 4 + pilotTypes.indexOf(type), 4,
                                `${type} · ${pixels}px`);
                        }
                    }
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
            captures.push({ name: 'pickup-readability-32-64', image: readabilitySheet.toDataURL('image/png') });
            captures.push({ name: 'pickup-series-64', image: seriesSheet.toDataURL('image/png') });
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

    expect(result.models).toHaveLength(CLOSEUPS.length);
    expect(new Set(result.models.map((entry) => entry.type)).size).toBe(CLOSEUPS.length);
    expect(result.pickupRadius).toBe(2.5);
    for (const entry of result.models) {
        expect(entry.triangles, entry.type).toBeGreaterThan(0);
        expect(entry.triangles, entry.type).toBeLessThanOrEqual(2500);
        expect(entry.colors, entry.type).toContain(entry.expectedColor);
        if (entry.type.startsWith('ROCKET_') && entry.type !== 'ROCKET_TURRET') {
            expect(entry.rocketTier).toBe(entry.type === 'ROCKET_GUIDED'
                ? 'MEGA' : entry.type.slice('ROCKET_'.length));
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

    await page.evaluate((models) => {
        models.forEach((model, index) => {
            window.GAME_INSTANCE.entityManager.powerupManager.spawnAtAnchor({
                ownerId: `blender-shape-proof:${model}`, type: 'SHIELD', model,
                x: -200 + index * 12, y: 28, z: -120,
            });
        });
    }, LEGACY_PICKUP_MODEL_TYPES);
    await page.waitForFunction((models) => models.every((model) => {
        const item = window.GAME_INSTANCE.entityManager.powerupManager.items
            .find((entry) => entry.ownerId === `blender-shape-proof:${model}`);
        return item?.mesh.userData.blenderPickupModel === model;
    }), LEGACY_PICKUP_MODEL_TYPES, { timeout: 15_000 });
    const overrideImages = await page.evaluate((models) => {
        const runtime = window.GAME_INSTANCE.renderer;
        const items = window.GAME_INSTANCE.entityManager.powerupManager.items;
        const camera = runtime.cameras[0];
        const position = camera.position.clone();
        const quaternion = camera.quaternion.clone();
        const source = runtime.renderer.domElement;
        const sheet = document.createElement('canvas');
        sheet.width = 1280;
        sheet.height = Math.ceil(models.length / 5) * 240;
        const context = sheet.getContext('2d');
        context.fillStyle = '#162234';
        context.fillRect(0, 0, sheet.width, sheet.height);
        let starImage;
        try {
            for (const [index, model] of models.entries()) {
                const item = items.find((entry) => entry.ownerId === `blender-shape-proof:${model}`);
                const rotation = item.mesh.quaternion.clone();
                try {
                    item.mesh.quaternion.identity();
                    item.mesh.updateMatrixWorld(true);
                    const bounds = item.box.clone().setFromObject(item.mesh);
                    const size = bounds.getSize(position.clone());
                    const center = bounds.getCenter(position.clone());
                    const extent = Math.max(size.x, size.y, size.z);
                    camera.position.copy(center).add(size.set(extent * 1.5, extent * 0.6, extent * 2.8));
                    camera.lookAt(center);
                    camera.updateMatrixWorld(true);
                    runtime.render();
                    const x = (index % 5) * 256;
                    const y = Math.floor(index / 5) * 240;
                    context.drawImage(source, source.width / 2 - 112, source.height / 2 - 100,
                        224, 200, x + 16, y + 8, 224, 200);
                    context.fillStyle = '#e4edf5';
                    context.font = '14px sans-serif';
                    context.fillText(model, x + 16, y + 228);
                    if (model === 'item_star') starImage = source.toDataURL('image/png');
                } finally {
                    item.mesh.quaternion.copy(rotation);
                    item.mesh.updateMatrixWorld(true);
                }
            }
            return { starImage, sheetImage: sheet.toDataURL('image/png') };
        } finally {
            camera.position.copy(position);
            camera.quaternion.copy(quaternion);
            camera.updateMatrixWorld(true);
        }
    }, LEGACY_PICKUP_MODEL_TYPES);
    for (const [name, image] of [['pickup-authored-star', overrideImages.starImage],
        ['pickup-legacy-series', overrideImages.sheetImage]]) {
        const imagePath = testInfo.outputPath(`${name}.png`);
        await writeFile(imagePath, Buffer.from(image.split(',')[1], 'base64'));
        await testInfo.attach(name, { path: imagePath, contentType: 'image/png' });
    }
    const previousMeshId = await page.evaluate((models) => {
        const game = window.GAME_INSTANCE;
        models.forEach((model) => game.entityManager.powerupManager.removeByOwnerId(`blender-shape-proof:${model}`));
        return game.entityManager.powerupManager.items[0].mesh.uuid;
    }, LEGACY_PICKUP_MODEL_TYPES);
    await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await waitForBlenderPickups(page, previousMeshId);
    expect(errors).toEqual([]);
});
