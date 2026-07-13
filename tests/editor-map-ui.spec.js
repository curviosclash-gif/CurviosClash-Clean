import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.js';
import { EDITOR_API_ROUTES, EDITOR_DATA_PATHS, EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const TOOL_DOCK_STORAGE_KEY = 'cuviosclash.editor.tool-dock.v1';
const KNOWN_EDITOR_WARNING_PATTERNS = [
    'THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN.'
];

function filterKnownEditorWarnings(errors = []) {
    return errors.filter((message) => !KNOWN_EDITOR_WARNING_PATTERNS.some((pattern) => message.includes(pattern)));
}

async function loadEditorPage(page) {
    await page.addInitScript((storageKey) => {
        try {
            window.localStorage.removeItem(storageKey);
        } catch {
            // Ignore storage cleanup failures in restricted contexts.
        }
    }, TOOL_DOCK_STORAGE_KEY);

    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await page.goto(EDITOR_VIEW_PATHS.MAP_EDITOR, {
                waitUntil: 'domcontentloaded',
                timeout: 45_000
            });

            await page.waitForFunction(() => (
                !!window.CURVIOS_EDITOR?.getState
                && typeof window.render_game_to_text === 'function'
            ), null, {
                timeout: 30_000
            });

            await page.waitForSelector('#dockCategoryTabs .dockCategoryTab', { timeout: 30_000 });
            await page.waitForSelector('#dockCards [data-entry-id]', { timeout: 30_000 });
            return;
        } catch (error) {
            lastError = error;
            if (attempt >= 3) break;
            await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        }
    }

    throw lastError;
}

async function getEditorState(page) {
    return page.evaluate(() => window.CURVIOS_EDITOR?.getState?.() || null);
}

async function activateDockEntry(page, categoryId, entryId) {
    await page.locator(`#dockCategoryTabs [data-category-id="${categoryId}"]`).click();
    await page.locator(`#dockCards [data-entry-id="${entryId}"]`).click();
    await page.waitForFunction((expectedEntryId) => {
        const state = window.CURVIOS_EDITOR?.getState?.();
        return state?.activeEntryId === expectedEntryId && state?.currentTool !== 'select';
    }, entryId, { timeout: 10_000 });
}

async function clickCanvas(page, xFactor, yFactor = 0.32) {
    const canvas = page.locator('#threeCanvas');
    const box = await canvas.boundingBox();
    if (!box) {
        throw new Error('Editor canvas bounding box unavailable.');
    }

    await page.mouse.click(
        box.x + (box.width * xFactor),
        box.y + (box.height * yFactor)
    );
}

test.describe('V65: Editor Build Dock', () => {
    test.use({
        viewport: { width: 1600, height: 1100 }
    });

    test('T65a: Bottom-Dock rendert Kategorien, Schnellzugriff und Status sauber', async ({ page }) => {
        const errors = collectErrors(page);
        await loadEditorPage(page);

        await expect(page.locator('#buildDock')).toBeVisible();
        await expect(page.locator('#dockCategoryTabs .dockCategoryTab')).toHaveCount(4);
        await expect(page.locator('#dockActiveTitle')).toHaveText('Auswahl / Bewegen');
        await expect(page.locator('#dockRecentList')).toContainText('Noch nichts benutzt');
        await expect(page.locator('#dockFavoriteList')).toContainText('Keine Favoriten');

        const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
        expect(state.mode).toBe('select');
        expect(state.activeEntryId).toBe('build-hard');
        expect(state.objectCount).toBe(0);
        expect(filterKnownEditorWarnings(errors)).toHaveLength(0);
    });

    test('T65b: Kartenwahl schaltet den Platzierungs-Contract fuer Kernkategorien', async ({ page }) => {
        await loadEditorPage(page);

        const scenarios = [
            { categoryId: 'build', entryId: 'build-foam', tool: 'foam', subType: null },
            { categoryId: 'flow', entryId: 'flow-portal-ring', tool: 'portal', subType: 'portal_ring' },
            { categoryId: 'pickups', entryId: 'pickups-rocket', tool: 'item', subType: 'item_rocket' },
            { categoryId: 'aircraft', entryId: 'aircraft-ship5', tool: 'aircraft', subType: 'jet_ship5' }
        ];

        for (const scenario of scenarios) {
            await activateDockEntry(page, scenario.categoryId, scenario.entryId);
            const state = await getEditorState(page);
            expect(state?.currentTool).toBe(scenario.tool);
            expect(state?.activeEntryId).toBe(scenario.entryId);
            expect(state?.activeEntrySubType ?? null).toBe(scenario.subType);
        }
    });

    test('T65c: Klick in die Szene platziert Block, Portal, Item und Flugobjekt ueber das Dock', async ({ page }) => {
        const errors = collectErrors(page);
        await loadEditorPage(page);

        const placements = [
            { categoryId: 'build', entryId: 'build-hard', tool: 'hard', subType: null, xFactor: 0.28 },
            { categoryId: 'flow', entryId: 'flow-portal-ring', tool: 'portal', subType: 'portal_ring', xFactor: 0.42 },
            { categoryId: 'pickups', entryId: 'pickups-crystal', tool: 'item', subType: 'item_crystal', xFactor: 0.58 },
            { categoryId: 'aircraft', entryId: 'aircraft-ship5', tool: 'aircraft', subType: 'jet_ship5', xFactor: 0.74 }
        ];

        for (let index = 0; index < placements.length; index += 1) {
            const placement = placements[index];
            await activateDockEntry(page, placement.categoryId, placement.entryId);
            await clickCanvas(page, placement.xFactor);
            const expectedCount = index + 1;
            await page.waitForFunction((count) => {
                const state = window.CURVIOS_EDITOR?.getState?.();
                return Number(state?.objectCount || 0) >= count;
            }, expectedCount, { timeout: 10_000 });

            const state = await getEditorState(page);
            expect(state?.objectCount).toBe(expectedCount);
            const lastObject = state?.objects?.[state.objects.length - 1] || null;
            expect(lastObject?.type).toBe(placement.tool);
            expect(lastObject?.subType ?? null).toBe(placement.subType);
        }

        expect(filterKnownEditorWarnings(errors)).toHaveLength(0);
    });

    test('T65d: Save/Export/Playtest bleiben ueber den Dock-Flow stabil nutzbar', async ({ page }) => {
        const errors = collectErrors(page);
        await loadEditorPage(page);

        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.34);

        await page.locator('#btnExport').click();
        const exportedJson = await page.locator('#jsonOutput').inputValue();
        expect(exportedJson.length).toBeGreaterThan(20);

        const mapName = `V65 Smoke ${Date.now()}`;
        let saveRequestBody = null;
        let saveAlertMessage = '';
        await page.route(`**${EDITOR_API_ROUTES.SAVE_MAP_DISK}`, async (route) => {
            const request = route.request();
            saveRequestBody = JSON.parse(request.postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    mapName,
                    mapKey: 'editor_v65_smoke',
                    overwritten: false,
                    editorSchemaPath: `${EDITOR_DATA_PATHS.MAPS_DIR}/editor_v65_smoke.editor.json`,
                    runtimeMapPath: `${EDITOR_DATA_PATHS.MAPS_DIR}/editor_v65_smoke.runtime.json`,
                    generatedModulePath: EDITOR_DATA_PATHS.GENERATED_LOCAL_MAPS_MODULE,
                    warnings: []
                })
            });
        });

        page.on('dialog', async (dialog) => {
            if (dialog.type() === 'prompt') {
                await dialog.accept(mapName);
                return;
            }
            if (dialog.type() === 'alert') {
                saveAlertMessage = dialog.message();
            }
            await dialog.accept();
        });

        await page.locator('#btnSaveToGame').click();
        await expect.poll(() => saveRequestBody?.mapName || null).toBe(mapName);
        await expect.poll(() => saveAlertMessage).toContain('Map auf Festplatte neu gespeichert.');

        const popupPromise = page.waitForEvent('popup');
        await page.locator('#btnPlaytest').click();
        const popup = await popupPromise;
        await popup.waitForURL(/index\.html\?/, { timeout: 15_000 });
        expect(popup.url()).toContain('playtest=1');
        expect(popup.url()).toContain('planar=0');
        await popup.close();

        const evidenceScreenshotPath = String(process.env.V65_EVIDENCE_SCREENSHOT || '').trim();
        if (evidenceScreenshotPath) {
            await page.screenshot({ path: evidenceScreenshotPath, fullPage: true });
        }

        expect(filterKnownEditorWarnings(errors)).toHaveLength(0);
    });
});
