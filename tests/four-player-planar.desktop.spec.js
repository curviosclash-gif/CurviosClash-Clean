import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame } from './helpers.js';

async function openFourPlayerSetup(page) {
    await page.evaluate(() => (
        window.GAME_INSTANCE?.runtimeCoordinator?.getUiManager?.()?.showMainNav?.()
    ));
    await page.locator('[data-session-type="splitscreen"]').click();
    await expect(page.locator('#submenu-custom')).toBeVisible();
    if (!await page.locator('#four-player-planar-setup').isVisible()) {
        await expect(page.locator('#btn-four-player-planar')).toBeVisible();
        await page.locator('#btn-four-player-planar').click();
    }
    await expect(page.locator('#four-player-planar-setup')).toBeVisible();
}

async function startVariant(page, mode, botCount, { configureRoll = false } = {}) {
    await openFourPlayerSetup(page);
    await page.locator('.four-player-planar-controls summary').click();
    await expect(page.locator('[data-four-player-roll-key]')).toHaveCount(8);
    if (configureRoll) {
        const rollLeftP1 = page.locator('[data-four-player-roll-key="left"][data-player-index="0"]');
        await rollLeftP1.click();
        await page.keyboard.press('KeyZ');
        await expect(rollLeftP1).toHaveText('Rolle links: Z');
    }
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
        await startVariant(page, scenario.mode, scenario.bots, { configureRoll: scenario.mode === 'classic' });
        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                humanCount: game?.entityManager?.humanPlayers?.length,
                botCount: game?.entityManager?.bots?.length,
                modeType: game?.entityManager?.gameModeStrategy?.modeType,
                layout: game?.renderer?.viewportLayout,
                cameraModes: game?.renderer?.cameraModes?.slice(0, 4),
                sourceTypes: Array.from({ length: 4 }, (_, index) => game?.input?.getPlayerSource?.(index)?.type),
                rollBindings: game?.runtimeConfig?.session?.fourPlayerPlanar?.rollBindings,
                hudQuadrants: document.querySelectorAll('#four-player-planar-hud .four-player-planar-hud-quadrant').length,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                hudCards: Array.from(document.querySelectorAll('#four-player-planar-hud .four-player-planar-hud-card')).map((card) => {
                    const rect = card.getBoundingClientRect();
                    return {
                        player: card.querySelector('[data-fpp-player]')?.textContent,
                        stat: card.querySelector('[data-fpp-stat]')?.textContent,
                        rank: card.querySelector('[data-fpp-rank]')?.textContent,
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
        expect(state.rollBindings[0].left).toBe('KeyZ');
        expect(state.hudQuadrants).toBe(4);
        state.hudCards.forEach((card, index) => {
            expect({ player: card.player, stat: card.stat, rank: card.rank, item: card.item }).toEqual({
                player: `P${index + 1}`,
                stat: scenario.mode === 'hunt' ? 'Abschüsse 0 · HP 100' : 'Punkte 0',
                rank: `Rang 1/${scenario.bots + 4}`,
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

        for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 900, height: 720 }]) {
            await page.setViewportSize(viewport);
            for (const scale of [0.6, 1.4]) {
                const cards = await page.evaluate((hudScale) => {
                    document.documentElement.style.setProperty('--hud-scale', String(hudScale));
                    return Array.from(document.querySelectorAll('.four-player-planar-hud-quadrant')).map((quadrant) => {
                        const pane = quadrant.getBoundingClientRect();
                        const card = quadrant.querySelector('.four-player-planar-hud-card').getBoundingClientRect();
                        return { pane: { left: pane.left, right: pane.right, top: pane.top, bottom: pane.bottom },
                            card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom } };
                    });
                }, scale);
                expect(cards).toHaveLength(4);
                cards.forEach(({ pane, card }, index) => {
                    expect(card.left, `P${index + 1} left at ${viewport.width} scale ${scale}`).toBeGreaterThanOrEqual(pane.left - 1);
                    expect(card.right, `P${index + 1} right at ${viewport.width} scale ${scale}`).toBeLessThanOrEqual(pane.right + 1);
                    expect(card.top).toBeGreaterThanOrEqual(pane.top - 1);
                    expect(card.bottom).toBeLessThanOrEqual(pane.bottom + 1);
                });
            }
        }
        await page.evaluate(() => document.documentElement.style.removeProperty('--hud-scale'));

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PAUSED');
        await expect(page.locator('#pause-overlay')).toBeVisible();
        await expect(page.locator('#btn-pause-menu')).toBeVisible();
        await page.locator('#btn-pause-menu').click();
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'MENU');
        await expect(page.locator('#submenu-custom')).toBeVisible();
        await expect(page.locator('#four-player-planar-setup')).toBeVisible();

        await startVariant(page, scenario.mode, scenario.bots);

        await page.keyboard.down('KeyA');
        await page.waitForFunction(() => window.GAME_INSTANCE?.input?.getPlayerSource?.(0)?.poll?.()?.yawLeft === true);
        await page.keyboard.up('KeyA');
        await page.keyboard.down('KeyZ');
        await page.waitForFunction(() => window.GAME_INSTANCE?.input?.getPlayerSource?.(0)?.poll?.()?.rollLeft === true);
        await page.keyboard.up('KeyZ');

        await returnToMenu(page);
        await expect(page.locator('#submenu-custom')).toBeVisible();
        await expect(page.locator('#four-player-planar-setup')).toBeVisible();
        await page.waitForFunction(() => window.GAME_INSTANCE?.renderer?.viewportLayout === 'single');
        const cleanup = await page.evaluate(() => ({
            sourceCount: Array.from(
                { length: 4 },
                (_, index) => window.GAME_INSTANCE?.input?.getPlayerSource?.(index)
            ).filter(Boolean).length,
            hudHidden: document.getElementById('four-player-planar-hud')?.classList.contains('hidden'),
            activeClass: document.documentElement.classList.contains('four-player-planar-active'),
        }));
        expect(cleanup.sourceCount).toBe(0);
        expect(cleanup.hudHidden).toBeTruthy();
        expect(cleanup.activeClass).toBeFalsy();
    }

    expect(errors).toHaveLength(0);
});
