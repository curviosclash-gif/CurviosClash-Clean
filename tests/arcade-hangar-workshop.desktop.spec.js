import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    expect,
    loadGame,
    loadGameWithRetry,
    openCustomSubmenu,
    returnToMenu,
    test,
} from './core-targeted.shared.js';

const HANGAR_BUILD_STORAGE_KEY = 'curviosclash.hangar.arcade-builds.v2';
const BUILD_NAME = 'Desktop E2E Build';

async function openArcadeHangar(page) {
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#arcade-vehicle-preview-stage')).toHaveAttribute('data-preview-status', 'ready');
}

async function seedUnlockedProfiles(page) {
    const vehicleIds = await page.evaluate(() => Array.from(document.querySelectorAll('#vehicle-select-p1 option'))
        .map((option) => String(option.value || '').trim())
        .filter(Boolean));
    await page.evaluate(({ profileKey, legacyLoadoutKey, buildKey, lastRunKey, ids }) => {
        const nowIso = new Date().toISOString();
        const unlockedSlots = [
            'core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility',
            'wing_left_t2', 'wing_right_t2', 'engine_left_t2', 'engine_right_t2', 'core_t2',
            'nose_t2', 'utility_t2', 'core_t3', 'nose_t3',
        ];
        const profiles = Object.fromEntries(ids.map((vehicleId) => [vehicleId, {
            schemaVersion: 'arcade-vehicle-profile.v1',
            vehicleId,
            xp: 999999,
            level: 30,
            unlockedSlots: [...unlockedSlots],
            upgrades: {},
            createdAt: nowIso,
            updatedAt: nowIso,
        }]));
        localStorage.setItem(profileKey, JSON.stringify(profiles));
        localStorage.removeItem(legacyLoadoutKey);
        localStorage.removeItem(buildKey);
        localStorage.removeItem(lastRunKey);
    }, {
        profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
        legacyLoadoutKey: ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
        buildKey: HANGAR_BUILD_STORAGE_KEY,
        lastRunKey: ARCADE_LAST_RUN_STORAGE_KEY,
        ids: vehicleIds,
    });
}

function readMetric(page, metric) {
    return page.locator(`[data-metric="${metric}"] .hangar-stat-value`).evaluate((node) => Number(node.textContent));
}

test('Desktop-Hangar: 3D-Umbau, Speicherung, Run-Übernahme und Wiederöffnung', async ({ page }) => {
    await loadGame(page);
    await seedUnlockedProfiles(page);
    await page.reload();
    await loadGameWithRetry(page);
    await openArcadeHangar(page);

    const selectedVehicleId = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-card'));
        const card = cards.find((node) => node.getAttribute('data-vehicle-id') === 'aircraft')
            || cards.find((node) => node.getAttribute('data-vehicle-id') === 'drone')
            || cards[0];
        card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return String(card?.getAttribute('data-vehicle-id') || '');
    });
    expect(selectedVehicleId).not.toBe('');
    await expect(page.locator('#vehicle-select-p1')).toHaveValue(selectedVehicleId);

    const stage = page.locator('#arcade-vehicle-preview-stage');
    const revisionBefore = Number(await stage.getAttribute('data-camera-revision') || 0);
    const canvas = page.locator('.hangar-viewport-canvas-node');
    await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.waitForTimeout(100);
    const canvasPoint = await canvas.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const candidates = [[0.18, 0.2], [0.82, 0.2], [0.18, 0.78], [0.82, 0.78], [0.5, 0.5]];
        for (const [xRatio, yRatio] of candidates) {
            const x = rect.left + rect.width * xRatio;
            const y = rect.top + rect.height * yRatio;
            if (document.elementFromPoint(x, y) === node) return { x, y, width: rect.width, height: rect.height };
        }
        return null;
    });
    expect(canvasPoint).not.toBeNull();
    await page.mouse.move(canvasPoint.x, canvasPoint.y);
    await page.mouse.down();
    await page.mouse.move(canvasPoint.x + Math.min(120, canvasPoint.width * 0.25), canvasPoint.y + Math.min(35, canvasPoint.height * 0.08), { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await stage.getAttribute('data-camera-revision') || 0)).toBeGreaterThan(revisionBefore);
    await page.locator('.hangar-camera-reset').click({ force: true });
    await page.waitForTimeout(1200);

    const agilityBefore = await readMetric(page, 'agility');
    await page.locator('[data-catalog-view="parts"]').click();
    const wingPart = page.locator('.hangar-part-card[data-part-id="wing_t2"]');
    await wingPart.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.waitForTimeout(100);
    await expect(wingPart).toBeVisible();
    await expect(wingPart).not.toHaveAttribute('data-locked', 'true');
    await wingPart.hover();
    await page.mouse.down();
    await expect(page.locator('.hangar-status-message')).toContainText('aufgenommen');
    await stage.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.waitForTimeout(100);
    const wingTarget = page.locator('[data-hangar-slot="wing_left"]');
    const targetPoint = await wingTarget.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
            x,
            y,
            hitSlot: hit?.closest?.('[data-hangar-slot]')?.getAttribute('data-hangar-slot') || '',
            inViewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
        };
    });
    expect(targetPoint.inViewport).toBeTruthy();
    expect(targetPoint.hitSlot, JSON.stringify(targetPoint)).toBe('wing_left');
    await page.mouse.move(targetPoint.x, targetPoint.y);
    await expect(wingTarget).toHaveClass(/is-drop-target/);
    await page.mouse.up();

    await expect(page.locator('[data-hangar-slot-row="wing_left"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect(page.locator('[data-hangar-slot-row="wing_right"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect.poll(() => readMetric(page, 'agility')).toBeGreaterThan(agilityBefore);

    await page.locator('.arcade-vehicle-preset-input').fill(BUILD_NAME);
    await page.locator('.arcade-vehicle-preset-save').click();
    await expect(page.locator('.arcade-vehicle-preset-select option', { hasText: BUILD_NAME })).toHaveCount(1);
    await page.evaluate(() => {
        window.__hangarPreviousContainer = document.getElementById('arcade-vehicle-manager');
    });

    await page.locator('#btn-start').click();
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.state === 'PLAYING'
        && (window.GAME_INSTANCE?.entityManager?.humanPlayers?.length || 0) > 0
    ), null, { timeout: 60000 });

    const runState = await page.evaluate(({ profileKey, lastRunKey }) => {
        const game = window.GAME_INSTANCE;
        const profileStore = JSON.parse(localStorage.getItem(profileKey) || '{}');
        const snapshot = JSON.parse(localStorage.getItem(lastRunKey) || '{}');
        const arcadeRuntime = game?.runtimeFacade?.arcadeRunRuntime;
        const activeProfile = arcadeRuntime?.getVehicleProfile?.();
        return {
            humanVehicleId: String(game?.entityManager?.humanPlayers?.[0]?.vehicleId || ''),
            snapshotVehicleId: String(snapshot.vehicleId || ''),
            snapshotBuildId: String(snapshot.buildId || ''),
            profileUpgrades: profileStore[snapshot.vehicleId]?.upgrades || {},
            activeProfileUpgrades: activeProfile?.upgrades || {},
        };
    }, { profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY, lastRunKey: ARCADE_LAST_RUN_STORAGE_KEY });
    expect(runState.humanVehicleId).toBe(selectedVehicleId);
    expect(runState.snapshotVehicleId).toBe(selectedVehicleId);
    expect(runState.snapshotBuildId).not.toBe('');
    expect(runState.profileUpgrades.wing_left_t2).toBe('T2');
    expect(runState.profileUpgrades.wing_right_t2).toBe('T2');
    expect(runState.activeProfileUpgrades).toEqual(runState.profileUpgrades);

    await returnToMenu(page);
    await openArcadeHangar(page);
    await expect(page.locator('.arcade-vehicle-preset-select option', { hasText: BUILD_NAME })).toHaveCount(1);
    await expect(page.locator('[data-hangar-slot-row="wing_left"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect(page.locator('[data-hangar-slot-row="wing_right"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect(page.locator('#arcade-vehicle-manager .hangar-viewport-canvas-node')).toHaveCount(1);
    await expect(page.locator('#arcade-vehicle-manager [data-hangar-slot]')).toHaveCount(7);
    const lifecycleState = await page.evaluate(() => ({
        oldDisposed: window.__hangarPreviousContainer?.dataset?.lifecycle === 'disposed',
        oldDisconnected: window.__hangarPreviousContainer?.isConnected === false,
        sameContainer: window.__hangarPreviousContainer === document.getElementById('arcade-vehicle-manager'),
    }));
    expect(lifecycleState.sameContainer || lifecycleState.oldDisposed || lifecycleState.oldDisconnected).toBeTruthy();

    const cleanupState = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const ui = game?.runtimeCoordinator?.getRuntimeHandle?.('ui') || game?.ui;
        const manager = ui?.__arcadeVehicleManager;
        const container = manager?.container;
        manager?.dispose?.();
        return {
            lifecycle: String(container?.dataset?.lifecycle || ''),
            canvases: container?.querySelectorAll('.hangar-viewport-canvas-node').length ?? -1,
            hardpoints: container?.querySelectorAll('[data-hangar-slot]').length ?? -1,
        };
    });
    expect(cleanupState).toEqual({ lifecycle: 'disposed', canvases: 0, hardpoints: 0 });
});
