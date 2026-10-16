import { test, expect } from './helpers.desktop.js';
import { startGame, waitForRenderFrames } from './helpers.js';

test('trail frustum culling preserves rendered pixels and skips fully offscreen trails', async ({ page }) => {
    await startGame(page);
    await waitForRenderFrames(page, 4);

    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const renderFacade = game?.renderer;
        const renderer = renderFacade?.renderer;
        const scene = renderFacade?.scene;
        const camera = renderFacade?.cameras?.[0];
        const owner = game?.entityManager?.players?.[0];
        if (!renderer || !scene || !camera || !owner?.trail) {
            throw new Error('Trail render harness was not ready');
        }

        camera.updateMatrixWorld(true);
        const direction = camera.getWorldDirection(camera.position.clone());
        const right = direction.clone().cross(camera.up).normalize();
        const visibleCenter = camera.position.clone().addScaledVector(direction, 80);
        const offscreenCenter = visibleCenter.clone().addScaledVector(right, 180);
        const TrailType = owner.trail.constructor;
        const visibleTrail = new TrailType(renderFacade, 0x33aaff, 90, game.entityManager);
        const offscreenTrail = new TrailType(renderFacade, 0xffa033, 91, game.entityManager);

        const addVisualSegment = (trail, center) => {
            const start = center.clone().addScaledVector(right, -4);
            const end = center.clone().addScaledVector(right, 4);
            trail._addSegment(start.x, start.y, start.z, end.x, end.y, end.z, end.x, end.y, end.z, { visualOnly: true });
            trail._flushDirtyMatrices();
        };
        addVisualSegment(visibleTrail, visibleCenter);
        addVisualSegment(offscreenTrail, offscreenCenter);

        const testTrails = [visibleTrail, offscreenTrail];
        for (const trail of testTrails) {
            trail.mesh.frustumCulled = false;
            if (trail.glowMesh) trail.glowMesh.frustumCulled = false;
        }

        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.info.autoReset = false;
        renderer.info.reset();
        renderer.render(scene, camera);
        const baselineCalls = renderer.info.render.calls;
        const gl = renderer.getContext();
        const baselinePixels = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
        gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, baselinePixels);

        for (const trail of testTrails) {
            trail.mesh.frustumCulled = true;
            if (trail.glowMesh) trail.glowMesh.frustumCulled = true;
        }
        renderer.info.reset();
        renderer.render(scene, camera);
        const culledCalls = renderer.info.render.calls;
        const culledPixels = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
        gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, culledPixels);

        let differingChannels = 0;
        for (let index = 0; index < baselinePixels.length; index += 1) {
            if (baselinePixels[index] !== culledPixels[index]) differingChannels += 1;
        }

        visibleTrail.dispose();
        offscreenTrail.dispose();
        return {
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            baselineCalls,
            culledCalls,
            differingChannels,
        };
    });

    console.log(`[trail-culling] ${JSON.stringify(result)}`);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.differingChannels).toBe(0);
    expect(result.culledCalls).toBeLessThan(result.baselineCalls);
});
