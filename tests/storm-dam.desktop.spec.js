import { writeFile } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'storm_dam_siege';
const MAP_SCALE = 3;

async function startDamMatch(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        && window.GAME_INSTANCE?.entityManager?.players?.length > 0
    ), MAP_KEY, { timeout: 120_000 });
}

test('the giant rear-wall dam breaches and launches its flood wave into the arena', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startDamMatch(page);
    await expect.poll(() => page.evaluate(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return !arena?._glbLoadError && arena?._glbScene?.children?.length === 3;
    }), { timeout: 150_000 }).toBe(true);

    const result = await page.evaluate(({ mapScale }) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const entityManager = game.entityManager;
        const destructibles = entityManager._mapDestructibleSystem;
        const water = entityManager._waterZoneSystem;
        const intact = arena._glbScene.getObjectByName('glb-slot-storm-dam-intact');
        const collapse = arena._glbScene.getObjectByName('glb-slot-storm-dam-collapse');
        const playerRadius = Math.max(0.8, Number(entityManager.players[0]?.hitboxRadius) || 0.8);
        let reservoirPoint = null;
        findReservoirPoint: for (let y = 220; y >= 20; y -= 10) {
            for (let z = 283; z >= 272; z -= 1) {
                for (let x = -250; x <= 250; x += 25) {
                    const candidate = { x, y, z };
                    if (water.isPositionUnderwater(candidate) && !arena.checkCollision(candidate, playerRadius)) {
                        reservoirPoint = candidate;
                        break findReservoirPoint;
                    }
                }
            }
        }

        const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        intact.updateWorldMatrix(true, true);
        intact.traverse((child) => {
            if (!/^dam_wall_arch_\d+$/.test(String(child.name)) || !child.geometry) return;
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
            const local = child.geometry.boundingBox;
            const matrix = child.matrixWorld.elements;
            for (const x of [local.min.x, local.max.x]) {
                for (const y of [local.min.y, local.max.y]) {
                    for (const z of [local.min.z, local.max.z]) {
                        const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
                        const worldY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
                        bounds.minX = Math.min(bounds.minX, worldX);
                        bounds.maxX = Math.max(bounds.maxX, worldX);
                        bounds.minY = Math.min(bounds.minY, worldY);
                        bounds.maxY = Math.max(bounds.maxY, worldY);
                    }
                }
            }
        });

        const runtime = game.renderer;
        const camera = runtime.cameras[0];
        const captureWater = (position, target) => {
            const waterAncestors = new Set();
            for (let parent = water._visual.group.parent; parent; parent = parent.parent) {
                waterAncestors.add(parent);
            }
            const visibility = [];
            runtime.scene.traverse((child) => {
                visibility.push([child, child.visible]);
                const isWaterPart = child === water._visual.group
                    || water._visual.group.getObjectById(child.id) !== undefined;
                if (!isWaterPart && !waterAncestors.has(child) && !child.isLight) child.visible = false;
            });
            for (const [child] of visibility) {
                if (child.isLight) child.visible = true;
            }
            camera.position.set(...position);
            camera.lookAt(...target);
            camera.updateMatrixWorld(true);
            runtime.render();
            const picture = runtime.renderer.domElement.toDataURL('image/png');
            for (const [child, visible] of visibility) child.visible = visible;
            return picture;
        };
        const basinVisibleBeforeBreach = water._visual.surface.visible;
        const reservoirPicture = captureWater([0, 260, 245], [0, 225, 278]);

        const segment = destructibles.getDefinition().segments.find((entry) => entry.id === 'dam_wall');
        const hit = destructibles.applyMeshHit('dam_wall_arch_08', segment.hp, {
            hitPoint: {
                x: segment.anchor[0] * mapScale,
                y: segment.anchor[1] * mapScale,
                z: segment.anchor[2] * mapScale,
            },
            hitDirection: { x: 0, y: 0, z: -1 },
            cause: 'MG_BULLET',
        });
        water.update(0);
        const waveStartZ = water._visual.waveGroup.position.z;
        water.update(water.getZone().waveSeconds / 8);

        const wavePicture = captureWater([0, 45, 140], [0, 10, 202]);
        water.update((water.getZone().waveSeconds * 3) / 8);

        return {
            maxY: arena.bounds.maxY,
            warningCount: arena._glbLoadWarnings.length,
            trackCount: arena._glbAnimation.trackCount,
            wallWidth: bounds.maxX - bounds.minX,
            wallHeight: bounds.maxY - bounds.minY,
            destroyed: hit?.destroyed === true,
            intactVisible: intact.visible,
            collapseVisible: collapse.visible,
            phase: water.getState().phase,
            waveOrigin: water.getZone().waveOrigin,
            waveStartZ,
            waveHalfZ: water._visual.waveGroup.position.z,
            waveParts: water._visual.waveGroup.children.length,
            reservoirDepth: water.getZone().reservoirBounds.max[2] - water.getZone().reservoirBounds.min[2],
            reservoirVisible: water._visual.reservoirSurface.visible,
            basinVisibleBeforeBreach,
            reservoirPoint,
            reservoirUnderwater: water.isPositionUnderwater(reservoirPoint),
            reservoirCollision: reservoirPoint ? arena.checkCollision(reservoirPoint, playerRadius) : true,
            reservoirPicture,
            picture: wavePicture,
        };
    }, { mapScale: MAP_SCALE });

    expect(result.warningCount).toBe(0);
    expect(result.trackCount).toBe(2);
    expect(result.maxY).toBe(450);
    expect(result.wallWidth).toBeGreaterThanOrEqual(535);
    expect(result.wallHeight).toBeGreaterThanOrEqual(405);
    expect(result.destroyed).toBe(true);
    expect(result.intactVisible).toBe(false);
    expect(result.collapseVisible).toBe(true);
    expect(result.phase).toBe('wave');
    expect(result.waveOrigin).toBe('maxZ');
    expect(result.waveStartZ).toBeCloseTo(270, 4);
    expect(result.waveHalfZ).toBeCloseTo(0, 4);
    expect(result.waveParts).toBe(5);
    expect(result.reservoirDepth).toBeCloseTo(15, 6);
    expect(result.reservoirVisible).toBe(true);
    expect(result.basinVisibleBeforeBreach).toBe(false);
    expect(result.reservoirPoint).not.toBeNull();
    expect(result.reservoirUnderwater).toBe(true);
    expect(result.reservoirCollision).toBe(false);

    const reservoirScreenshot = testInfo.outputPath('storm-dam-reservoir-before-breach.png');
    await writeFile(reservoirScreenshot, Buffer.from(result.reservoirPicture.split(',')[1], 'base64'));
    await testInfo.attach('storm-dam-reservoir-before-breach', {
        path: reservoirScreenshot,
        contentType: 'image/png',
    });

    const screenshot = testInfo.outputPath('storm-dam-breach-wave.png');
    await writeFile(screenshot, Buffer.from(result.picture.split(',')[1], 'base64'));
    await testInfo.attach('storm-dam-breach-wave', { path: screenshot, contentType: 'image/png' });
    expect(errors).toEqual([]);
});
