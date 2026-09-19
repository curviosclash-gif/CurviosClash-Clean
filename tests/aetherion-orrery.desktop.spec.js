import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, returnToMenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

const MAP_KEY = 'aetherion_orrery';
const MAP_SCALE = 3;
const TRACK_COUNT = 13;

async function startAetherion(page, { botCount = 0, modePath = 'arcade' } = {}) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click(`#submenu-custom:not(.hidden) [data-mode-path="${modePath}"]`);
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY);
    await page.evaluate((count) => {
        const game = window.GAME_INSTANCE;
        const slider = document.getElementById('bot-count');
        if (slider) {
            slider.value = String(count);
            if (count > 0) slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        game.settings.numBots = count;
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    }, botCount);
    await page.click('#btn-start');
    await page.waitForFunction(({ mapKey, tracks, expectedBots, enforceBotCount }) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === tracks
        && (!enforceBotCount || (window.GAME_INSTANCE?.entityManager?.bots?.length || 0) === expectedBots)
    ), {
        mapKey: MAP_KEY,
        tracks: TRACK_COUNT,
        expectedBots: botCount,
        enforceBotCount: botCount > 0,
    }, { timeout: 90_000 });
}

async function runtimeFootprint(page) {
    return page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const map = arena.currentMapDefinition;
        const authoredSpawns = [map.playerSpawn, ...(map.botSpawns || [])];
        return {
            mapKey: arena.currentMapKey,
            tracks: arena._glbAnimation.trackCount,
            sceneChildren: arena._glbScene?.children?.length || 0,
            dynamicColliders: arena._glbDynamicObstacles.length,
            warningCount: arena._glbLoadWarnings.length,
            loadError: arena._glbLoadError,
            colliderMode: arena._glbFootprint?.colliderMode,
            blockedSpawns: authoredSpawns.filter((spawn) => arena.checkCollisionFast({
                x: spawn.x * 3,
                y: spawn.y * 3,
                z: spawn.z * 3,
            }, 0.8)).length,
        };
    });
}

test('Aetherion loads architecture, mechanisms, and orientation props on desktop', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startAetherion(page);
    const state = await runtimeFootprint(page);
    expect(state).toEqual({
        mapKey: MAP_KEY,
        tracks: TRACK_COUNT,
        sceneChildren: 41,
        dynamicColliders: 43,
        warningCount: 0,
        loadError: null,
        colliderMode: 'dynamic',
        blockedSpawns: 0,
    });
    expect(state.dynamicColliders).toBeLessThanOrEqual(72);
    await testInfo.attach('aetherion-orrery-runtime.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
    });

    const views = [
        { id: 'foundry-east-ascent', from: [122, 40, -76], to: [145, 46, -44] },
        { id: 'foundry-stele-branch', from: [-78, 34, -132], to: [-108, 24, -104] },
        { id: 'gallery-east-arrival', from: [120, 94, 72], to: [145, 82, 96] },
        { id: 'gallery-portal-bearing', from: [108, 94, -132], to: [138, 84, -104] },
        { id: 'crown-west-arrival', from: [-120, 156, -62], to: [-145, 146, -92] },
        { id: 'crown-stele-bearing', from: [-74, 160, -126], to: [-102, 144, -96] },
    ];
    for (const view of views) {
        const picture = await page.evaluate((entry) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const camera = runtime.cameras[0];
            camera.position.set(...entry.from.map((value) => value * entry.scale));
            camera.lookAt(...entry.to.map((value) => value * entry.scale));
            camera.updateMatrixWorld(true);
            runtime.render();
            return runtime.renderer.domElement.toDataURL('image/png');
        }, { ...view, scale: MAP_SCALE });
        const file = testInfo.outputPath(`${view.id}.png`);
        await writeFile(file, Buffer.from(picture.split(',')[1], 'base64'));
        await testInfo.attach(view.id, { path: file, contentType: 'image/png' });
    }
});

test('Aetherion shortcuts close and open while its outer ascent stays clear', async ({ page }) => {
    test.setTimeout(180_000);
    await startAetherion(page);

    const sweep = await page.evaluate(({ scale, steps, beat }) => {
        const arena = window.GAME_INSTANCE.arena;
        const map = arena.currentMapDefinition;
        const yOffsetByFile = {
            '05_meridian_bridges.glb': 14,
            '06_astrolabe_gate.glb': 13.5,
            '07_eclipse_iris.glb': 20.5,
            '09_zodiac_louvre.glb': 20,
        };
        const shortcutDefs = map.glbModels.flatMap((model) => {
            const file = Object.keys(yOffsetByFile).find((name) => model.url.endsWith(`/${name}`));
            if (!file) return [];
            return [{
                id: model.id,
                point: [model.position[0], model.position[1] + yOffsetByFile[file], model.position[2]],
            }];
        });
        const scaled = (point) => ({ x: point[0] * scale, y: point[1] * scale, z: point[2] * scale });
        const shortcutSamples = Object.fromEntries(shortcutDefs.map(({ id }) => [id, []]));
        const gameplayModels = map.glbModels.filter((model) => (
            model.animationClock && !model.url.endsWith('/10_celestial_core.glb')
        ));
        const groupFor = (obstacle) => {
            let node = obstacle?.meshCollider?.mesh || null;
            while (node) {
                if (node.userData?.glbModelId) return node.userData.glbModelId;
                node = node.parent;
            }
            return '';
        };
        const grouped = Object.fromEntries(gameplayModels.map((model) => [model.id, []]));
        arena._glbDynamicObstacles.forEach((obstacle, obstacleIndex) => {
            const id = groupFor(obstacle);
            if (grouped[id]) grouped[id].push(obstacleIndex);
        });
        const centerOf = (box) => ({
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
        });
        const baseline = [];
        const motion = Object.fromEntries(gameplayModels.map((model) => [model.id, {
            colliderCount: grouped[model.id].length,
            maxTravel: 0,
            vacatedOldPose: false,
            corridorSamples: 0,
        }]));
        let safeFailures = 0;

        for (let index = 0; index < steps; index += 1) {
            arena.setGlbAnimationElapsedSeconds((beat * index) / steps);
            arena.update(1 / 1000);
            for (const definition of shortcutDefs) {
                shortcutSamples[definition.id].push(arena.checkCollisionFast(scaled(definition.point), 0.8));
            }
            for (const model of gameplayModels) {
                const state = motion[model.id];
                let corridorHit = false;
                for (const obstacleIndex of grouped[model.id]) {
                    const obstacle = arena._glbDynamicObstacles[obstacleIndex];
                    const center = centerOf(obstacle.box);
                    if (index === 0) baseline[obstacleIndex] = center;
                    const old = baseline[obstacleIndex];
                    const travel = old ? Math.hypot(center.x - old.x, center.y - old.y, center.z - old.z) : 0;
                    state.maxTravel = Math.max(state.maxTravel, travel);
                    if (travel > scale * 2
                        && arena.checkCollisionFast(center, 0.8)
                        && !arena.checkCollisionFast(old, 0.8)) {
                        state.vacatedOldPose = true;
                    }
                    const px = model.position[0] * scale;
                    const py = model.position[1] * scale;
                    const pz = model.position[2] * scale;
                    if (obstacle.box.max.x >= px - 24 * scale && obstacle.box.min.x <= px + 24 * scale
                        && obstacle.box.max.y >= py && obstacle.box.min.y <= py + 30 * scale
                        && obstacle.box.max.z >= pz - 24 * scale && obstacle.box.min.z <= pz + 24 * scale) {
                        corridorHit = true;
                    }
                }
                if (corridorHit) state.corridorSamples += 1;
            }
            // This vertical line lies in the permanent forty-unit outer band and connects all
            // three levels without depending on an animation or portal.
            for (let y = 24; y <= 144; y += 10) {
                if (arena.checkCollisionFast(scaled([145, y, 0]), 0.8)) safeFailures += 1;
            }
        }
        return {
            safeFailures,
            motion,
            shortcuts: Object.fromEntries(Object.entries(shortcutSamples).map(([id, samples]) => [id, {
                blocked: samples.filter(Boolean).length,
                free: samples.filter((value) => !value).length,
                samples,
            }])),
        };
    }, { scale: MAP_SCALE, steps: 48, beat: 12 });

    console.log('aetherion twelve-second collision sweep:', JSON.stringify(sweep));
    expect(sweep.safeFailures).toBe(0);
    expect(Object.keys(sweep.motion)).toHaveLength(12);
    for (const [id, result] of Object.entries(sweep.motion)) {
        expect(result.colliderCount, `${id} owns gameplay collision`).toBeGreaterThan(0);
        expect(result.maxTravel, `${id} moves its collider`).toBeGreaterThan(MAP_SCALE * 2);
        expect(result.vacatedOldPose, `${id} does not block its old pose`).toBeTruthy();
        expect(result.corridorSamples, `${id} intersects its authored corridor`).toBeGreaterThan(0);
    }
    for (const [id, result] of Object.entries(sweep.shortcuts)) {
        expect(result.blocked, `${id} must be meaningfully closed`).toBeGreaterThanOrEqual(24);
        expect(result.free, `${id} must expose a usable opening`).toBeGreaterThanOrEqual(8);
    }
});

test('Aetherion route heatmap keeps the outer line safe and times all three fast lanes', async ({ page }) => {
    test.setTimeout(180_000);
    await startAetherion(page);

    const heatmap = await page.evaluate(({ scale, steps, beat }) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const hitbox = game.entityManager.humanPlayers[0].hitboxRadius;
        const world = ([x, y, z]) => ({ x: x * scale, y: y * scale, z: z * scale });
        const routeIsClear = (points) => {
            for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
                const from = world(points[segmentIndex - 1]);
                const to = world(points[segmentIndex]);
                const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
                const samples = Math.max(2, Math.ceil(distance / (2 * scale)));
                for (let sample = 0; sample <= samples; sample += 1) {
                    const t = sample / samples;
                    if (arena.checkCollisionFast({
                        x: from.x + (to.x - from.x) * t,
                        y: from.y + (to.y - from.y) * t,
                        z: from.z + (to.z - from.z) * t,
                    }, hitbox)) return false;
                }
            }
            return true;
        };
        const routes = {
            outer_ascent: [[145, 24, -100], [145, 84, -100], [145, 84, 100], [-145, 84, 100], [-145, 144, 100], [-145, 144, -100]],
            safe_foundry: [[-138, 30, -90], [-138, 30, 70]],
            safe_gallery: [[138, 100, 35], [138, 100, 115]],
            safe_crown: [[-145, 154, 70], [-145, 154, -55]],
            fast_foundry: [[0, 37.5, -10], [0, 37.5, 10]],
            fast_gallery: [[60, 98, 20], [80, 98, 20]],
            fast_crown: [[0, 164.5, -10], [0, 164.5, 10]],
        };
        const samples = Object.fromEntries(Object.keys(routes).map((id) => [id, []]));
        for (let index = 0; index < steps; index += 1) {
            arena.setGlbAnimationElapsedSeconds((beat * index) / steps);
            arena.update(1 / 1000);
            for (const [id, route] of Object.entries(routes)) samples[id].push(routeIsClear(route));
        }
        return {
            hitbox,
            routes: Object.fromEntries(Object.entries(samples).map(([id, values]) => [id, {
                clear: values.filter(Boolean).length,
                blocked: values.filter((value) => !value).length,
                values,
            }])),
        };
    }, { scale: MAP_SCALE, steps: 48, beat: 12 });

    console.log('aetherion physical route heatmap:', JSON.stringify(heatmap));
    expect(heatmap.hitbox).toBeGreaterThan(0);
    for (const id of ['outer_ascent', 'safe_foundry', 'safe_gallery', 'safe_crown']) {
        expect(heatmap.routes[id].clear, `${id} stays physically flyable`).toBe(48);
    }
    for (const id of ['fast_foundry', 'fast_gallery', 'fast_crown']) {
        expect(heatmap.routes[id].clear, `${id} exposes a useful opening`).toBeGreaterThanOrEqual(8);
        expect(heatmap.routes[id].blocked, `${id} preserves the timing risk`).toBeGreaterThanOrEqual(24);
    }
});

test('five Aetherion Hunt bots traverse a five-minute accelerated desktop run', async ({ page }) => {
    test.setTimeout(240_000);
    await startAetherion(page, { botCount: 5, modePath: 'fight' });

    const run = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const arena = game.arena;
        const bots = manager.bots.map((entry) => entry.player);
        const stats = new Map(bots.map((bot) => [bot.index, {
            cells: new Set(),
            last: null,
            stationarySamples: 0,
            maxStationarySamples: 0,
            finite: true,
            inBounds: true,
        }]));
        const previousOutcomeAuthority = manager.isFightOutcomeAuthority;
        manager.isFightOutcomeAuthority = false;
        const dt = 1 / 30;
        const ticks = 300 * 30;
        try {
            for (let tick = 0; tick < ticks; tick += 1) {
                arena.update(dt);
                manager.update(dt, game.input, tick + 1);
                if (tick % 30 !== 0) continue;
                for (const bot of bots) {
                    const state = stats.get(bot.index);
                    const { x, y, z } = bot.position;
                    state.finite &&= [x, y, z].every(Number.isFinite);
                    state.inBounds &&= x >= arena.bounds.minX && x <= arena.bounds.maxX
                        && y >= arena.bounds.minY && y <= arena.bounds.maxY
                        && z >= arena.bounds.minZ && z <= arena.bounds.maxZ;
                    state.cells.add(`${Math.round(x / 60)}:${Math.round(y / 60)}:${Math.round(z / 60)}`);
                    if (state.last && Math.hypot(x - state.last.x, y - state.last.y, z - state.last.z) < 1) {
                        state.stationarySamples += 1;
                    } else {
                        state.stationarySamples = 0;
                    }
                    state.maxStationarySamples = Math.max(state.maxStationarySamples, state.stationarySamples);
                    state.last = { x, y, z };
                }
            }
        } finally {
            manager.isFightOutcomeAuthority = previousOutcomeAuthority;
        }
        return {
            seconds: ticks * dt,
            botRoles: bots.map((bot) => bot.scenarioRole),
            aliveBots: bots.filter((bot) => bot.alive).length,
            turretShots: manager.getStaticTurretSnapshot()
                .reduce((sum, turret) => sum + turret.shotsFired, 0),
            stats: [...stats.entries()].map(([index, state]) => ({
                index,
                visitedCells: state.cells.size,
                maxStationarySeconds: state.maxStationarySamples,
                finite: state.finite,
                inBounds: state.inBounds,
            })),
        };
    });

    console.log('aetherion accelerated hunt run:', JSON.stringify(run));
    expect(run.seconds).toBe(300);
    expect(run.botRoles).toEqual(['guard', 'flanker', 'pursuer', 'interceptor', 'flanker']);
    // Deaths and respawn delays are expected in Hunt; requiring a majority alive at an
    // arbitrary final tick would turn a healthy combat run into a timing lottery.
    expect(run.aliveBots).toBeGreaterThanOrEqual(2);
    for (const bot of run.stats) {
        expect(bot.finite, `bot ${bot.index} stays numerically stable`).toBeTruthy();
        expect(bot.inBounds, `bot ${bot.index} stays inside Aetherion`).toBeTruthy();
        expect(bot.visitedCells, `bot ${bot.index} traverses the map`).toBeGreaterThanOrEqual(4);
        expect(bot.maxStationarySeconds, `bot ${bot.index} does not deadlock`).toBeLessThan(30);
    }
});

test('three Aetherion launches keep stable scene, track and collider counts', async ({ page }) => {
    test.setTimeout(300_000);
    const footprints = [];
    for (let launch = 0; launch < 3; launch += 1) {
        await startAetherion(page);
        footprints.push(await runtimeFootprint(page));
        await returnToMenu(page);
    }
    expect(footprints).toHaveLength(3);
    expect(footprints[1]).toEqual(footprints[0]);
    expect(footprints[2]).toEqual(footprints[0]);
});
