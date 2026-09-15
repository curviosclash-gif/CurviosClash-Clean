import { writeFile } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const MAP_KEY = 'magma_maze';
const PICKUP_OWNER_ID = 'magma-maze-desktop-proof';
const AFFECTED_PICKUPS = Object.freeze([
    { id: 'mm_speed_1', approachStartX: -9 },
    { id: 'mm_shield_2', approachStartX: 21 },
    { id: 'mm_speed_3', approachStartX: 61 },
    { id: 'mm_speed_fin', approachStartX: 76 },
]);

async function startMagmaMaze(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.locator('#submenu-game:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.settings?.mapKey === mapKey
    ), MAP_KEY, { timeout: 10_000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.players?.every((player) => !player.isBot);
    }, MAP_KEY, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);
}

function decodePng(dataUrl) {
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('Magma Maze keeps its authored tunnel pickups reachable and collectible on Desktop', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await startMagmaMaze(page);

    const spawned = await page.evaluate((ownerId) => {
        const game = window.GAME_INSTANCE;
        const powerups = game.entityManager.powerupManager;
        const firstAnchor = game.arena.getAuthoredItemAnchors()
            .find((anchor) => anchor.id === 'mm_speed_1');
        const item = powerups.spawnAtAnchor({
            ...firstAnchor,
            ownerId,
        });
        return {
            anchorFound: !!firstAnchor,
            spawned: !!item,
        };
    }, PICKUP_OWNER_ID);
    expect(spawned).toEqual({ anchorFound: true, spawned: true });

    await page.waitForFunction((ownerId) => {
        const items = window.GAME_INSTANCE?.entityManager?.powerupManager?.items || [];
        return items.some((item) => (
            item.ownerId === ownerId
            && item.mesh?.userData?.blenderPickupModel === 'item_battery'
        ));
    }, PICKUP_OWNER_ID, { timeout: 30_000 });

    const proof = await page.evaluate(({ pickups, ownerId }) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const entityManager = game.entityManager;
        const powerups = entityManager.powerupManager;
        const player = entityManager.humanPlayers[0];
        const scale = entityManager.entityRuntimeConfig.ARENA.MAP_SCALE;
        const authoredById = new Map(
            arena.currentMapDefinition.items.map((anchor) => [anchor.id, anchor])
        );
        const runtimeById = new Map(
            arena.getAuthoredItemAnchors().map((anchor) => [anchor.id, anchor])
        );
        const blockedAnchors = [];
        const blockedApproaches = [];
        const scalingErrors = [];
        let approachSampleCount = 0;

        for (const pickup of pickups) {
            const authored = authoredById.get(pickup.id);
            const anchor = runtimeById.get(pickup.id);
            if (!authored || !anchor) {
                scalingErrors.push(`${pickup.id}:missing`);
                continue;
            }
            for (const axis of ['x', 'y', 'z']) {
                if (Math.abs(anchor[axis] - authored[axis] * scale) > 1e-9) {
                    scalingErrors.push(`${pickup.id}:${axis}`);
                }
            }
            if (arena.checkCollisionFast(anchor, player.hitboxRadius)) {
                blockedAnchors.push(pickup.id);
            }
            let blockedSampleCount = 0;
            let firstBlockedX = null;
            for (let x = pickup.approachStartX; x >= authored.x; x -= 0.25) {
                approachSampleCount += 1;
                const probe = { x: x * scale, y: anchor.y, z: anchor.z };
                if (arena.checkCollisionFast(probe, player.hitboxRadius)) {
                    blockedSampleCount += 1;
                    if (firstBlockedX === null) firstBlockedX = x;
                }
            }
            if (blockedSampleCount > 0) {
                blockedApproaches.push({
                    id: pickup.id,
                    blockedSampleCount,
                    firstBlockedX,
                });
            }
        }

        const firstAnchor = runtimeById.get('mm_speed_1');
        const item = powerups.items.find((candidate) => candidate.ownerId === ownerId);
        const bounceHeight = entityManager.entityRuntimeConfig.POWERUP.BOUNCE_HEIGHT;
        const pickupRadius = entityManager.entityRuntimeConfig.POWERUP.PICKUP_RADIUS;
        const baseYError = Math.abs((item?.baseY ?? Number.POSITIVE_INFINITY) - firstAnchor.y);
        const xError = Math.abs((item?.mesh?.position?.x ?? Number.POSITIVE_INFINITY) - firstAnchor.x);
        const zError = Math.abs((item?.mesh?.position?.z ?? Number.POSITIVE_INFINITY) - firstAnchor.z);
        const visibleYOffset = Math.abs((item?.mesh?.position?.y ?? Number.POSITIVE_INFINITY) - firstAnchor.y);
        const visibleItemBlocked = item
            ? arena.checkCollisionFast(item.mesh.position, player.hitboxRadius)
            : true;
        const pickupBoxSize = item?.box.getSize(item.mesh.position.clone()).toArray() || [];
        const loadedModel = item?.mesh?.userData?.blenderPickupModel || null;
        const itemVisible = item?.mesh?.visible === true;

        const camera = game.renderer.cameras[0];
        const webglRenderer = game.renderer.renderer;
        const savedCameraPosition = camera.position.clone();
        const savedCameraQuaternion = camera.quaternion.clone();
        camera.position.set(-36 * scale, 15 * scale, -55 * scale);
        camera.lookAt(-45 * scale, 15 * scale, -55 * scale);
        camera.updateMatrixWorld(true);
        arena.update(0);
        webglRenderer.setRenderTarget(null);
        webglRenderer.setScissorTest(false);
        webglRenderer.setViewport(0, 0, webglRenderer.domElement.width, webglRenderer.domElement.height);
        webglRenderer.render(game.renderer.scene, camera);
        const screenshot = webglRenderer.domElement.toDataURL('image/png');
        camera.position.copy(savedCameraPosition);
        camera.quaternion.copy(savedCameraQuaternion);
        camera.updateMatrixWorld(true);

        player.inventory = [];
        player.rocketInventory = [];
        player.position.copy(item.mesh.position);
        player.speed = 0;
        player.markRenderDiscontinuity?.('magma-maze-pickup-proof');
        const collected = powerups.checkPickup(
            player.position,
            player.hitboxRadius,
            (type) => player.addToInventory(type)
        );

        return {
            screenshot,
            state: game.state,
            mapKey: arena.currentMapKey,
            botCount: entityManager.players.filter((candidate) => candidate.isBot).length,
            playerRadius: player.hitboxRadius,
            runtimeAnchorIds: pickups.filter(({ id }) => runtimeById.has(id)).map(({ id }) => id),
            blockedAnchors,
            blockedApproaches,
            approachSampleCount,
            scalingErrors,
            loadedModel,
            itemVisible,
            baseYError,
            xError,
            zError,
            visibleYOffset,
            bounceHeight,
            pickupRadius,
            visibleItemBlocked,
            pickupBoxSize,
            collected: collected?.ok === true,
            collectedType: collected?.type || null,
            inventory: player.inventory.slice(),
        };
    }, { pickups: AFFECTED_PICKUPS, ownerId: PICKUP_OWNER_ID });

    const screenshotPath = testInfo.outputPath('magma-maze-first-tunnel-pickup.png');
    await writeFile(screenshotPath, decodePng(proof.screenshot));
    await testInfo.attach('magma-maze-first-tunnel-pickup.png', {
        path: screenshotPath,
        contentType: 'image/png',
    });
    delete proof.screenshot;
    console.log('MAGMA_MAZE_PICKUP_PROOF', JSON.stringify(proof));

    expect(proof.state).toBe('PLAYING');
    expect(proof.mapKey).toBe(MAP_KEY);
    expect(proof.botCount).toBe(0);
    expect(proof.playerRadius).toBeGreaterThan(0);
    expect(proof.runtimeAnchorIds).toEqual(AFFECTED_PICKUPS.map(({ id }) => id));
    expect(proof.scalingErrors).toEqual([]);
    expect(proof.approachSampleCount).toBeGreaterThan(0);
    expect(proof.blockedAnchors).toEqual([]);
    expect(proof.blockedApproaches).toEqual([]);
    expect(proof.loadedModel).toBe('item_battery');
    expect(proof.itemVisible).toBe(true);
    expect(proof.baseYError).toBeLessThan(1e-9);
    expect(proof.xError).toBeLessThan(1e-9);
    expect(proof.zError).toBeLessThan(1e-9);
    expect(proof.visibleYOffset).toBeLessThanOrEqual(proof.bounceHeight + 1e-6);
    expect(proof.visibleItemBlocked).toBe(false);
    expect(proof.pickupBoxSize).toHaveLength(3);
    for (const dimension of proof.pickupBoxSize) {
        expect(dimension).toBeCloseTo(proof.pickupRadius * 2, 9);
    }
    expect(proof.collected).toBe(true);
    expect(proof.collectedType).toBe('SPEED_UP');
    expect(proof.inventory).toContain('SPEED_UP');
    expect(errors).toHaveLength(0);
});
