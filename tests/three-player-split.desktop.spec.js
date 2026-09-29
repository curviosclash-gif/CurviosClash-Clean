import { expect, test } from './helpers.desktop.js';
import { collectErrors, openStartSetupSection, returnToMenu, waitForLoadedGame } from './helpers.js';

// Two and three players share the level-3 match menu; the player count sits in "Spieler & Geräte".
async function openSharedSplitMenu(page, modePath = 'normal') {
    await waitForLoadedGame(page);
    await page.evaluate(() => window.GAME_INSTANCE?.runtimeCoordinator?.getUiManager?.()?.showMainNav?.());
    await page.locator('[data-session-type="splitscreen"]').click();
    await page.locator(`#submenu-custom [data-mode-path="${modePath}"]`).click();
    await expect(page.locator('#submenu-game')).toBeVisible();
    // The wide desktop layout shows one section at a time; the rail tab is the user's way in.
    const railTab = page.locator('#btn-start-step-players');
    if (await railTab.isVisible()) {
        await railTab.click();
        await expect(page.locator('#start-players-section')).toBeVisible();
    } else {
        await openStartSetupSection(page, 'players');
    }
}

async function chooseThreePlayers(page) {
    await page.locator('[data-split-player-count="3"]').click();
    await expect(page.locator('[data-split-player-count="3"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#split-device-p1')).toBeVisible();
}

async function startAndWaitForThreeHumans(page) {
    await page.locator('#submenu-game #btn-start').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 3);
}

test('the shared split menu switches between two and three players without losing either setup', async ({ page }) => {
    const errors = collectErrors(page);
    await openSharedSplitMenu(page);

    await expect(page.locator('[data-split-player-count="2"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#split-input-layout')).toBeVisible();
    await expect(page.locator('#split-device-p1')).toBeHidden();
    await expect(page.locator('#btn-vehicle-player-p3')).toHaveClass(/hidden/);

    await chooseThreePlayers(page);
    await expect(page.locator('#split-input-layout')).toBeHidden();
    await expect(page.locator('#btn-vehicle-player-p3')).not.toHaveClass(/hidden/);
    await expect(page.locator('#menu-selection-summary')).toContainText('Flugzeug P3');

    await page.locator('[data-split-player-count="2"]').click();
    await expect(page.locator('#split-input-layout')).toBeVisible();
    await expect(page.locator('#btn-vehicle-player-p3')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => window.GAME_INSTANCE?.settings?.localSettings?.threePlayerSplit?.deviceAssignment))
        .toEqual(['gamepad-1', 'gamepad-2', 'keyboard']);
    expect(errors).toHaveLength(0);
});

test('three-player split guards missing pads and starts with swapped device seats', async ({ page }) => {
    const errors = collectErrors(page);
    await openSharedSplitMenu(page);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
    });
    await chooseThreePlayers(page);
    await page.evaluate(() => window.dispatchEvent(new Event('gamepaddisconnected')));

    await expect(page.locator('#split-device-status')).toContainText('Gamepad 1 fehlt');
    await page.locator('#submenu-game #btn-start').click();
    await expect(page.locator('#start-validation-status')).toContainText('Gamepad 1 fehlt');
    expect(await page.evaluate(() => window.GAME_INSTANCE?.state)).toBe('MENU');

    await page.locator('#split-viewport-layout').selectOption('three_rows');
    await page.locator('#split-device-p3').selectOption('gamepad-1');
    await expect(page.locator('#split-device-p1')).toHaveValue('keyboard');
    await expect(page.locator('#split-device-p3')).toHaveValue('gamepad-1');

    await page.evaluate(() => {
        const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, pad] });
        window.dispatchEvent(new Event('gamepadconnected'));
    });
    await expect(page.locator('#split-device-status')).toBeHidden();
    await startAndWaitForThreeHumans(page);

    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            layout: game.renderer?.viewportLayout,
            sources: [0, 1, 2].map((index) => game.input?.getPlayerSource?.(index)?.type),
            hudColumns: document.querySelectorAll('#three-player-split-hud .three-player-split-hud-column').length,
            hudLayout: document.querySelector('#three-player-split-hud')?.dataset.viewportLayout,
        };
    });
    expect(state).toEqual({
        layout: 'three_rows',
        sources: ['keyboard', 'gamepad', 'gamepad'],
        hudColumns: 3,
        hudLayout: 'three_rows',
    });
    expect(errors).toHaveLength(0);
    await returnToMenu(page);
    // Back in the shared menu the next start is still a three-player match with the same seats.
    expect(await page.evaluate(() => window.GAME_INSTANCE?.settings?.localSettings?.splitScreenVariant)).toBe('three_player');
    await expect(page.locator('[data-split-player-count="3"]')).toHaveAttribute('aria-pressed', 'true');
});

test('three-player split starts with all three players on separate keyboard bindings', async ({ page }) => {
    const errors = collectErrors(page);
    await openSharedSplitMenu(page);
    await chooseThreePlayers(page);

    const deviceSelects = page.locator('[data-split-device]');
    await expect(deviceSelects).toHaveCount(3);
    await expect(deviceSelects.first().locator('option[value="gamepad-3"]')).toHaveCount(1);
    for (let playerIndex = 0; playerIndex < 3; playerIndex += 1) {
        await deviceSelects.nth(playerIndex).selectOption('keyboard');
    }
    await page.locator('#split-viewport-layout').selectOption('three_columns');

    await expect(page.locator('#split-device-status')).toBeHidden();
    await startAndWaitForThreeHumans(page);

    const sources = await page.evaluate(() => [0, 1, 2].map((index) => ({
        type: window.GAME_INSTANCE?.input?.getPlayerSource?.(index)?.type,
        keyboardIndex: window.GAME_INSTANCE?.input?.getPlayerSource?.(index)?.keyboardPlayerIndex,
    })));
    expect(sources).toEqual([
        { type: 'keyboard', keyboardIndex: 0 },
        { type: 'keyboard', keyboardIndex: 1 },
        { type: 'keyboard', keyboardIndex: 2 },
    ]);
    const compactHud = page.locator('#three-player-split-hud');
    await expect(compactHud).toBeVisible();
    await expect(compactHud).toHaveAttribute('data-mode', 'classic');
    await expect(compactHud.locator('.three-player-split-hud-card')).toHaveCount(3);
    await expect(compactHud.locator('[data-tps-classic-meter="boost"]:not(.hidden)')).toHaveCount(3);
    await expect(compactHud.locator('[data-tps-classic-meter="slowmo"]:not(.hidden)')).toHaveCount(3);
    await expect(compactHud.locator('.three-player-split-classic-reserve .hunt-segmented-arc')).toHaveCount(6);
    await expect(compactHud.locator('[data-tps-items]')).toHaveCount(3);
    await expect(compactHud.locator('[data-tps-rockets]')).toHaveCount(3);
    const hudVisuals = await compactHud.locator('.three-player-split-hud-column').evaluateAll((columns) => columns.map((column) => {
        const header = column.querySelector('.three-player-split-hud-card-header');
        const reserve = column.querySelector('.three-player-split-classic-reserve');
        return {
            headerClip: getComputedStyle(header).clipPath,
            headerWidth: header.getBoundingClientRect().width,
            paneWidth: column.getBoundingClientRect().width,
            reserveTransform: getComputedStyle(reserve).transform,
        };
    }));
    expect(hudVisuals).toHaveLength(3);
    for (const visual of hudVisuals) {
        expect(visual.headerClip).toContain('polygon');
        expect(visual.headerWidth).toBeLessThan(visual.paneWidth);
        expect(visual.reserveTransform).not.toBe('none');
    }
    for (let playerIndex = 1; playerIndex <= 3; playerIndex += 1) {
        await expect(page.locator(`#crosshair-p${playerIndex}`)).toBeVisible();
    }
    const reticleProbe = await page.locator('#crosshair-container .crosshair').evaluateAll((elements) => ({
        width: window.innerWidth,
        centers: elements.filter((element) => getComputedStyle(element).display !== 'none').map((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left + rect.width / 2;
        }),
    }));
    expect(reticleProbe.centers).toHaveLength(3);
    for (const [index, centerX] of reticleProbe.centers.entries()) {
        expect(centerX).toBeGreaterThanOrEqual((index * reticleProbe.width) / 3 - 24);
        expect(centerX).toBeLessThanOrEqual(((index + 1) * reticleProbe.width) / 3 + 24);
    }
    expect(errors).toHaveLength(0);
    await returnToMenu(page);
    await expect(page.locator('#crosshair-p3')).toBeHidden();
});

test('three-player Hunt exposes compact combat vitals and match status for all players', async ({ page }) => {
    const errors = collectErrors(page);
    await openSharedSplitMenu(page, 'fight');
    await chooseThreePlayers(page);
    const deviceSelects = page.locator('[data-split-device]');
    for (let playerIndex = 0; playerIndex < 3; playerIndex += 1) {
        await deviceSelects.nth(playerIndex).selectOption('keyboard');
    }

    await startAndWaitForThreeHumans(page);

    const compactHud = page.locator('#three-player-split-hud');
    await expect(compactHud).toBeVisible();
    await expect(compactHud).toHaveAttribute('data-mode', 'hunt');
    await expect(compactHud.locator('[data-tps-meter="hp"]:not(.hidden)')).toHaveCount(3);
    await expect(compactHud.locator('[data-tps-meter="shield"]:not(.hidden)')).toHaveCount(3);
    await expect(compactHud.locator('[data-tps-meter="overheat"]:not(.hidden)')).toHaveCount(3);
    await expect(compactHud.locator('.three-player-split-hunt-reserve .hunt-segmented-arc')).toHaveCount(9);
    await expect(compactHud.locator('.three-player-split-match-status')).toBeVisible();
    await expect(compactHud.locator('[data-tps-objective]')).not.toBeEmpty();
    const combatVisuals = await compactHud.locator('.three-player-split-hud-column').evaluateAll((columns) => columns.map((column) => ({
        headerDisplay: getComputedStyle(column.querySelector('.three-player-split-hud-card-header')).display,
        vitalRadius: getComputedStyle(column.querySelector('.three-player-split-vital')).borderRadius,
        targetingOpacity: Number.parseFloat(getComputedStyle(column.querySelector('.three-player-split-hunt-reserve')).opacity),
    })));
    for (const visual of combatVisuals) {
        expect(visual.headerDisplay).toBe('none');
        expect(visual.vitalRadius).toBe('50%');
        expect(visual.targetingOpacity).toBeLessThan(1);
    }
    expect(errors).toHaveLength(0);
    await returnToMenu(page);
});
