import { writeFile } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Investigation only: candidates are injected into the running test instance.
// No product source or player's stored settings are changed.
test.describe.configure({ timeout: 360000 });
const auditTimings = process.env.PW_PERF_AUDIT_TIMING !== '0';

for (const mapKey of ['standard', 'cherry_grove', 'dandelion_sky']) {
    test(`performance audit: ${mapKey} real GPU uploads and identical pixels`, async ({ page, electronApp }, testInfo) => {
        await waitForLoadedGame(page);
        await electronApp.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            if (window.isMaximized()) window.unmaximize();
            window.setContentSize(1920, 1080);
            window.showInactive();
            window.webContents.setBackgroundThrottling(false);
        });
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', mapKey);
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '4'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => window.GAME_INSTANCE.settings.numBots === 4);
        await page.click('#btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const r = game.renderer;
            r.qualityController.setQualityLock(true, 'performance-audit');
            r.setQuality('HIGH'); r.setShadowQuality(3); r.setBloomQuality(1);
            r.renderer.setPixelRatio(1); r.postProcessingPipeline.setPixelRatio(1);
            r.viewportSystem.width = 1920; r.viewportSystem.height = 1080;
            r.renderer.setSize(1920, 1080); r.postProcessingPipeline.setSize(1920, 1080);
            r.viewportSystem.updateCameraAspects(r.cameras);
        });
        const baseline = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const times = [];
            let previous = 0;
            const start = performance.now();
            await new Promise((resolve) => {
                const sample = (now) => {
                    if (previous && now - start >= 2000) times.push(now - previous);
                    previous = now;
                    if (now - start < 10000) requestAnimationFrame(sample); else resolve();
                };
                requestAnimationFrame(sample);
            });
            const sorted = times.slice().sort((a, b) => a - b);
            const p = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
            const snapshot = game.runtimePerfProfiler.getSnapshot?.({ windowSize: times.length }) || null;
            game.gameLoop.stop();
            return {
                frames: times.length, fps: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
                p50: p(.5), p95: p(.95), p99: p(.99),
                state: game.state, actors: game.entityManager.players.length,
                quality: game.renderer.qualityController.getQualityState(),
                gpu: game.renderer.qualityController.gpuFrameTimer.getStats(),
                actorDetails: game.entityManager.players.map((player) => ({ index: player.index, bot: player.isBot })),
                cpu: snapshot ? { frameMs: snapshot.frameMs, subsystems: snapshot.subsystems } : null,
            };
        });
        const report = await page.evaluate(async ({ mapKey, auditTimings }) => {
            const game = window.GAME_INSTANCE;
            const renderer = game.renderer;
            const r = renderer.renderer;
            const gl = r.getContext();
            const extension = gl.getExtension('WEBGL_debug_renderer_info');
            const gpuName = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
            const records = [];
            const boundBuffers = new Map();
            let recording = false;
            const originalSubData = gl.bufferSubData;
            gl.bufferSubData = function (target, offset, source, sourceOffset, sourceCount) {
                if (recording && ArrayBuffer.isView(source)) {
                    const bytes = (arguments.length >= 5 ? sourceCount : source.length) * source.BYTES_PER_ELEMENT;
                    const buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
                    records.push({ bytes, offset, buffer });
                    boundBuffers.set(buffer, new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice());
                }
                return originalSubData.apply(this, arguments);
            };
            const pixels = () => {
                const result = new Uint8Array(r.domElement.width * r.domElement.height * 4);
                gl.readPixels(0, 0, r.domElement.width, r.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, result);
                return result;
            };
            const capture = (dirty) => {
                records.length = 0; dirty(); recording = true;
                try { renderer.render(); } finally { recording = false; }
                return { bytes: records.reduce((sum, entry) => sum + entry.bytes, 0), calls: records.length, image: pixels() };
            };
            const pixelDiff = (a, b) => {
                let changed = 0, maxChannelDelta = 0;
                for (let i = 0; i < a.length; i++) {
                    const difference = Math.abs(a[i] - b[i]);
                    if (difference) changed++;
                    maxChannelDelta = Math.max(maxChannelDelta, difference);
                }
                return { changedChannels: changed, maxChannelDelta };
            };
            const timeRender = async (dirty) => {
                if (!auditTimings) return { skipped: true };
                const cpu = [], frame = [];
                renderer.qualityController.gpuFrameTimer.reset();
                let previous = 0;
                for (let i = 0; i < 90; i++) {
                    const now = await new Promise(requestAnimationFrame);
                    const start = performance.now(); dirty(); renderer.render();
                    if (i >= 30) { cpu.push(performance.now() - start); if (previous) frame.push(now - previous); }
                    previous = now;
                }
                cpu.sort((a, b) => a - b); frame.sort((a, b) => a - b);
                return { cpuMedianMs: cpu[Math.floor(cpu.length / 2)], frameP95Ms: frame[Math.floor(frame.length * .95)],
                    gpu: renderer.qualityController.gpuFrameTimer.getStats() };
            };
            const checks = [];
            try {
                if (mapKey === 'standard') {
                    const particles = game.particles;
                    particles.clear();
                    const camera = renderer.cameras[0];
                    const anchor = camera.position.clone().addScaledVector(camera.getWorldDirection(camera.position.clone()), 6);
                    for (const count of [100, 500, 1000]) {
                        particles.mesh.count = 0; renderer.render();
                        const emptyImage = pixels();
                        particles.count = count;
                        for (let i = 0; i < count; i++) {
                            const index = i * 3;
                            particles.positions[index] = anchor.x + (i % 10) * .2;
                            particles.positions[index + 1] = anchor.y + 2 + Math.floor(i / 100) * .2;
                            particles.positions[index + 2] = anchor.z + Math.floor(i / 10) % 10 * .2;
                            particles.velocities.fill(0, index, index + 3);
                            particles.colors.set([1, .35, .1], index);
                            particles.lifetimes[i] = particles.maxLifetimes[i] = 10;
                            particles.gravities[i] = 0; particles.scales[i] = .25;
                        }
                        particles.update(0);
                        renderer.render();
                        const full = () => {
                            particles.mesh.instanceMatrix.clearUpdateRanges(); particles.mesh.instanceColor.clearUpdateRanges();
                            particles.mesh.instanceMatrix.needsUpdate = true; particles.mesh.instanceColor.needsUpdate = true;
                        };
                        const prefix = () => {
                            particles.mesh.instanceMatrix.addUpdateRange(0, count * 16);
                            particles.mesh.instanceColor.addUpdateRange(0, count * 3);
                            particles.mesh.instanceMatrix.needsUpdate = true; particles.mesh.instanceColor.needsUpdate = true;
                        };
                        const before = capture(full), after = capture(prefix);
                        const timing = [];
                        for (const order of [['full', 'prefix'], ['prefix', 'full'], ['full', 'prefix']]) {
                            for (const variant of order) timing.push({ variant, ...(await timeRender(variant === 'full' ? full : prefix)) });
                        }
                        checks.push({ candidate: 'particle-prefix', count, baselineBytes: before.bytes, candidateBytes: after.bytes,
                            baselineCalls: before.calls, candidateCalls: after.calls, pixels: pixelDiff(before.image, after.image),
                            visibleEffect: pixelDiff(emptyImage, before.image), timing });
                    }
                    particles.clear();
                    const savedCameras = renderer.cameras;
                    const savedLayout = renderer.viewportSystem.layout;
                    const savedAutoUpdate = r.shadowMap.autoUpdate;
                    const makeCameras = (count) => Array.from({ length: count }, (_, index) => {
                        const camera = savedCameras[0].clone();
                        camera.position.x += index * 3;
                        camera.updateMatrixWorld(true);
                        return camera;
                    });
                    try {
                        for (const count of [2, 4]) {
                            renderer.cameras = makeCameras(count);
                            renderer.setViewportLayout(count === 2 ? 'two_columns' : 'four_grid');
                            const full = () => { r.shadowMap.autoUpdate = true; };
                            const once = () => { r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; };
                            const before = capture(full), baselineDraws = r.info.render.calls;
                            const after = capture(once), candidateDraws = r.info.render.calls;
                            const timing = [];
                            for (const variant of ['full', 'once', 'once', 'full']) {
                                timing.push({ variant, ...(await timeRender(variant === 'full' ? full : once)) });
                            }
                            checks.push({ candidate: 'split-shadow-once', cameras: count, baselineDraws, candidateDraws,
                                baselineBytes: before.bytes, candidateBytes: after.bytes,
                                pixels: pixelDiff(before.image, after.image), timing });
                        }
                    } finally {
                        r.shadowMap.autoUpdate = savedAutoUpdate;
                        renderer.cameras = savedCameras;
                        renderer.setViewportLayout(savedLayout);
                    }
                } else if (mapKey === 'cherry_grove') {
                    const controller = game.arena._cherryLeaves;
                    controller.reset();
                    const group = controller.leaves[0].batchGroup;
                    const released = group.leaves.slice(0, Math.min(12, group.leaves.length));
                    for (const leaf of released) controller.release(leaf.index, 0);
                    controller.update(2);
                    // Frame the tested moving leaves so pixel equality cannot pass merely
                    // because the selected group is behind the player's camera.
                    const matrix = renderer.cameras[0].matrixWorld.clone();
                    group.batch.getMatrixAt(released[0].instance, matrix);
                    const target = released[0].releasePosition.clone().setFromMatrixPosition(matrix);
                    group.batch.localToWorld(target);
                    renderer.cameras[0].position.copy(target).add(target.clone().set(3, 2, 3));
                    renderer.cameras[0].lookAt(target); renderer.cameras[0].updateMatrixWorld(true);
                    renderer.render();
                    const full = () => { for (const batch of controller.batches) { batch.instanceMatrix.clearUpdateRanges(); batch.instanceMatrix.needsUpdate = true; } };
                    const partial = () => {
                        for (const leaf of released) group.batch.instanceMatrix.addUpdateRange(leaf.instance * 16, 16);
                        group.batch.instanceMatrix.needsUpdate = true;
                    };
                    const before = capture(full), after = capture(partial);
                    const originalMatrices = group.batch.instanceMatrix.array.slice();
                    for (const leaf of released) {
                        group.batch.instanceMatrix.array.fill(0, leaf.instance * 16, leaf.instance * 16 + 16);
                        group.batch.instanceMatrix.array[leaf.instance * 16 + 15] = 1;
                    }
                    group.batch.instanceMatrix.needsUpdate = true; renderer.render();
                    const emptyImage = pixels();
                    group.batch.instanceMatrix.array.set(originalMatrices);
                    group.batch.instanceMatrix.needsUpdate = true; renderer.render();
                    checks.push({ candidate: 'cherry-dirty-groups', leaves: controller.count, groups: controller.batches.length,
                        released: released.length, baselineBytes: before.bytes, candidateBytes: after.bytes,
                        baselineCalls: before.calls, candidateCalls: after.calls, pixels: pixelDiff(before.image, after.image),
                        visibleEffect: pixelDiff(emptyImage, before.image),
                        timing: [{ variant: 'full', ...(await timeRender(full)) }, { variant: 'partial', ...(await timeRender(partial)) },
                            { variant: 'partial', ...(await timeRender(partial)) }, { variant: 'full', ...(await timeRender(full)) }] });
                } else {
                    const controller = game.arena._dandelionSeeds;
                    const batch = controller?._renderBatch;
                    const meshes = batch?._meshes || [];
                    const samples = [];
                    for (const mesh of meshes) {
                        const start = performance.now();
                        for (let i = 0; i < 100; i++) mesh.computeBoundingSphere();
                        samples.push({ instances: mesh.count, meanRefitMs: (performance.now() - start) / 100 });
                    }
                    checks.push({ candidate: 'dandelion-bound-refit', seeds: controller?.seeds?.length || 0, groups: meshes.length,
                        samples, totalRefitMs: samples.reduce((sum, sample) => sum + sample.meanRefitMs, 0) });
                }
                const collision = game.arena._collision;
                const obstacles = game.arena.obstacles;
                const ordinal = new Map(obstacles.map((obstacle, i) => [obstacle, i]));
                const origin = game.entityManager.players[0].position.clone();
                const direction = origin.clone(), midpoint = origin.clone();
                const signature = (hit) => JSON.stringify({ hit: hit.hit, distance: hit.distance, kind: hit.kind,
                    sourceName: hit.sourceName, point: hit.point.toArray(), normal: hit.normal.toArray() });
                let candidatePairs = 0, mismatches = 0, narrowed = 0;
                const queries = [];
                for (let i = 0; i < 240; i++) {
                    const distance = [20, 80, 200][i % 3];
                    direction.set(Math.sin(i * 2.399), Math.cos(i * .73) * .35, Math.cos(i * 2.399)).normalize();
                    const reference = signature(collision.raycast(origin, direction, distance));
                    midpoint.copy(origin).addScaledVector(direction, distance / 2);
                    const selected = [...collision._getFastCollisionObstacles(midpoint, distance / 2 + 1e-6)]
                        .sort((a, b) => ordinal.get(a) - ordinal.get(b));
                    candidatePairs += selected.length;
                    if (selected.length < obstacles.length) narrowed++;
                    try {
                        game.arena.obstacles = selected;
                        if (signature(collision.raycast(origin, direction, distance)) !== reference) mismatches++;
                    } finally { game.arena.obstacles = obstacles; }
                    queries.push({ origin: origin.clone(), direction: direction.clone(), distance });
                }
                const measureQueries = (indexed) => {
                    const start = performance.now();
                    for (let repeat = 0; repeat < 5; repeat++) for (const query of queries) {
                        if (!indexed) { collision.raycast(query.origin, query.direction, query.distance); continue; }
                        midpoint.copy(query.origin).addScaledVector(query.direction, query.distance / 2);
                        const selected = [...collision._getFastCollisionObstacles(midpoint, query.distance / 2 + 1e-6)]
                            .sort((a, b) => ordinal.get(a) - ordinal.get(b));
                        try { game.arena.obstacles = selected; collision.raycast(query.origin, query.direction, query.distance); }
                        finally { game.arena.obstacles = obstacles; }
                    }
                    return (performance.now() - start) / 1200;
                };
                const rayTiming = [];
                for (const indexed of [false, true, true, false]) rayTiming.push({ indexed, meanQueryMs: measureQueries(indexed) });
                checks.push({ candidate: 'ray-grid-preselection', obstacles: obstacles.length, queries: 240,
                    linearPairs: obstacles.length * 240, candidatePairs, narrowed, mismatches, timing: rayTiming });
                const phase = game.entityManager._playerLifecycleSystem._collisionPhase;
                const projectiles = game.entityManager._projectileSystem._simulationOps;
                const arena = game.arena;
                const end = origin.clone(), from = origin.clone(), center = origin.clone();
                const probePlayer = { position: origin.clone(), isBot: false };
                const probeProjectile = { position: origin.clone(), previousPosition: origin.clone(), radius: .2 };
                const sweeps = queries.slice(0, 120).map((query, index) => ({
                    from: query.origin.clone(), to: query.origin.clone().addScaledVector(query.direction, [2, 8, 20][index % 3]),
                }));
                const hitSignature = (hit, position) => JSON.stringify({ hit: !!hit?.hit, kind: hit?.kind,
                    sourceName: hit?.sourceName, normal: hit?.normal?.toArray?.(), position: position.toArray() });
                const executeSweep = (query, type, guarded) => {
                    from.copy(query.from); end.copy(query.to);
                    const actor = type === 'player' ? probePlayer : probeProjectile;
                    actor.position.copy(end);
                    if (type === 'projectile') actor.previousPosition.copy(from);
                    if (guarded) {
                        // Shootable seed/kerne raycasts remain before the arena guard. Any seed
                        // candidate uses the unchanged product routine for blocker precedence.
                        const distance = from.distanceTo(end);
                        direction.subVectors(end, from).normalize();
                        const shootable = type === 'projectile'
                            ? arena.raycastDandelionSeed(from, direction, distance, .2) : null;
                        center.copy(from).add(end).multiplyScalar(.5);
                        if (!shootable && !arena.checkCollisionBroad(center, distance / 2 + .2, false)) return null;
                    }
                    return type === 'player' ? phase._probeSweptArenaCollision(actor, from, .2)
                        : projectiles._resolveArenaCollision(actor, arena);
                };
                for (const type of ['player', 'projectile']) {
                    let sweepMismatches = 0, baselineProbes = 0, candidateProbes = 0;
                    const originalInfo = arena.getCollisionInfo;
                    let probes = 0;
                    arena.getCollisionInfo = function (...args) { probes++; return originalInfo.apply(this, args); };
                    try {
                        for (const query of sweeps) {
                            probes = 0;
                            const a = executeSweep(query, type, false);
                            const baselineResult = hitSignature(a, (type === 'player' ? probePlayer : probeProjectile).position);
                            baselineProbes += probes; probes = 0;
                            const b = executeSweep(query, type, true);
                            const candidateResult = hitSignature(b, (type === 'player' ? probePlayer : probeProjectile).position);
                            candidateProbes += probes;
                            if (baselineResult !== candidateResult) sweepMismatches++;
                        }
                    } finally { arena.getCollisionInfo = originalInfo; }
                    const timing = [];
                    for (const guarded of [false, true, true, false]) {
                        const start = performance.now();
                        for (let repeat = 0; repeat < 5; repeat++) for (const query of sweeps) executeSweep(query, type, guarded);
                        timing.push({ guarded, meanSweepMs: (performance.now() - start) / 600 });
                    }
                    checks.push({ candidate: `${type}-sweep-guard`, queries: sweeps.length,
                        baselineProbes, candidateProbes, mismatches: sweepMismatches, timing });
                }
                let buffersChecked = 0, bufferMismatches = 0;
                // Read back actual uploaded buffers, not just the JavaScript attribute arrays.
                const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
                for (const [buffer, expected] of boundBuffers) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    const size = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
                    const data = new Uint8Array(size);
                    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
                    buffersChecked++;
                    if (data.length !== expected.length || data.some((byte, i) => byte !== expected[i])) bufferMismatches++;
                }
                gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
                return { mapKey, gpuName, dimensions: [r.domElement.width, r.domElement.height],
                    visibility: document.visibilityState, quality: renderer.qualityController.getQualityState(), checks,
                    gpuReadback: { buffersChecked, bufferMismatches }, glError: gl.getError() };
            } finally { gl.bufferSubData = originalSubData; }
        }, { mapKey, auditTimings });
        const fullReport = { baseline, ...report };
        await writeFile(testInfo.outputPath('performance-audit.json'), JSON.stringify(fullReport, null, 2));
        await testInfo.attach('performance-audit', { path: testInfo.outputPath('performance-audit.json'), contentType: 'application/json' });
        console.log(`[performance-audit] ${JSON.stringify(fullReport)}`);
        expect(report.dimensions).toEqual([1920, 1080]);
        expect(report.visibility).toBe('visible');
        expect(report.quality.effectiveQuality).toBe('HIGH');
        expect(report.glError).toBe(0);
        expect(report.gpuReadback.bufferMismatches).toBe(0);
        expect(baseline.state).toBe('PLAYING');
        // Kirschhain intentionally selects its authored five-bot scenario at match start.
        expect(baseline.actors).toBe(mapKey === 'cherry_grove' ? 6 : 5);
        for (const check of report.checks) {
            if (check.mismatches !== undefined) expect(check.mismatches).toBe(0);
            if (check.visibleEffect) expect(check.visibleEffect.changedChannels).toBeGreaterThan(0);
            if (!check.pixels) continue;
            expect(check.pixels.changedChannels).toBe(0);
            expect(check.candidateBytes).toBeLessThanOrEqual(check.baselineBytes);
        }
        await page.screenshot({ path: testInfo.outputPath('scene.png') });
    });
}
