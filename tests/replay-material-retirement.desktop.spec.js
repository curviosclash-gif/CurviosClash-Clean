import { expect, test } from './helpers.desktop.js';
import { chooseFreePlayVariant, openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('desktop replays reuse GPU programs across generations and release owned materials', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await chooseFreePlayVariant(page, 'ffa');
    await page.click('#submenu-game:not(.hidden) #btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const report = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.renderer;
        const renderer = runtime.renderer;
        const context = renderer.getContext();
        const scene = new runtime.scene.constructor();
        const camera = runtime.cameras[0].clone();
        camera.position.set(0, 4, 18);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const replay = new game.entityManager._lastRoundGhostSystem.constructor({
            addToScene: (object) => scene.add(object),
            removeFromScene: (object) => scene.remove(object),
        }, { presentationKind: 'killcam-replay' });
        const pose = (time) => ({ time, players: [{
            idx: 0, alive: true, x: time, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1,
        }] });
        const clip = {
            routeId: 'retirement-gpu', sourceDuration: 1, displayDuration: 1,
            players: [{ idx: 0, color: 0x2299ff }], frames: [pose(0), pose(1)],
        };
        const snapshot = { copy: (value) => [value.x, value.y, value.z, value.w] };
        const heldViewport = renderer.getViewport(snapshot);
        const heldScissor = renderer.getScissor(snapshot);
        const heldScissorTest = renderer.getScissorTest();
        const generations = [];
        let firstProgram = null;
        let firstPixels = null;
        let differingPixels = 0;
        try {
            renderer.setScissorTest(false);
            const pixelRatio = renderer.getPixelRatio();
            renderer.setViewport(0, 0, renderer.domElement.width / pixelRatio, renderer.domElement.height / pixelRatio);
            for (let index = 0; index < 8; index += 1) {
                if (!replay.playClip(clip, { loop: false })) throw new Error('replay rejected');
                replay.seekSourceTime(0.5);
                const materials = new Set();
                replay.root.traverse((object) => {
                    for (const material of [].concat(object.material || [])) materials.add(material);
                });
                for (const entry of replay._entries) {
                    for (const material of [entry.trail?.material, entry.trail?.glowMaterial,
                        entry.trail?.headMaterial, entry.trail?.glowHeadMaterial]) {
                        if (material) materials.add(material);
                    }
                }
                const disposed = new Set();
                for (const material of materials) material.addEventListener('dispose', () => disposed.add(material));
                renderer.render(scene, camera);
                context.finish();
                const program = renderer.properties.get(replay._entries[0].materials[0]).currentProgram;
                const pixels = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
                context.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height,
                    context.RGBA, context.UNSIGNED_BYTE, pixels);
                if (!firstProgram) { firstProgram = program; firstPixels = pixels; }
                else for (let offset = 0; offset < pixels.length; offset += 1) {
                    if (pixels[offset] !== firstPixels[offset]) differingPixels += 1;
                }
                const previous = generations.at(-1);
                const previousAliveDuringRender = !previous || previous.disposed.size === 0;
                replay.clear();
                replay.clear();
                generations.push({ materials, disposed, sameProgram: program === firstProgram,
                    previousAliveDuringRender, previousReleased: !previous || previous.disposed.size === previous.materials.size,
                    programRetained: renderer.info.programs.includes(program),
                    retainedCount: replay._retiredMaterials.length });
            }
            replay.dispose();
            return {
                runtimeKind: window.curviosApp.capabilities.runtimeKind,
                generations: generations.map((generation) => ({
                    materialCount: generation.materials.size, disposedCount: generation.disposed.size,
                    sameProgram: generation.sameProgram, previousAliveDuringRender: generation.previousAliveDuringRender,
                    previousReleased: generation.previousReleased, programRetained: generation.programRetained,
                    retainedCount: generation.retainedCount,
                })),
                differingPixels, programCreated: !!firstProgram,
                visiblePixels: firstPixels.some((value, index) => index % 4 !== 3 && value !== firstPixels[index % 4]),
                retainedAfterDispose: replay._retiredMaterials.length,
                detached: replay.root.parent === null, glError: context.getError(),
            };
        } finally {
            replay.dispose();
            renderer.setViewport(...heldViewport);
            renderer.setScissor(...heldScissor);
            renderer.setScissorTest(heldScissorTest);
        }
    });
    expect(report.runtimeKind).toBe('electron');
    expect(report.programCreated).toBe(true);
    expect(report.visiblePixels).toBe(true);
    expect(report.differingPixels).toBe(0);
    for (const generation of report.generations) {
        expect(generation.materialCount).toBeGreaterThan(0);
        expect(generation.disposedCount).toBe(generation.materialCount);
        expect(generation.sameProgram).toBe(true);
        expect(generation.previousAliveDuringRender).toBe(true);
        expect(generation.previousReleased).toBe(true);
        expect(generation.programRetained).toBe(true);
        expect(generation.retainedCount).toBeLessThanOrEqual(generation.materialCount);
    }
    expect(report.retainedAfterDispose).toBe(0);
    expect(report.detached).toBe(true);
    expect(report.glError).toBe(0);
    await testInfo.attach('replay-retirement-gpu.json', {
        body: JSON.stringify(report, null, 2), contentType: 'application/json',
    });
});
