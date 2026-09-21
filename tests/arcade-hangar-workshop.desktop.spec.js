import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    expect,
    loadGame,
    loadGameWithRetry,
    openCustomSubmenu,
    openStartSetupSection,
    returnToMenu,
    test,
    waitForRenderFrames,
} from './core-targeted.shared.js';

import {
    PLAYER_PROFILE_REGISTRY_STORAGE_KEY,
    resolvePlayerScopedStorageKey,
} from '../src/shared/contracts/PlayerProfileStorageContract.js';

const HANGAR_BUILD_STORAGE_KEY = 'curviosclash.hangar.arcade-builds.v2';
const BUILD_NAME = 'Desktop E2E Build';

// Records are written through the active player profile, which stores them under a key scoped to
// that profile rather than the legacy one. Reading the legacy key straight from localStorage only
// works until a profile exists -- after that it is empty and every assertion on it reads "". The
// runtime resolves the scoped key and falls back to the legacy one; a test that seeds the legacy
// key and then reads back what the game wrote has to do the same.
async function resolveProfileScopedKey(page, legacyStorageKey) {
    const activeProfileId = await page.evaluate((registryKey) => {
        try {
            return String(JSON.parse(localStorage.getItem(registryKey) || "{}")?.activeProfileId || "");
        } catch {
            return "";
        }
    }, PLAYER_PROFILE_REGISTRY_STORAGE_KEY);
    return resolvePlayerScopedStorageKey(activeProfileId, legacyStorageKey) || legacyStorageKey;
}

async function openArcadeHangar(page) {
    if (await page.locator('#menu-nav [data-session-type="single"]').first().isVisible()) {
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    }
    await page.goto(new URL('/hangar.html?mode=arcade', page.url()).href);
    await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#arcade-vehicle-preview-stage')).toHaveAttribute('data-preview-status', 'ready');
}

test('Desktop-Hangar: Filter haben lesbaren Kontrast und Fassungen vollständige Namen', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loadGame(page);
    await openArcadeHangar(page);

    const appearance = await page.evaluate(() => {
        const parse = (value) => {
            const parts = value.match(/[\d.]+/gu)?.map(Number) || [];
            return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1];
        };
        const luminance = (rgb) => {
            const channels = rgb.slice(0, 3).map((value) => {
                const normalized = value / 255;
                return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const contrast = (node) => {
            const layers = [];
            for (let current = node; current; current = current.parentElement) {
                layers.unshift(parse(getComputedStyle(current).backgroundColor));
            }
            let background = [0, 0, 0];
            for (const [red, green, blue, alpha] of layers) {
                background = [red, green, blue].map((value, index) => value * alpha + background[index] * (1 - alpha));
            }
            const foreground = parse(getComputedStyle(node).color);
            const brighter = Math.max(luminance(foreground), luminance(background));
            const darker = Math.min(luminance(foreground), luminance(background));
            return (brighter + 0.05) / (darker + 0.05);
        };
        const buttons = [...document.querySelectorAll('.arcade-vehicle-tab, .arcade-vehicle-chip')];
        const slots = [...document.querySelectorAll('.hangar-slot-grid .hangar-slot-select')];
        return {
            buttons: buttons.map((button) => ({
                styled: button.classList.contains('secondary-btn'),
                ratio: contrast(button),
            })),
            clippedSlots: slots.filter((slot) => slot.scrollWidth > slot.clientWidth + 1).map((slot) => slot.textContent),
        };
    });
    expect(appearance.buttons.length).toBeGreaterThan(0);
    expect(appearance.buttons.every((button) => button.styled && button.ratio >= 4.5)).toBe(true);
    expect(appearance.clippedSlots).toEqual([]);
});

async function seedUnlockedProfiles(page) {
    const vehicleIds = await page.evaluate(() => Array.from(document.querySelectorAll('#vehicle-select-p1 option'))
        .map((option) => String(option.value || '').trim())
        .filter(Boolean));
    const seeded = await page.evaluate(({ profileKey, loadoutKey, buildKey, lastRunKey, ids }) => {
        const store = window.GAME_INSTANCE?.settingsManager?.getPlayerRecordStorePort?.();
        if (!store?.saveJsonRecord || !store?.removeJsonRecord) return false;
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
            xpBank: 999999,
            level: 30,
            unlockedSlots: [...unlockedSlots],
            upgrades: {},
            createdAt: nowIso,
            updatedAt: nowIso,
        }]));
        const saveResult = store.saveJsonRecord(profileKey, profiles);
        store.removeJsonRecord(loadoutKey);
        store.removeJsonRecord(buildKey);
        store.removeJsonRecord(lastRunKey);
        return saveResult?.success === true;
    }, {
        profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
        loadoutKey: ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
        buildKey: HANGAR_BUILD_STORAGE_KEY,
        lastRunKey: ARCADE_LAST_RUN_STORAGE_KEY,
        ids: vehicleIds,
    });
    expect(seeded).toBe(true);
}

function readMetric(page, metric) {
    return page.locator(`[data-metric="${metric}"] .hangar-stat-value`).evaluate((node) => Number(node.textContent));
}

test('Desktop-Hangar: Fahrzeugschalter wechseln sichtbar vor und zurück', async ({ page }) => {
    await loadGame(page);
    await openArcadeHangar(page);

    await expect(page.locator('.hangar-status-message')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.hangar-preset-sort')).toHaveAttribute('aria-label', 'Builds sortieren');
    await expect(page.locator('.arcade-vehicle-preset-select')).toHaveAttribute('aria-label', 'Gespeicherter Build');
    expect(await page.locator('.arcade-vehicle-card').evaluateAll((cards) => (
        cards.filter((card) => card.tabIndex === 0).length
    ))).toBe(1);
    const vehicleCards = page.locator('.arcade-vehicle-card');
    await expect(page.locator('.arcade-vehicle-card .hangar-vehicle-card-preview')).toHaveCount(await vehicleCards.count());
    const aircraftPreview = page.locator('.arcade-vehicle-card[data-vehicle-id="aircraft"] .hangar-vehicle-card-preview');
    await aircraftPreview.scrollIntoViewIfNeeded();
    await expect(aircraftPreview).toHaveAttribute('data-preview-status', 'ready', { timeout: 10_000 });
    const previewLayout = await aircraftPreview.evaluate((canvas) => {
        const preview = canvas.getBoundingClientRect();
        const card = canvas.closest('.arcade-vehicle-card').getBoundingClientRect();
        return {
            width: preview.width,
            height: preview.height,
            contained: preview.left >= card.left && preview.right <= card.right + 1
                && preview.top >= card.top && preview.bottom <= card.bottom + 1,
        };
    });
    expect(previewLayout.width).toBeGreaterThanOrEqual(100);
    expect(previewLayout.height).toBeGreaterThanOrEqual(55);
    expect(previewLayout.contained).toBe(true);
    if (!await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        const firstFrame = await aircraftPreview.evaluate((canvas) => canvas.toDataURL());
        await expect.poll(() => aircraftPreview.evaluate((canvas) => canvas.toDataURL())).not.toBe(firstFrame);
    }
    await expect(page.locator('[data-remove-slot="core"]')).toHaveAttribute('aria-label', 'Core-Fassung: Stein entfernen');
    await expect(page.locator('[data-remove-slot="core"]')).toHaveAttribute('aria-description', 'Pflichtfassung kann nicht geleert werden');

    const infoHints = page.locator('#arcade-vehicle-manager .menu-info-hint');
    await expect(infoHints).toHaveCount(3);
    await expect(infoHints.nth(0)).toHaveAttribute(
        'title',
        'Universelle Steine einsetzen und den nächsten Run vorbereiten.'
    );
    await expect(infoHints.nth(1)).toHaveAttribute(
        'title',
        'Ziehen: drehen · Rad: zoomen · Rechtszug: verschieben · Esc: Drag abbrechen'
    );
    await expect(infoHints.nth(2)).toHaveAttribute(
        'title',
        'Entf: Stein entfernen · Strg+Z/Y: Undo/Redo · Vorschau: Pfeile wechseln das Fahrzeug'
    );

    const previousButton = page.getByRole('button', { name: 'Vorheriges Fahrzeug' });
    const nextButton = page.getByRole('button', { name: 'Nächstes Fahrzeug' });
    await expect(previousButton).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(previousButton).toBeEnabled();
    await expect(nextButton).toBeEnabled();

    const selectedBefore = await page.locator('.arcade-vehicle-card[aria-selected="true"]').getAttribute('data-vehicle-id');
    await nextButton.click();
    await expect(page.locator('.arcade-vehicle-card[aria-selected="true"]')).not.toHaveAttribute('data-vehicle-id', selectedBefore);
    await previousButton.click();
    await expect(page.locator('.arcade-vehicle-card[aria-selected="true"]')).toHaveAttribute('data-vehicle-id', selectedBefore);

    const categoryFilter = page.getByRole('button', { name: 'Alle', exact: true });
    await categoryFilter.focus();
    await categoryFilter.press('ArrowRight');
    await expect(page.locator('.arcade-vehicle-card[aria-selected="true"]')).toHaveAttribute('data-vehicle-id', selectedBefore);
    await page.locator('#arcade-vehicle-preview-stage').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.arcade-vehicle-card[aria-selected="true"]')).not.toHaveAttribute('data-vehicle-id', selectedBefore);

    await page.locator('.arcade-vehicle-search').fill('__keine_fahrzeuge__');
    await expect(previousButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();
});

test('Desktop-Hangar: 3D-Umbau, Speicherung, Run-Übernahme und Wiederöffnung', async ({ page }) => {
    test.setTimeout(300_000);
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
    await expect(page.locator(`#arcade-vehicle-manager .arcade-vehicle-card[data-vehicle-id="${selectedVehicleId}"]`)).toHaveAttribute('aria-selected', 'true');

    const stage = page.locator('#arcade-vehicle-preview-stage');
    const revisionBefore = Number(await stage.getAttribute('data-camera-revision') || 0);
    const canvas = page.locator('.hangar-viewport-canvas-node');
    await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await waitForRenderFrames(page, 2);
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
    await waitForRenderFrames(page, 72);

    const raycastPoint = await page.locator('[data-hangar-slot="wing_left"]').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        document.querySelector('.hangar-hardpoint-overlay').style.pointerEvents = 'none';
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(raycastPoint.x, raycastPoint.y);
    await expect(page.locator('[data-hangar-slot-row="wing_left"]')).toHaveClass(/is-selected/);
    await page.locator('.hangar-hardpoint-overlay').evaluate((node) => { node.style.pointerEvents = ''; });

    const agilityBefore = await readMetric(page, 'agility');
    await page.locator('[data-build-view="presets"]').click();
    await page.locator('[data-catalog-view="parts"]').click();
    await expect(page.locator('.hangar-part-card')).toHaveCount(15);
    await expect(page.locator('.hangar-part-card-preview')).toHaveCount(15);
    const stonePreview = page.locator('.hangar-part-card[data-part-id="stone_blue_t1"] .hangar-part-card-preview');
    await stonePreview.scrollIntoViewIfNeeded();
    await expect(stonePreview).toHaveAttribute('data-preview-status', 'ready');
    const stonePreviewLayout = await stonePreview.evaluate((canvas) => {
        const preview = canvas.getBoundingClientRect();
        const button = canvas.closest('.hangar-part-select').getBoundingClientRect();
        return {
            width: preview.width,
            height: preview.height,
            contained: preview.left >= button.left && preview.right <= button.right + 1
                && preview.top >= button.top && preview.bottom <= button.bottom + 1,
        };
    });
    expect(stonePreviewLayout.width).toBeGreaterThanOrEqual(108);
    expect(stonePreviewLayout.height).toBeGreaterThanOrEqual(58);
    expect(stonePreviewLayout.contained).toBe(true);
    if (!await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        const firstFrame = await stonePreview.evaluate((canvas) => canvas.toDataURL());
        await expect.poll(() => stonePreview.evaluate((canvas) => canvas.toDataURL())).not.toBe(firstFrame);
    }
    const catalogMetrics = await page.locator('.hangar-catalog-list').evaluate((list) => ({
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        minimumCardHeight: Math.min(...Array.from(list.querySelectorAll('.hangar-part-card'))
            .map((card) => card.getBoundingClientRect().height)),
    }));
    expect(catalogMetrics.minimumCardHeight).toBeGreaterThan(100);
    expect(catalogMetrics.scrollHeight).toBeGreaterThan(catalogMetrics.clientHeight);
    expect(await page.locator('.hangar-part-filters select').evaluateAll((selects) => (
        selects.every((select) => select.getBoundingClientRect().width >= 100)
    ))).toBe(true);
    await page.locator('.hangar-part-trait-filter').selectOption('speed');
    await expect(page.locator('.hangar-part-card')).toHaveCount(3);
    await expect(page.locator('.hangar-part-filter-reset')).toBeEnabled();
    await page.locator('.hangar-part-filter-reset').click();
    await expect(page.locator('.hangar-part-card')).toHaveCount(15);
    await expect(page.locator('.hangar-part-filter-reset')).toBeDisabled();
    await expect(page.locator('.hangar-part-card[data-part-id="stone_blue_t1"] .hangar-part-stats')).toContainText('Tempo +3');
    await expect(page.locator('.hangar-part-card[data-part-id="stone_green_t1"] .hangar-part-costs')).toContainText('Paarpreis');
    await expect(page.locator('.hangar-part-card[data-part-id="stone_green_t1"] .hangar-part-run-bonuses')).toContainText('Wende +4%');

    const violetCore = page.locator('.hangar-part-card[data-part-id="stone_violet_t1"]');
    await violetCore.locator('.hangar-part-select').click();
    await expect(page.locator('[data-build-view="workshop"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-build-view-panel="workshop"]')).toBeVisible();
    await expect(violetCore.locator('.hangar-part-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.hangar-part-preview')).toContainText('Fassung anklicken');
    await page.locator('[data-hangar-slot="core"]').click();
    await expect(page.locator('[data-hangar-slot-row="core"] .hangar-installed-part')).toContainText('Resonanzstein T1');
    await expect(page.locator('.hangar-status-message')).toContainText('eingesetzt');

    await page.locator('[data-build-view="presets"]').click();
    await expect(page.locator('[data-build-view-panel="presets"]')).toBeVisible();
    await expect(page.locator('[data-starter-build="sprinter"]')).toContainText('Tempo und geringes Gewicht');
    await expect(page.locator('.hangar-preset-rename')).toBeHidden();
    await expect(page.locator('.hangar-preset-more summary')).toHaveAttribute('aria-controls', 'hangar-preset-more-actions');
    await page.locator('.hangar-preset-more summary').click();
    await expect(page.locator('.hangar-preset-rename')).toBeVisible();
    await page.locator('[data-starter-build="sprinter"]').click();
    await expect(page.locator('[data-hangar-slot-row="wing_left"] .hangar-installed-part')).toContainText('Wendestein T1');
    await expect(page.locator('.hangar-status-message')).toContainText('Sprinter Build geladen');
    await page.locator('[data-build-view="workshop"]').click();
    await page.locator('[data-select-slot="wing_left"]').click();
    const wingPart = page.locator('.hangar-part-card[data-part-id="stone_green_t2"]');
    await wingPart.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await waitForRenderFrames(page, 2);
    await expect(wingPart).toBeVisible();
    await expect(wingPart).not.toHaveAttribute('data-locked', 'true');
    const purchaseButton = wingPart.locator('[data-purchase-stone-id="stone_green_t2"]');
    await expect(purchaseButton).toBeVisible();
    await wingPart.locator('.hangar-part-select').click();
    await expect(purchaseButton).toBeVisible();
    await expect(page.locator('.hangar-status-message')).toContainText('Kauf separat bestätigen');
    await purchaseButton.click();
    await expect(purchaseButton).toBeVisible();
    await expect(purchaseButton).toContainText('1 Exemplar');
    await expect(page.locator('.hangar-status-message')).toContainText('gekauft');
    await purchaseButton.click();
    await expect(wingPart.locator('[data-purchase-stone-id="stone_green_t2"]')).toHaveCount(0);
    await expect(page.locator('.hangar-status-message')).toContainText('gekauft');
    await wingPart.locator('.hangar-part-select').hover();
    await page.mouse.down();
    const wingPartPoint = await wingPart.locator('.hangar-part-select').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(wingPartPoint.x + 8, wingPartPoint.y, { steps: 2 });
    await expect(page.locator('.hangar-status-message')).toContainText('aufgenommen');
    await stage.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await waitForRenderFrames(page, 2);
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

    await page.locator('[data-build-view="stats"]').click();
    await expect(page.locator('[data-metric="agility"] .hangar-stat-comparisons')).toContainText('Seit Standard:');
    await expect(page.locator('[data-metric="agility"] .hangar-stat-comparisons')).toContainText('Gegen ');
    await expect(page.locator('[data-metric="agility"] .hangar-stat-value')).toHaveAttribute('title', /Wendigheitswert/);

    await page.locator('[data-build-view="presets"]').click();
    await page.locator('.arcade-vehicle-preset-input').fill(BUILD_NAME);
    await page.locator('.arcade-vehicle-preset-save').click();
    await expect(page.locator('.arcade-vehicle-preset-select option', { hasText: BUILD_NAME })).toHaveCount(1);
    await page.locator('.hangar-activate-build').click();
    await expect(page.locator('.hangar-status-message')).toContainText('aktiviert');

    await page.goto(new URL('/', page.url()).href);
    await loadGameWithRetry(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.gameMode === 'ARCADE'
        && window.GAME_INSTANCE?.settings?.localSettings?.modePath === 'arcade'
    ));
    await page.selectOption('#map-select', 'standard');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'standard');
    await expect(page.locator('#arcade-vehicle-manager')).toHaveCount(0);
    await openStartSetupSection(page, 'arcade');
    await page.locator('#btn-arcade-start-inline').click();
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.state === 'PLAYING'
        && (window.GAME_INSTANCE?.entityManager?.humanPlayers?.length || 0) > 0
    ), null, { timeout: 60000 });

    const scopedLastRunKey = await resolveProfileScopedKey(page, ARCADE_LAST_RUN_STORAGE_KEY);
    const scopedProfileKey = await resolveProfileScopedKey(page, ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    const runState = await page.evaluate(({ profileKey, lastRunKey, legacyProfileKey, legacyLastRunKey }) => {
        const read = (scopedKey, legacyKey) => {
            try {
                return JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem(legacyKey) || "{}");
            } catch {
                return {};
            }
        };
        const game = window.GAME_INSTANCE;
        const profileStore = read(profileKey, legacyProfileKey);
        const snapshot = read(lastRunKey, legacyLastRunKey);
        return {
            humanVehicleId: String(game?.entityManager?.humanPlayers?.[0]?.vehicleId || ''),
            snapshotVehicleId: String(snapshot.vehicleId || ''),
            snapshotBuildId: String(snapshot.buildId || ''),
            profileUpgrades: profileStore[snapshot.vehicleId]?.upgrades || {},
        };
    }, {
        profileKey: scopedProfileKey,
        lastRunKey: scopedLastRunKey,
        legacyProfileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
        legacyLastRunKey: ARCADE_LAST_RUN_STORAGE_KEY,
    });
    expect(runState.humanVehicleId).toBe(selectedVehicleId);
    expect(runState.snapshotVehicleId).toBe(selectedVehicleId);
    expect(runState.snapshotBuildId).not.toBe('');
    expect(runState.profileUpgrades.wing_left_t2).toBe('T2');
    expect(runState.profileUpgrades.wing_right_t2).toBe('T2');
    await expect.poll(() => page.evaluate(() => ({
        ...(window.GAME_INSTANCE?.runtimeFacade?.arcadeRunRuntime?.getVehicleProfile?.()?.upgrades || {}),
    }))).toEqual(runState.profileUpgrades);

    await returnToMenu(page);
    await openArcadeHangar(page);
    await expect(page.locator('.arcade-vehicle-preset-select option', { hasText: BUILD_NAME })).toHaveCount(1);
    await expect(page.locator('[data-hangar-slot-row="wing_left"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect(page.locator('[data-hangar-slot-row="wing_right"] .arcade-vehicle-slot-tier')).toHaveText('T2');
    await expect(page.locator('#arcade-vehicle-manager .hangar-viewport-canvas-node')).toHaveCount(1);
    await expect(page.locator('#arcade-vehicle-manager [data-hangar-slot]')).toHaveCount(7);
});
