import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Fifteen cathedral GLBs plus 32 Blender-tree instances is more than any earlier map loads, and
// seven of them are one building split into parts. The running app must prove that the parts land
// back together as one cathedral, and that the eight site machines
// run on their own phases of the shared beat instead of moving in lockstep. Both are checked in
// a single run, because loading this map takes long enough that doing it twice is wasteful.

test('Notre-Dame loads as one cathedral with its site running on the shared beat', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'notre_dame');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'notre_dame'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    const loadStartedAt = await page.evaluate(() => performance.now());
    await page.click('#btn-start');
    await expect.poll(() => page.evaluate(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'notre_dame'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 8
    )), {
        timeout: 150_000,
        message: 'Notre-Dame should load all fifteen parts and animate the eight site pieces',
    }).toBeTruthy();
    const loadDurationMs = await page.evaluate((startedAt) => performance.now() - startedAt, loadStartedAt);
    expect(loadDurationMs).toBeLessThan(120_000);

    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            warningCount: arena._glbLoadWarnings.length,
            colliderMode: arena.currentMapDefinition?.glbColliderMode,
            glbSceneChildren: arena._glbScene?.children?.length || 0,
            authoredObstacleCount: arena.obstacles.filter((entry) => !entry.isWall && !entry.dynamic).length,
            authoredObstacleVisuals: [
                arena._mergedObstacleMesh,
                arena._mergedFoamMesh,
                arena._mergedObstacleEdges,
                arena._mergedFoamEdges,
            ].filter(Boolean).length,
            authoredCollisionSolid: arena.checkCollisionFast({ x: -249, y: 168, z: -60.9 }, 0.1),
        };
    });

    // Only the site moves, so only eight of the fifteen carry a clip.
    expect(state.authoredObstacleCount).toBeGreaterThan(0);
    expect(state).toEqual({
        mapKey: 'notre_dame',
        trackCount: 8,
        warningCount: 0,
        colliderMode: 'scene',
        glbSceneChildren: 47,
        authoredObstacleCount: state.authoredObstacleCount,
        authoredObstacleVisuals: 2,
        authoredCollisionSolid: true,
    });

    const initialElapsed = await page.evaluate(() => (
        window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds
    ));
    await expect.poll(() => page.evaluate((elapsed) => (
        window.GAME_INSTANCE?.arena?.glbAnimationElapsedSeconds > elapsed
    ), initialElapsed), {
        timeout: 15_000,
        message: 'the site clock should advance once the match is running',
    }).toBeTruthy();

    // The eight clips sit on four different offsets of one six second beat. Reading their clip
    // positions in a single frame is the proof that those offsets survive into the running game
    // rather than only holding in the preset.
    const phases = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimation._tracks
            .map((track) => ({ clip: track.clipName, time: Number(track.action.time.toFixed(3)) }))
    ));
    expect(phases).toHaveLength(8);
    expect(new Set(phases.map((entry) => entry.clip)).size).toBe(8);
    expect(new Set(phases.map((entry) => entry.time)).size).toBeGreaterThan(1);
    for (const entry of phases) {
        expect(entry.time).toBeGreaterThanOrEqual(0);
    }

    // Where every part actually ended up in the world. If the preset had undone the recentring
    // the loader applies wrongly, the towers would sit somewhere other than the nave, and it
    // would show here: as a west front that is not west of the choir, or as a spire that does
    // not stand over the crossing.
    const layout = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const parts = {};
        // Three.js is not exposed on window, so the world box is folded by hand: take each
        // geometry's own local box and push its eight corners through the mesh world matrix.
        for (const slot of arena._glbScene.children) {
            const url = String(slot.userData?.glbModelUrl || '');
            const name = url.split('/').pop().replace('.glb', '');
            const bounds = {
                minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
            };
            slot.updateWorldMatrix(true, true);
            slot.traverse((child) => {
                if (!child.isMesh || !child.geometry) return;
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                const local = child.geometry.boundingBox;
                const m = child.matrixWorld.elements;
                for (const cx of [local.min.x, local.max.x]) {
                    for (const cy of [local.min.y, local.max.y]) {
                        for (const cz of [local.min.z, local.max.z]) {
                            const x = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
                            const y = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
                            bounds.minX = Math.min(bounds.minX, x);
                            bounds.maxX = Math.max(bounds.maxX, x);
                            bounds.minY = Math.min(bounds.minY, y);
                            bounds.maxY = Math.max(bounds.maxY, y);
                        }
                    }
                }
            });
            parts[name] = bounds;
        }
        return parts;
    });

    const facade = layout['01_west_facade'];
    const nave = layout['02_nave'];
    const transept = layout['03_transept'];
    const choir = layout['04_choir_apse'];
    const roof = layout['06_roof_fleche'];
    for (const part of [facade, nave, transept, choir, roof]) {
        expect(part).toBeTruthy();
    }

    // West to east, in order, each part meeting the next rather than floating apart.
    expect(facade.maxX).toBeLessThan(nave.maxX);
    expect(nave.maxX).toBeLessThan(transept.maxX);
    expect(transept.maxX).toBeLessThan(choir.maxX);
    expect(nave.minX - facade.maxX).toBeLessThan(12);
    expect(transept.minX - nave.maxX).toBeLessThan(12);
    expect(choir.minX - transept.maxX).toBeLessThan(12);

    // 127.5 m of cathedral at 1.4 authored units per metre and a map scale of 3 is about 535
    // world units from the west front to the east end.
    const overall = choir.maxX - facade.minX;
    expect(overall).toBeGreaterThan(500);
    expect(overall).toBeLessThan(575);

    // The spire is the highest thing on the map and stands above everything else.
    expect(roof.maxY).toBeGreaterThan(facade.maxY);
    expect(roof.maxY).toBeGreaterThan(nave.maxY);
    // 8 + 96 * 1.4 authored units, times the map scale of 3, is about 427.
    expect(roof.maxY).toBeGreaterThan(390);
    expect(roof.maxY).toBeLessThan(450);

    // Use the same five probes as PlayerCollisionPhase: centre, nose, tail and both sides. A
    // radiusless point at the middle of an opening is not enough; that was how the full lattice
    // boxes and the two blocked side portals escaped the earlier coverage tests.
    const blockedOpenings = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const radius = 1.1;
        const targets = [
            ['portal-south', [-83, 17, -18.9], [1, 0, 0]],
            ['portal-centre', [-83, 17, 0], [1, 0, 0]],
            ['portal-north', [-83, 17, 18.9], [1, 0, 0]],
            ['gallery-south', [-83, 61.2, -20.3], [1, 0, 0]],
            ['gallery-centre', [-83, 61.2, 0], [1, 0, 0]],
            ['gallery-north', [-83, 61.2, 20.3], [1, 0, 0]],
            ['tower-crane-lattice', [17, 45.8, -90], [1, 0, 0]],
            ['stone-hoist-west-lattice', [-28.8, 23, -55], [1, 0, 0]],
            ['stone-hoist-east-lattice', [8.8, 23, -55], [1, 0, 0]],
            ['scaffold-lattice', [-40, 31.8, 47.8], [1, 0, 0]],
            ['fleche-north-west-cell', [120.9, 29, 9.1], [1, 0, 0]],
            ['fleche-south-east-cell', [139.1, 29, -9.1], [1, 0, 0]],
            ['old-hoarding-west-post', [-171.8, 20.6, 0], [1, 0, 0]],
            ['old-hoarding-east-post', [-128.2, 20.6, 0], [1, 0, 0]],
            ['old-flyer-tube-ring', [-70.57, 37.33, 22.47], [1, 0, 0]],
        ];
        const hit = (point) => arena.checkCollisionFast({
            x: point[0], y: point[1], z: point[2],
        }, radius);
        const blocked = [];
        for (const elapsed of [0, 3, 6, 9, 12]) {
            arena.setGlbAnimationElapsedSeconds(elapsed);
            arena.update(0);
            for (const [id, authored, direction] of targets) {
                const point = authored.map((value) => value * 3);
                const side = [-direction[2], 0, direction[0]];
                const probes = [
                    point,
                    point.map((value, axis) => value + direction[axis] * 4),
                    point.map((value, axis) => value - direction[axis] * 1.5),
                    point.map((value, axis) => value + side[axis] * 2),
                    point.map((value, axis) => value - side[axis] * 2),
                ];
                if (probes.some(hit)) blocked.push(`${id}@${elapsed}`);
            }
        }
        return blocked;
    });
    expect(blockedOpenings).toEqual([]);

    const collisionSweep = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const movingIds = arena.currentMapDefinition.glbModels
            .filter((model) => model.animationClock)
            .map((model) => model.id);
        const groupFor = (obstacle) => {
            let node = obstacle?.meshCollider?.mesh || null;
            while (node) {
                if (node.userData?.glbModelId) return node.userData.glbModelId;
                node = node.parent;
            }
            return '';
        };
        const grouped = Object.fromEntries(movingIds.map((id) => [id, []]));
        arena._glbDynamicObstacles.forEach((obstacle) => {
            const id = groupFor(obstacle);
            if (grouped[id]) grouped[id].push(obstacle);
        });
        const baseline = new Map();
        const motion = Object.fromEntries(movingIds.map((id) => [id, {
            colliderCount: grouped[id].length,
            maxTravel: 0,
            blockedSamples: 0,
        }]));
        const center = game.entityManager.players[0].position.clone();
        for (let step = 0; step <= 24; step += 1) {
            arena.setGlbAnimationElapsedSeconds(step * 0.5);
            arena.update(0);
            for (const id of movingIds) {
                for (const obstacle of grouped[id]) {
                    obstacle.box.getCenter(center);
                    const key = obstacle.meshCollider.mesh.uuid;
                    const first = baseline.get(key);
                    if (!first) baseline.set(key, center.clone());
                    else motion[id].maxTravel = Math.max(motion[id].maxTravel, center.distanceTo(first));
                    if (arena.checkCollisionFast(center, 0.1)) motion[id].blockedSamples += 1;
                }
            }
        }
        return motion;
    });
    expect(Object.keys(collisionSweep)).toHaveLength(8);
    for (const [id, result] of Object.entries(collisionSweep)) {
        expect(result.colliderCount, `${id} keeps dynamic collision`).toBeGreaterThan(0);
        expect(result.maxTravel, `${id} moves that collision across its beat`).toBeGreaterThan(0.5);
        expect(result.blockedSamples, `${id} collides at its visible poses`).toBeGreaterThan(result.colliderCount);
    }

    const performanceBudget = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const drawCalls = [];
        const renderTimes = [];
        for (let frame = 0; frame < 30; frame += 1) {
            const startedAt = performance.now();
            game.renderer.render();
            renderTimes.push(performance.now() - startedAt);
            drawCalls.push(Number(game.renderer?.renderer?.info?.render?.calls) || 0);
        }
        drawCalls.sort((left, right) => left - right);
        renderTimes.sort((left, right) => left - right);
        const p95Index = Math.min(drawCalls.length - 1, Math.ceil(drawCalls.length * 0.95) - 1);
        return {
            sampleCount: drawCalls.length,
            drawCallsP95: drawCalls[p95Index],
            renderMsP95: renderTimes[p95Index],
        };
    });
    expect(performanceBudget.sampleCount).toBe(30);
    expect(performanceBudget.drawCallsP95).toBeGreaterThan(0);
    expect(performanceBudget.drawCallsP95).toBeLessThanOrEqual(260);
    expect(performanceBudget.renderMsP95).toBeLessThan(100);
});
