import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame } from './helpers.js';

async function openFourPlayerSetup(page) {
    await page.evaluate(() => window.GAME_INSTANCE?._showMainNav?.());
    await page.locator('[data-session-type="splitscreen"]').click();
    await expect(page.locator('#submenu-custom')).toBeVisible();
    if (!await page.locator('#four-player-planar-setup').isVisible()) {
        await expect(page.locator('#btn-four-player-planar')).toBeVisible();
        await page.locator('#btn-four-player-planar').click();
    }
    await expect(page.locator('#four-player-planar-setup')).toBeVisible();
}

async function startVariant(page, mode, botCount) {
    await openFourPlayerSetup(page);
    await page.locator('[data-four-player-planar-mode]').selectOption(mode);
    await page.locator('[data-four-player-planar-bots]').evaluate((element, value) => {
        element.value = String(value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, botCount);
    await page.locator('[data-four-player-planar-start]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.players?.length >= 4);
}

test('four-player planar starts Classic and Hunt with four keyboard humans, optional bots, HUD and clean return', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForLoadedGame(page);

    for (const scenario of [
        { mode: 'classic', bots: 0, modeType: 'CLASSIC' },
        { mode: 'hunt', bots: 2, modeType: 'HUNT' },
    ]) {
        await startVariant(page, scenario.mode, scenario.bots);
        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                humanCount: game?.entityManager?.humanPlayers?.length,
                botCount: game?.entityManager?.bots?.length,
                modeType: game?.entityManager?.gameModeStrategy?.modeType,
                layout: game?.renderer?.viewportLayout,
                cameraModes: game?.renderer?.cameraModes?.slice(0, 4),
                sourceTypes: Array.from({ length: 4 }, (_, index) => game?.input?.getPlayerSource?.(index)?.type),
                hudQuadrants: document.querySelectorAll('#four-player-planar-hud .four-player-planar-hud-quadrant').length,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                hudCards: Array.from(document.querySelectorAll('#four-player-planar-hud .four-player-planar-hud-card')).map((card) => {
                    const rect = card.getBoundingClientRect();
                    return {
                        player: card.querySelector('[data-fpp-player]')?.textContent,
                        stat: card.querySelector('[data-fpp-stat]')?.textContent,
                        item: card.querySelector('[data-fpp-item]')?.textContent,
                        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    };
                }),
                actionHints: document.querySelectorAll('#four-player-planar-hud [data-fpp-action]').length,
                legacyHudVisible: Array.from(document.querySelectorAll('#hud > :not(#four-player-planar-hud)'))
                    .filter((element) => getComputedStyle(element).display !== 'none')
                    .map((element) => element.id || element.className),
                crosshairHidden: getComputedStyle(document.getElementById('crosshair-container')).display === 'none',
                fighterHudHidden: getComputedStyle(document.getElementById('p1-fighter-hud')).display === 'none',
            };
        });
        expect(state.humanCount).toBe(4);
        expect(state.botCount).toBe(scenario.bots);
        expect(state.modeType).toBe(scenario.modeType);
        expect(state.layout).toBe('four_grid');
        expect(state.cameraModes).toEqual([0, 0, 0, 0]);
        expect(state.sourceTypes).toEqual(Array(4).fill('four-player-planar-keyboard'));
        expect(state.hudQuadrants).toBe(4);
        state.hudCards.forEach((card, index) => {
            expect({ player: card.player, stat: card.stat, item: card.item }).toEqual({
                player: `P${index + 1}`,
                stat: scenario.mode === 'hunt' ? 'HP 100' : 'Punkte 0',
                item: 'Kein Item',
            });
            expect(card.rect.width).toBeLessThan(state.viewport.width / 3);
            expect(card.rect.height).toBeLessThan(state.viewport.height / 4);
            expect(card.rect.left >= state.viewport.width / 2).toBe(index % 2 === 1);
            expect(card.rect.top >= state.viewport.height / 2).toBe(index >= 2);
        });
        expect(state.actionHints).toBe(0);
        expect(state.legacyHudVisible).toEqual([]);
        expect(state.crosshairHidden).toBeTruthy();
        expect(state.fighterHudHidden).toBeTruthy();

        await page.keyboard.down('KeyA');
        await page.waitForFunction(() => window.GAME_INSTANCE?.input?.getPlayerSource?.(0)?.poll?.()?.yawLeft === true);
        await page.keyboard.up('KeyA');

        await returnToMenu(page);
        await page.waitForFunction(() => window.GAME_INSTANCE?.renderer?.viewportLayout === 'single');
        const cleanup = await page.evaluate(() => ({
            sourceCount: window.GAME_INSTANCE?.input?._playerSources?.size || 0,
            hudHidden: document.getElementById('four-player-planar-hud')?.classList.contains('hidden'),
            activeClass: document.documentElement.classList.contains('four-player-planar-active'),
        }));
        expect(cleanup.sourceCount).toBe(0);
        expect(cleanup.hudHidden).toBeTruthy();
        expect(cleanup.activeClass).toBeFalsy();
    }

    expect(errors).toHaveLength(0);
});
