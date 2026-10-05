import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { openCustomSubmenu, openStartSetupSection, startGameFromMenu, waitForLoadedGame } from './helpers.js';

test('developer windows initialize repeatedly without renderer exceptions', async ({ page }, testInfo) => {
    const errors = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        for (const [url, ready] of [
            [EDITOR_VIEW_PATHS.MAP_EDITOR, () => Boolean(window.CURVIOS_EDITOR?.mapManager)],
            [EDITOR_VIEW_PATHS.VEHICLE_LAB, () => document.querySelectorAll('#partsList .part-item').length === 8],
        ]) {
            const popupPromise = page.waitForEvent('popup');
            await page.evaluate(path => window.open(path, '_blank'), url);
            const popup = await popupPromise;
            popup.on('pageerror', error => errors.push(error.stack || error.message));
            popup.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            try {
                await popup.waitForFunction(ready, null, { timeout: 30000 });
                await expect(popup.locator('canvas').first()).toBeVisible();
                expect(errors).toEqual([]);
            } catch (error) {
                await popup.screenshot({ path: testInfo.outputPath('developer-start-failure.png') });
                const details = await popup.evaluate(() => ({ url: location.href, editorError: window.CURVIOS_EDITOR_INIT_ERROR,
                    editorKeys: Object.keys(window.CURVIOS_EDITOR || {}), text: document.body.innerText.slice(0, 1000) }));
                throw new Error(`${error.message}\n${JSON.stringify({ errors, details })}`);
            } finally {
                await popup.close();
            }
        }
    }
});

test('pause hides high-layer HUD widgets and resume restores their visibility', async ({ page }) => {
    await waitForLoadedGame(page);
    await startGameFromMenu(page);
    const before = await page.evaluate(() => {
        const hud = document.querySelector('#hud');
        // Fixtures isolate the layering issue; the pause action is the real game action.
        for (const id of ['arcade-score-hud', 'arcade-mission-hud', 'parcours-minimap', 'hud-notice-stack']) {
            let element = document.getElementById(id);
            if (!element) { element = document.createElement('div'); element.id = id; hud.append(element); }
            element.classList.remove('hidden');
        }
        return [...document.querySelectorAll('#arcade-score-hud, #arcade-mission-hud, #parcours-minimap, #hud-notice-stack')]
            .map(element => ({ id: element.id, visibility: getComputedStyle(element).visibility }));
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    for (const entry of before) await expect(page.locator(`#${entry.id}`)).toHaveCSS('visibility', 'hidden');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeHidden();
    for (const entry of before) await expect(page.locator(`#${entry.id}`)).toHaveCSS('visibility', entry.visibility);
});

test('the real HUD renders course names and the localized survival objective', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await startGameFromMenu(page);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.gameLoop.stop();
        // Assisted projection isolates presentation from randomly selected sector objectives.
        game.hudRuntimeSystem._updateArcadeHud({ arcade: {
            enabled: true, phase: 'playing', nowMs: Date.now(), sectorIndex: 99,
            currentMapKey: 'parcours_assault', score: { total: 0, breakdown: {} },
            missionState: { missions: [] }, objectiveState: {
                objectiveId: 'survive_window', label: 'Survive Window', progressText: '0/55 s', progressFraction: 0,
            },
        } });
    });
    await expect(page.locator('#arcade-mission-hud')).toContainText('Hauptziel: Überleben');
    await expect(page.locator('#arcade-sector-transition-overlay')).not.toContainText('parcours_assault');
    await expect(page.locator('#arcade-score-hud .arcade-score-hud-transition')).not.toContainText('parcours_assault');
    await expect(page.locator('#arcade-sector-transition-overlay')).toBeVisible();
    await expect(page.locator('#arcade-score-hud .arcade-score-hud-transition')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('localized-course-and-objective.png') });
});

test('Hangar header buttons stay inside the window at normal and narrow widths', async ({ page, electronApp }, testInfo) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
    const opening = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangar = await opening;
    try {
        await expect(hangar.locator('#hangar-window-close')).toBeVisible();
        await expect(hangar.locator('#hangar-window-open-lab')).toBeVisible();
        for (const width of [1280, 640]) {
            await electronApp.evaluate(({ BrowserWindow }, width) => {
                const window = BrowserWindow.getAllWindows().find(entry => new URL(entry.webContents.getURL()).pathname === '/hangar.html');
                window.setMinimumSize(0, 0);
                window.setSize(width, 700);
            }, width);
            await expect.poll(() => hangar.evaluate(() => [...document.querySelectorAll('.hangar-window-titlebar button')].every(button => {
                const rect = button.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
                    && (hit === button || button.contains(hit));
            }))).toBe(true);
            await hangar.screenshot({ path: testInfo.outputPath(`hangar-header-${width}.png`) });
        }
    } finally {
        await hangar.close();
    }
});
