import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame } from './helpers.js';

test('three-player split setup guards missing pads and starts with swapped device seats', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await page.evaluate(() => window.GAME_INSTANCE?.runtimeCoordinator?.getUiManager?.()?.showMainNav?.());
    await page.locator('[data-session-type="splitscreen"]').click();
    await expect(page.locator('#btn-three-player-split')).toBeVisible();
    await page.locator('#btn-three-player-split').click();
    await expect(page.locator('#three-player-split-setup')).toBeVisible();

    await page.locator('[data-three-player-split-start]').click();
    await expect(page.locator('[data-three-player-split-device-status]')).toContainText('Gamepad 1 fehlt');
    expect(await page.evaluate(() => window.GAME_INSTANCE?.state)).toBe('MENU');

    await page.locator('[data-three-player-split-device][data-player-index="2"]').selectOption('gamepad-1');
    await expect(page.locator('[data-three-player-split-device][data-player-index="0"]')).toHaveValue('keyboard');
    await expect(page.locator('[data-three-player-split-device][data-player-index="2"]')).toHaveValue('gamepad-1');

    await page.evaluate(() => {
        const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, pad] });
        window.dispatchEvent(new Event('gamepadconnected'));
    });
    await expect(page.locator('[data-three-player-split-device-status]')).toBeHidden();
    await page.locator('[data-three-player-split-start]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 3);

    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            layout: game.renderer?.viewportLayout,
            sources: [0, 1, 2].map((index) => game.input?.getPlayerSource?.(index)?.type),
            hudColumns: document.querySelectorAll('#three-player-split-hud .three-player-split-hud-column').length,
        };
    });
    expect(state).toEqual({ layout: 'three_columns', sources: ['keyboard', 'gamepad', 'gamepad'], hudColumns: 3 });
    expect(errors).toHaveLength(0);
    await returnToMenu(page);
});
