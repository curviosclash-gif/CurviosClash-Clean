import { expect, test } from './helpers.desktop.js';
import {
    collectErrors,
    returnToMenu,
    startGameFromMenu,
} from './helpers.js';

test.describe('Desktop render smoothing', () => {
    test('preloads vehicles and renders a non-colliding interpolated trail head', async ({ page }) => {
        const errors = collectErrors(page);
        await startGameFromMenu(page);

        await page.waitForFunction(() => {
            const player = window.GAME_INSTANCE?.entityManager?.players?.[0];
            return player?.view?.isReady?.() === true
                && player?.group?.visible === true
                && player?.trail?.headMesh?.visible === true;
        }, null, { timeout: 10_000 });

        const renderState = await page.evaluate(() => new Promise((resolve) => {
            const captureVisibleHead = () => {
                const game = window.GAME_INSTANCE;
                const player = game?.entityManager?.players?.[0];
                const renderer = game?.renderer;
                const trailHead = player?.trail?.headMesh || null;
                if (trailHead?.visible !== true) {
                    requestAnimationFrame(captureVisibleHead);
                    return;
                }
                const trailTip = trailHead.position.clone().set(0, 0.5, 0);
                trailHead.localToWorld(trailTip);
                const mainShadowLight = renderer?.scene?.children?.find((child) => child?.isDirectionalLight && child.castShadow);
                resolve({
                    antialias: renderer?.renderer?.getContext?.().getContextAttributes?.().antialias === true,
                    environmentReady: renderer?.scene?.environment?.isTexture === true,
                    shadowType: Number(renderer?.renderer?.shadowMap?.type),
                    shadowMapWidth: Number(mainShadowLight?.shadow?.mapSize?.width),
                    vehicleReady: player?.view?.isReady?.() === true,
                    vehicleVisible: player?.group?.visible === true,
                    visualTime: Number(player?.view?._visualTime),
                    visualHeadVisible: true,
                    visualHeadCollisionEnabled: trailHead.userData?.collisionEnabled,
                    visualHeadRadiusTop: Number(trailHead.geometry?.parameters?.radiusTop),
                    visualTipForwardOffset: trailTip.clone().sub(player.view._renderPosition).dot(player.view._renderDirection),
                });
            };
            captureVisibleHead();
        }));

        expect(renderState.antialias).toBeTruthy();
        expect(renderState.environmentReady).toBeTruthy();
        expect(renderState.shadowType).toBe(2);
        expect(renderState.shadowMapWidth).toBe(1024);
        expect(renderState.vehicleReady).toBeTruthy();
        expect(renderState.vehicleVisible).toBeTruthy();
        expect(renderState.visualTime).toBeGreaterThan(0);
        expect(renderState.visualHeadVisible).toBeTruthy();
        expect(renderState.visualHeadCollisionEnabled).toBe(false);
        expect(renderState.visualHeadRadiusTop).toBe(1);
        expect(renderState.visualTipForwardOffset).toBeLessThan(-0.4);
        expect(errors).toHaveLength(0);

        await returnToMenu(page);
    });
});
