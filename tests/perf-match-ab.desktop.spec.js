import { writeFile } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const measureSeconds = Number(process.env.PW_PERF_MATCH_SECONDS || 60);
const warmupSeconds = Number(process.env.PW_PERF_MATCH_WARMUP || 10);
const trialLimit = Number(process.env.PW_PERF_MATCH_TRIALS || 8);
const uploadScope = process.env.PW_PERF_UPLOAD_SCOPE || 'all';
if (!['all', 'particles', 'leaves'].includes(uploadScope)) throw new Error(`Invalid PW_PERF_UPLOAD_SCOPE: ${uploadScope}`);
test.describe.configure({ timeout: (measureSeconds + warmupSeconds + 45) * trialLimit * 1000 });

for (const mapKey of ['standard', 'cherry_grove', 'dandelion_sky']) {
    test(`moving match ABBA: ${mapKey}`, async ({ page, electronApp }, testInfo) => {
        await waitForLoadedGame(page);
        await electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win.isMaximized()) win.unmaximize();
            win.setContentSize(1920, 1080); win.showInactive();
            win.webContents.setBackgroundThrottling(false);
        });
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', mapKey);
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '4'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('#btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.gameLoop.stop();
            const prototype = Object.getPrototypeOf(game.entityManager._setupOps);
            window.__perfRestoreSeed = prototype.resolveMatchSeed;
            prototype.resolveMatchSeed = () => 45021;
        });
        const trials = [];
        try {
            for (const candidate of [false, true, true, false, false, true, true, false].slice(0, trialLimit)) {
                const row = await page.evaluate(async ({ candidate, measureSeconds, warmupSeconds, uploadScope, mapKey }) => {
                    const game = window.GAME_INSTANCE;
                    const nativeRandom = Math.random;
                    let state = 87103, renderState = 19471, updating = true;
                    Math.random = () => {
                        if (updating) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
                        renderState = (Math.imul(renderState, 1664525) + 1013904223) >>> 0;
                        return renderState / 4294967296;
                    };
                    try {
                        await game.startMatch();
                        game.gameLoop.stop();
                        const renderer = game.renderer, r = renderer.renderer, gl = r.getContext();
                        renderer.qualityController.setQualityLock(true, 'performance-match-ab');
                        renderer.setQuality('HIGH'); renderer.setShadowQuality(3); renderer.setBloomQuality(1);
                        r.setPixelRatio(1); renderer.postProcessingPipeline.setPixelRatio(1);
                        renderer.viewportSystem.width = 1920; renderer.viewportSystem.height = 1080;
                        r.setSize(1920, 1080); renderer.postProcessingPipeline.setSize(1920, 1080);
                        renderer.viewportSystem.updateCameraAspects(renderer.cameras);
                        const arena = game.arena, particles = game.particles, leaves = arena._cherryLeaves;
                        const particleArrays = new Set([particles.mesh.instanceMatrix.array,
                            ...(particles.mesh.instanceColor ? [particles.mesh.instanceColor.array] : [])]);
                        const leafArrays = new Set(leaves?.batches.map((batch) => batch.instanceMatrix.array) || []);
                        const affectParticles = uploadScope === 'all' || uploadScope === 'particles';
                        const affectLeaves = uploadScope === 'all' || uploadScope === 'leaves';
                        const cpu = { particleMs: 0, particleCalls: 0, leafMs: 0, leafCalls: 0 };
                        let measuring = false, simulationParticleUpdateCalls = 0;
                        const particleUpdate = particles.update;
                        particles.update = function (dt) {
                            if (updating && Number.isFinite(dt) && dt > 0) simulationParticleUpdateCalls++;
                            const started = measuring ? performance.now() : 0;
                            particleUpdate.call(this, dt);
                            if (!candidate && affectParticles) {
                                this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceColor?.clearUpdateRanges();
                            }
                            if (measuring) { cpu.particleMs += performance.now() - started; cpu.particleCalls++; }
                        };
                        const leafUpdate = leaves?.update;
                        const versions = leaves ? new Float64Array(leaves.batches.length) : null;
                        if (leaves) leaves.update = function (seconds) {
                            for (let i = 0; i < versions.length; i++) versions[i] = this.batches[i].instanceMatrix.version;
                            const started = measuring ? performance.now() : 0;
                            leafUpdate.call(this, seconds);
                            let changed = false;
                            for (let i = 0; i < versions.length; i++) changed ||= versions[i] !== this.batches[i].instanceMatrix.version;
                            if (!candidate && affectLeaves && changed) for (const batch of this.batches) {
                                batch.instanceMatrix.clearUpdateRanges(); batch.instanceMatrix.needsUpdate = true;
                            }
                            if (measuring) { cpu.leafMs += performance.now() - started; cpu.leafCalls++; }
                        };
                        const uploadBytes = { all: 0, particles: 0, leaves: 0 };
                        const uploadCalls = { all: 0, particles: 0, leaves: 0 };
                        const subData = gl.bufferSubData;
                        gl.bufferSubData = function (target, offset, source, sourceOffset, sourceCount) {
                            if (measuring && target === gl.ARRAY_BUFFER && ArrayBuffer.isView(source)) {
                                const bytes = (arguments.length >= 5 ? sourceCount : source.length) * source.BYTES_PER_ELEMENT;
                                uploadBytes.all += bytes; uploadCalls.all++;
                                if (particleArrays.has(source)) { uploadBytes.particles += bytes; uploadCalls.particles++; }
                                if (leafArrays.has(source)) { uploadBytes.leaves += bytes; uploadCalls.leaves++; }
                            }
                            return subData.apply(this, arguments);
                        };
                        const initial = game.entityManager.players.map((p) => ({ position: p.position.toArray(), alive: p.alive, bot: p.isBot }));
                        const isVisibleThroughParents = (object) => {
                            for (let current = object; current; current = current.parent) if (!current.visible) return false;
                            return true;
                        };
                        const cameraPosition = renderer.cameras[0]?.position;
                        const byCameraDistance = (a, b) => cameraPosition
                            ? a.releasePosition.distanceToSquared(cameraPosition) - b.releasePosition.distanceToSquared(cameraPosition)
                            : a.index - b.index;
                        const visibleLeaves = mapKey === 'cherry_grove'
                            ? leaves.leaves.filter((leaf) => isVisibleThroughParents(leaf.batchGroup.batch)).sort(byCameraDistance)
                            : [];
                        const visibleSelection = visibleLeaves.slice(0, 12);
                        const visibleSet = new Set(visibleSelection);
                        const fixtureLeaves = mapKey === 'cherry_grove'
                            ? [...visibleSelection, ...leaves.leaves.filter((leaf) => !visibleSet.has(leaf))
                                .sort(byCameraDistance).slice(0, 12 - visibleSelection.length)]
                            : [];
                        const fixtureIndices = fixtureLeaves.map((leaf) => leaf.index);
                        const fixtureSchedule = [];
                        const applyLeafFixture = (tick) => {
                            if (fixtureIndices.length === 0 || tick % 1200 !== 0) return;
                            leaves.reset();
                            const seconds = arena.glbAnimationElapsedSeconds;
                            for (const index of fixtureIndices) leaves.release(index, seconds);
                            fixtureSchedule.push({ tick, seconds, indices: [...fixtureIndices],
                                visibleBatchCount: new Set(fixtureLeaves.map((leaf) => leaf.batchGroup.batch)
                                    .filter(isVisibleThroughParents)).size });
                        };
                        const intervals = [], updateTimes = [], renderTimes = [], checkpoints = [], particleDiagnostics = [];
                        const totalTicks = Math.round((warmupSeconds + measureSeconds) * 60);
                        let ticks = 0, lastFrame = 0, renderedFrames = 0, gameStates = new Set(), moved = 0;
                        applyLeafFixture(0);
                        const begin = performance.now();
                        try {
                            await new Promise((resolve, reject) => {
                                const frame = (now) => {
                                    try {
                                        const elapsed = (now - begin) / 1000;
                                        measuring = ticks >= warmupSeconds * 60;
                                        if (measuring && lastFrame) intervals.push(now - lastFrame);
                                        lastFrame = now;
                                        const target = Math.min(totalTicks, Math.floor(elapsed * 60));
                                        const updateStart = performance.now();
                                        updating = true;
                                        while (ticks < target) {
                                            measuring = ticks >= warmupSeconds * 60;
                                            applyLeafFixture(ticks + 1);
                                            game.gameLoop.updateFn(1 / 60); ticks++;
                                            if (ticks % 600 === 0) {
                                                checkpoints.push({ tick: ticks,
                                                    players: game.entityManager.players.map((p) => ({ position: p.position.toArray(),
                                                        quaternion: p.quaternion.toArray(), alive: p.alive, health: p.health, score: p.score })),
                                                    simulationParticleUpdateCalls,
                                                    leaves: leaves?.serialize?.() || [] });
                                                particleDiagnostics.push({ tick: ticks, activeCount: particles.count, renderedFrames });
                                            }
                                        }
                                        updating = false;
                                        if (measuring) updateTimes.push(performance.now() - updateStart);
                                        game.gameLoop.renderFrameId++;
                                        const renderStart = performance.now(); game.gameLoop.renderFn(1, 1 / 60);
                                        renderedFrames++;
                                        if (measuring) renderTimes.push(performance.now() - renderStart);
                                        gameStates.add(game.state);
                                        moved = Math.max(moved, game.entityManager.players[0].position.distanceTo({
                                            x: initial[0].position[0], y: initial[0].position[1], z: initial[0].position[2] }));
                                        if (ticks >= totalTicks) resolve(); else requestAnimationFrame(frame);
                                    } catch (error) { reject(error); }
                                };
                                requestAnimationFrame(frame);
                            });
                            const summary = (values) => {
                                values.sort((a, b) => a - b);
                                return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
                                    p95Ms: values[Math.min(values.length - 1, Math.ceil(values.length * .95) - 1)] };
                            };
                            const final = game.entityManager.players.map((p) => ({ position: p.position.toArray(),
                                quaternion: p.quaternion.toArray(), alive: p.alive, health: p.health, score: p.score }));
                            return { candidate, scope: uploadScope, initial, final, checkpoints, fixtureSchedule, particleDiagnostics,
                                cpuTiming: 'production-update-plus-reference-upload-marking',
                                particleCallSemantics: 'particleCalls includes all measured routine calls; simulationParticleUpdateCalls counts positive-dt calls inside the fixed test update loop',
                                particleDiagnosticSource: 'PlayerView exhaust and afterburn emit during render; active counts vary with rendered frames and are diagnostic only',
                                simulationParticleUpdateCalls, matchSeed: game.entityManager.matchSeed, ticks, moved,
                                states: [...gameStates], frame: summary(intervals), update: summary(updateTimes), render: summary(renderTimes),
                                cpu, uploadBytes, uploadCalls, gpu: renderer.qualityController.gpuFrameTimer.getStats(),
                                quality: renderer.qualityController.getQualityState(), dimensions: [r.domElement.width, r.domElement.height],
                                visibility: document.visibilityState, glError: gl.getError() };
                        } finally {
                            particles.update = particleUpdate;
                            if (leaves) leaves.update = leafUpdate;
                            gl.bufferSubData = subData;
                        }
                    } finally { Math.random = nativeRandom; }
                }, { candidate, measureSeconds, warmupSeconds, uploadScope, mapKey });
                trials.push(row);
                await writeFile(testInfo.outputPath('match-ab.json'), JSON.stringify({ mapKey, measureSeconds, warmupSeconds, trials }, null, 2));
                console.log(`[match-ab] ${mapKey} scope=${uploadScope} ${trials.length}/${trialLimit} candidate=${candidate} frame=${row.frame.meanMs.toFixed(3)} p95=${row.frame.p95Ms.toFixed(3)} cpu=${JSON.stringify(row.cpu)} uploads=${JSON.stringify({ bytes: row.uploadBytes, calls: row.uploadCalls })}`);
                expect(row.glError).toBe(0);
                expect(row.quality.effectiveQuality).toBe('HIGH');
                expect(row.dimensions).toEqual([1920, 1080]);
                expect(row.visibility).toBe('visible');
                expect(row.matchSeed).toBe(45021);
                expect(row.moved).toBeGreaterThan(0);
                expect(Number.isInteger(row.simulationParticleUpdateCalls)).toBe(true);
                expect(row.simulationParticleUpdateCalls).toBeGreaterThanOrEqual(0);
                expect(row.simulationParticleUpdateCalls).toBeLessThanOrEqual(row.ticks);
                if (mapKey === 'cherry_grove') {
                    expect(row.fixtureSchedule[0].tick).toBe(0);
                    expect(row.fixtureSchedule[0].indices).toHaveLength(12);
                    expect(row.fixtureSchedule[0].visibleBatchCount).toBeGreaterThan(0);
                    expect(row.uploadBytes.leaves).toBeGreaterThan(0);
                }
            }
            await testInfo.attach('match-ab', { path: testInfo.outputPath('match-ab.json'), contentType: 'application/json' });
            // Both endpoints must match before these timings can be compared.
            for (const row of trials) {
                expect(row.initial).toEqual(trials[0].initial);
                expect(row.final).toEqual(trials[0].final);
                expect(row.checkpoints).toEqual(trials[0].checkpoints);
                expect(row.simulationParticleUpdateCalls).toBe(trials[0].simulationParticleUpdateCalls);
                expect(row.fixtureSchedule).toEqual(trials[0].fixtureSchedule);
            }
        } finally {
            await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                game.gameLoop.stop();
                Object.getPrototypeOf(game.entityManager._setupOps).resolveMatchSeed = window.__perfRestoreSeed;
                delete window.__perfRestoreSeed;
            });
        }
    });
}
