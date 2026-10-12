import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './helpers.desktop.js';
import { loadGame } from './helpers.js';
import { listRenderBudgetMapKeys } from './helpers/render-budget-maps.mjs';

// Render budget probe for every map a player can pick. It counts what one frame asks of the GPU
// at fixed camera stations (draw calls, triangles) and what the scene carries (lights by kind,
// shadow casters, transparent and transmissive meshes, textures, shader programs). These counts
// do not depend on the machine, so the faster test machine can guard the budget of the slower
// target PC. Frame times are not measured here: a render loop has no meaningful frame time.
//
// PW_RENDER_BUDGET_CALIBRATE=1 additionally plays the map with four bots and records the real
// frame rate. Only run that on the target PC with nothing else on the GPU; it feeds the budget.
// PW_RENDER_BUDGET_OUT=<file> appends one JSON line per map.

const calibrate = process.env.PW_RENDER_BUDGET_CALIBRATE === '1';
const RENDER_SIZE = Object.freeze({ width: 1920, height: 1080 });
const CALIBRATION = Object.freeze({ bots: 4, warmupMs: 5000, windowMs: 20000 });

async function startMap(page, mapKey, bots) {
    await page.evaluate(async ({ mapKey, bots }) => {
        const game = window.GAME_INSTANCE;
        game.settings.mode = '1p';
        game.settings.numBots = bots;
        game.settings.gameMode = 'HUNT';
        game.settings.mapKey = mapKey;
        game.settings.localSettings = game.settings.localSettings || {};
        game.settings.localSettings.sessionType = 'single';
        game.settings.localSettings.modePath = 'fight';
        game.runtimeCoordinator.onSettingsChanged();
        await Promise.resolve(game.startMatch());
    }, { mapKey, bots });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        const arena = game?.arena;
        if (game?.state !== 'PLAYING' || arena?.currentMapKey !== mapKey) return false;
        const definition = arena.currentMapDefinition || {};
        const hasGlb = !!definition.glbModel || (definition.glbModels?.length || 0) > 0;
        return !hasGlb || !!arena._glbScene || !!arena._glbLoadError;
    }, mapKey, { timeout: 180_000 });
}

// The shipped default look at 1080p: quality HIGH locked, shadows 3, bloom off, pixel ratio 1.
async function pinShippedQuality(page) {
    await page.evaluate(({ width, height }) => {
        const r = window.GAME_INSTANCE.renderer;
        r.qualityController.setQualityLock(true, 'render-budget-fixed-resolution');
        r.setQuality('HIGH');
        r.setShadowQuality(3);
        r.setBloomQuality(0);
        r.renderer.setPixelRatio(1);
        r.postProcessingPipeline.setPixelRatio(1);
        r.viewportSystem.width = width;
        r.viewportSystem.height = height;
        r.renderer.setSize(width, height);
        r.postProcessingPipeline.setSize(width, height);
        r.viewportSystem.updateCameraAspects(r.cameras);
        r._width = width;
        r._height = height;
    }, RENDER_SIZE);
}

function countFrame(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const r = game.renderer;
        const three = r.renderer;
        const arena = game.arena;
        const b = arena.bounds;
        const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
        const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
        // World positions only: authored anchors are not in world scale on every map.
        const spawn = game.entityManager.players[0]?.position;
        const insetX = (b.maxX - b.minX) * 0.45;
        const insetZ = (b.maxZ - b.minZ) * 0.45;
        const sideY = b.minY + (b.maxY - b.minY) * 0.3;
        const stations = [];
        if (spawn) stations.push({ id: 'spawn', from: [spawn.x, spawn.y, spawn.z] });
        stations.push(
            { id: 'north', from: [center.x, sideY, center.z - insetZ] },
            { id: 'east', from: [center.x + insetX, sideY, center.z] },
            { id: 'south', from: [center.x, sideY, center.z + insetZ] },
            { id: 'west', from: [center.x - insetX, sideY, center.z] },
            { id: 'overview', from: [center.x, b.maxY + extent * 0.35, b.maxZ + extent * 0.35], target: center },
        );

        const camera = r.cameras[0];
        const savedPosition = camera.position.clone();
        const savedQuaternion = camera.quaternion.clone();
        const previousAutoReset = three.info.autoReset;
        three.info.autoReset = false;
        const frames = [];
        for (const station of stations) {
            const [x, y, z] = station.from;
            const flatDistance = Math.hypot(center.x - x, center.z - z);
            const target = station.target
                || (flatDistance < 1 ? { x: x + extent, y, z } : { x: center.x, y, z: center.z });
            camera.position.set(x, y, z);
            camera.lookAt(target.x, target.y, target.z);
            camera.updateMatrixWorld(true);
            three.info.reset();
            r.render();
            frames.push({ id: station.id, calls: three.info.render.calls, triangles: three.info.render.triangles });
        }
        three.info.autoReset = previousAutoReset;
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        camera.updateMatrixWorld(true);

        const lights = { point: 0, spot: 0, directional: 0, hemisphere: 0, ambient: 0, rectArea: 0, shadowCasting: 0 };
        const meshes = { total: 0, shadowCasters: 0, transparent: 0, transmissive: 0, instanced: 0 };
        r.scene.traverseVisible((node) => {
            if (node.isLight) {
                const kind = node.isPointLight ? 'point' : node.isSpotLight ? 'spot' : node.isDirectionalLight ? 'directional'
                    : node.isHemisphereLight ? 'hemisphere' : node.isRectAreaLight ? 'rectArea' : 'ambient';
                lights[kind] += 1;
                if (node.castShadow && node.shadow) lights.shadowCasting += 1;
                return;
            }
            if (!node.isMesh && !node.isPoints && !node.isLine) return;
            meshes.total += 1;
            if (node.isInstancedMesh) meshes.instanced += 1;
            if (node.castShadow) meshes.shadowCasters += 1;
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            if (materials.some((material) => material?.transparent)) meshes.transparent += 1;
            if (materials.some((material) => (material?.transmission || 0) > 0)) meshes.transmissive += 1;
        });
        return {
            frames,
            maxCalls: Math.max(...frames.map((frame) => frame.calls)),
            maxTriangles: Math.max(...frames.map((frame) => frame.triangles)),
            lights,
            meshes,
            textures: three.info.memory.textures,
            geometries: three.info.memory.geometries,
            programs: three.info.programs?.length || 0,
            pickups: game.entityManager.powerupManager?.items?.length || 0,
            glbLoadError: arena._glbLoadError || null,
        };
    });
}

// Real frames of a live match: the same window logic as map-performance, condensed.
function measurePlay(page) {
    return page.evaluate(({ warmupMs, windowMs }) => new Promise((resolve) => {
        const game = window.GAME_INSTANCE;
        const three = game.renderer.renderer;
        const gl = three.getContext();
        const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const previousAutoReset = three.info.autoReset;
        three.info.autoReset = false;
        const samples = [];
        const gpuMs = [];
        const pending = [];
        let draws = 0;
        let triangles = 0;
        let playing = 0;
        let openQuery = null;
        const start = performance.now();
        let last = start;
        const sample = (now) => {
            const elapsed = now - start;
            const frameMs = now - last;
            last = now;
            if (openQuery) {
                gl.endQuery(timer.TIME_ELAPSED_EXT);
                pending.push(openQuery);
                openQuery = null;
            }
            while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
                const query = pending.shift();
                if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
                gl.deleteQuery(query);
            }
            const inWindow = elapsed >= warmupMs && elapsed < warmupMs + windowMs;
            if (inWindow) {
                samples.push(frameMs);
                draws += three.info.render.calls;
                triangles += three.info.render.triangles;
                if (game.state === 'PLAYING') playing += 1;
            }
            three.info.reset();
            if (inWindow && timer) {
                openQuery = gl.createQuery();
                gl.beginQuery(timer.TIME_ELAPSED_EXT, openQuery);
            }
            if (elapsed < warmupMs + windowMs) return requestAnimationFrame(sample);
            three.info.autoReset = previousAutoReset;
            const sorted = samples.slice().sort((a, b) => a - b);
            const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
            const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
            const gpuSorted = gpuMs.slice().sort((a, b) => a - b);
            const extension = gl.getExtension('WEBGL_debug_renderer_info');
            resolve({
                fps: 1000 / mean, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
                frames: sorted.length, playingRatio: playing / Math.max(1, sorted.length),
                meanDraws: draws / Math.max(1, sorted.length), meanTriangles: triangles / Math.max(1, sorted.length),
                gpuMsMean: gpuSorted.length ? gpuSorted.reduce((sum, value) => sum + value, 0) / gpuSorted.length : null,
                gpuMsP50: gpuSorted.length ? gpuSorted[Math.floor(gpuSorted.length / 2)] : null,
                dimensions: [three.domElement.width, three.domElement.height],
                gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
            });
        };
        requestAnimationFrame(sample);
    }), CALIBRATION);
}

for (const mapKey of listRenderBudgetMapKeys()) {
    test(`RB: ${mapKey} render counters`, async ({ page, electronApp }, testInfo) => {
        test.setTimeout(calibrate ? 420_000 : 240_000);
        await loadGame(page);
        await startMap(page, mapKey, 0);
        await pinShippedQuality(page);
        const counts = await countFrame(page);
        const record = { mapKey, measuredAt: new Date().toISOString(), counts };

        if (calibrate) {
            await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.returnToMenu());
            await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
            await electronApp.evaluate(({ BrowserWindow }, size) => {
                const window = BrowserWindow.getAllWindows()[0];
                if (window.isMaximized()) window.unmaximize();
                window.setContentSize(size.width, size.height);
                window.webContents.setBackgroundThrottling(false);
            }, RENDER_SIZE);
            await startMap(page, mapKey, CALIBRATION.bots);
            await pinShippedQuality(page);
            // A normal keyboard turn keeps collision, bots and camera active, as in map-performance.
            await page.keyboard.down('a');
            record.play = await measurePlay(page);
            await page.keyboard.up('a');
        }

        console.log(`[render-budget] ${JSON.stringify(record)}`);
        await testInfo.attach('render-budget', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
        const outFile = process.env.PW_RENDER_BUDGET_OUT;
        if (outFile) {
            await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
            await appendFile(outFile, `${JSON.stringify(record)}\n`, 'utf8');
        }

        expect(counts.glbLoadError, `${mapKey}: the map world must load`).toBeNull();
        for (const frame of counts.frames) {
            expect(frame.calls, `${mapKey} ${frame.id}: a station must draw something`).toBeGreaterThan(0);
        }
        if (record.play) {
            expect(record.play.dimensions).toEqual([RENDER_SIZE.width, RENDER_SIZE.height]);
            expect(record.play.frames, `${mapKey}: too few frames to judge`).toBeGreaterThan((CALIBRATION.windowMs / 1000) * 5);
            expect(record.play.playingRatio, `${mapKey}: menu frames cannot count as gameplay`).toBeGreaterThan(0.99);
        }
    });
}
