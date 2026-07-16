import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers.js';
import { EDITOR_API_ROUTES, EDITOR_DATA_PATHS, EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { EDITOR_BUILD_CATEGORIES } from '../editor/js/ui/EditorBuildCatalog.js';

const TOOL_DOCK_STORAGE_KEY = 'cuviosclash.editor.tool-dock.v1';
const EDITOR_LAYOUT_STORAGE_KEY = 'curviosclash.editor.layout.v1';
const EDITOR_AUTOSAVE_STORAGE_KEY = 'curviosclash.editor.autosave.v1';
const KNOWN_EDITOR_WARNING_PATTERNS = [
    'THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN.'
];

function filterKnownEditorWarnings(errors = []) {
    return errors.filter((message) => !KNOWN_EDITOR_WARNING_PATTERNS.some((pattern) => message.includes(pattern)));
}

async function loadEditorPage(page) {
    await page.addInitScript((storageKeys) => {
        try {
            storageKeys.forEach((storageKey) => window.localStorage.removeItem(storageKey));
        } catch {
            // Ignore storage cleanup failures in restricted contexts.
        }
    }, [TOOL_DOCK_STORAGE_KEY, EDITOR_LAYOUT_STORAGE_KEY, EDITOR_AUTOSAVE_STORAGE_KEY]);

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

    const dockBox = await page.locator('#buildDock').boundingBox();
    const visibleWidth = dockBox && dockBox.x > box.x ? dockBox.x - box.x : box.width;
    await page.mouse.click(
        box.x + (visibleWidth * xFactor),
        box.y + (box.height * yFactor)
    );
}

test.describe('V65: Editor Build Dock', () => {
    test.use({
        viewport: { width: 1600, height: 1100 }
    });

    test('T65a: Rechtes Dock rendert Kategorien, Schnellzugriff und Status sauber', async ({ page }) => {
        const errors = collectErrors(page);
        const missingPreviewAssets = [];
        page.on('console', (message) => {
            if (message.type() === 'warning' && message.text().includes('is not in cache')) {
                missingPreviewAssets.push(message.text());
            }
        });
        await loadEditorPage(page);

        await expect(page.locator('#buildDock')).toBeVisible();
        await expect(page.locator('#dockCategoryTabs .dockCategoryTab')).toHaveCount(EDITOR_BUILD_CATEGORIES.length);
        await expect(page.locator('#dockActiveTitle')).toHaveText('Auswahl / Bewegen');
        await expect(page.locator('#dockRecentList')).toContainText('Noch nichts benutzt');
        await expect(page.locator('#dockFavoriteList')).toContainText('Keine Favoriten');
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        await expect(page.locator('#validationList li')).toHaveCount(10);

        const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
        expect(state.mode).toBe('select');
        expect(state.activeEntryId).toBe('build-hard');
        expect(state.objectCount).toBe(0);
        expect(missingPreviewAssets).toEqual([]);
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

        await page.locator('#btnSaveToGame').click();
        await expect(page.locator('#editorModalBackdrop')).toHaveClass(/is-open/);
        await page.locator('#editorModalInput').fill(mapName);
        await page.locator('#btnEditorModalConfirm').click();
        await expect.poll(() => saveRequestBody?.mapName || null).toBe(mapName);
        expect(saveRequestBody?.editorDocument?.contractVersion).toBe('curvios-editor-document.v1');
        expect(saveRequestBody?.editorDocument?.authoring?.layerState?.layers?.geometry).toBeTruthy();
        expect(saveRequestBody?.jsonText).not.toContain('workspaceMetadata');
        await expect(page.locator('#workspaceStatusMessage')).toContainText(`Map neu gespeichert: ${mapName}`);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');

        const popupPromise = page.waitForEvent('popup');
        await page.locator('#btnPlaytest').click();
        const popup = await popupPromise;
        await popup.waitForURL(/index\.html\?/, { timeout: 15_000 });
        expect(popup.url()).toContain('playtest=1');
        expect(popup.url()).toContain('planar=0');
        await expect(popup.locator('#playtest-return-to-editor')).toBeVisible();
        await popup.close();

        const evidenceScreenshotPath = String(process.env.V65_EVIDENCE_SCREENSHOT || '').trim();
        if (evidenceScreenshotPath) {
            await page.screenshot({ path: evidenceScreenshotPath, fullPage: true });
        }

        expect(filterKnownEditorWarnings(errors)).toHaveLength(0);
    });
});

test.describe('Editor Workspace und Desktop-Layout', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('kompaktes Dock sitzt rechts und Seitenleistenbereiche ueberlappen nicht', async ({ page }) => {
        await loadEditorPage(page);

        const layout = await page.evaluate(() => {
            const dockRect = document.querySelector('#buildDock').getBoundingClientRect();
            const canvasRect = document.querySelector('.canvasShell').getBoundingClientRect();
            const panel = document.querySelector('.panel');
            const sections = Array.from(panel.querySelectorAll(':scope > .panelSection'))
                .map((section) => section.getBoundingClientRect());
            return {
                dockHeight: dockRect.height,
                dockWidth: dockRect.width,
                canvasHeight: canvasRect.height,
                canvasWidth: canvasRect.width,
                topGap: dockRect.top - canvasRect.top,
                rightGap: canvasRect.right - dockRect.right,
                bottomGap: canvasRect.bottom - dockRect.bottom,
                overlaps: sections.some((section, index) => index > 0 && section.top < sections[index - 1].bottom),
            };
        });

        for (const gap of [layout.topGap, layout.rightGap, layout.bottomGap]) {
            expect(gap).toBeGreaterThanOrEqual(12);
            expect(gap).toBeLessThanOrEqual(14);
        }
        expect(layout.dockHeight).toBeGreaterThan(layout.dockWidth);
        expect(layout.canvasWidth - layout.dockWidth).toBeGreaterThan(500);
        expect(layout.overlaps).toBeFalsy();

        await page.locator('#btnDockCollapse').click();
        await expect(page.locator('#buildDock')).toHaveClass(/is-collapsed/);
        await expect(page.locator('#btnToggleDockFromScene')).toHaveText('Baukarten zeigen');
        await page.locator('#btnToggleDockFromScene').click();
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-collapsed/);
    });

    test('Outliner, Inspector, Dirty-State und Pointer-Capture bilden einen stabilen Autorenfluss', async ({ page }) => {
        await loadEditorPage(page);
        await activateDockEntry(page, 'build', 'build-hard');

        const canvasBox = await page.locator('#threeCanvas').boundingBox();
        const dockBox = await page.locator('#buildDock').boundingBox();
        expect(canvasBox).toBeTruthy();
        expect(dockBox).toBeTruthy();

        await page.mouse.move(canvasBox.x + canvasBox.width * 0.32, canvasBox.y + 180);
        await page.mouse.down();
        await page.mouse.move(dockBox.x + 70, dockBox.y + 70, { steps: 4 });
        await page.mouse.up();

        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        await expect.poll(() => page.evaluate(() => window.localStorage.getItem('curviosclash.editor.autosave.v1'))).not.toBeNull();
        await expect(page.locator('#propPanel')).toBeVisible();
        await expect(page.getByLabel('X-Position')).toBeVisible();
        await expect(page.getByLabel('Rotation Y (Grad)')).toBeVisible();
        await expect(page.locator('#btnDuplicateSelected')).toBeEnabled();

        await page.locator('#propX').fill('125');
        await page.locator('#propX').press('Tab');
        await page.locator('#propX').fill('0');
        await page.locator('#propX').press('Tab');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.ui.selectedObject.position.x)).toBe(0);

        await page.locator('#btnToggleSelectedLock').click();
        await expect(page.locator('#btnDelSelected')).toBeDisabled();
        await page.keyboard.press('Delete');
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await page.locator('#btnToggleSelectedLock').click();
        await expect(page.locator('#btnDelSelected')).toBeEnabled();

        await page.locator('#btnDuplicateSelected').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(2);
        await expect(page.locator('#btnUndo')).toBeEnabled();

        const marked = page.locator('#objectList input[type="checkbox"]');
        await marked.nth(0).check();
        await marked.nth(1).check();
        await expect(page.locator('#btnGroupMarked')).toBeEnabled();
        await page.locator('#btnGroupMarked').click();
        const groupIds = await page.evaluate(() => Array.from(window.CURVIOS_EDITOR.core.objectsContainer.children)
            .map((object) => object.userData?.groupId || ''));
        expect(groupIds[0]).toBeTruthy();
        expect(new Set(groupIds).size).toBe(1);

        await page.locator('#btnTransformMarked').click();
        await page.locator('#editorModalInput').fill('100, 0, 50, 90, 1');
        await page.locator('#btnEditorModalConfirm').click();
        const transformed = await page.evaluate(() => Array.from(window.CURVIOS_EDITOR.core.objectsContainer.children)
            .map((object) => ({ x: Math.round(object.position.x), z: Math.round(object.position.z) })));
        expect(transformed.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))).toBeTruthy();
    });

    test('Katalogsuche und sicherer Neue-Map-Dialog funktionieren ohne Browser-Popups', async ({ page }) => {
        await loadEditorPage(page);

        await page.locator('#dockSearch').fill('Rakete');
        await expect(page.locator('#dockCards [data-entry-id="pickups-rocket"]')).toBeVisible();
        await expect(page.locator('#dockCards [data-entry-id]')).toHaveCount(1);

        await page.locator('#dockSearch').fill('');
        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.35, 0.24);
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);

        await page.locator('#btnNew').click();
        await expect(page.locator('#editorModalBackdrop')).toHaveClass(/is-open/);
        await page.locator('#btnEditorModalCancel').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);

        await page.locator('#btnNew').click();
        await page.locator('#btnEditorModalConfirm').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(0);
    });

    test('Ebenen, Vorlagen, 3D-Vorschauen und orthografische Ansichten arbeiten zusammen', async ({ page }) => {
        await loadEditorPage(page);
        await expect(page.locator('#prefabList .prefabCard')).toHaveCount(4);
        await page.locator('#prefabList .prefabCard').first().getByRole('button', { name: 'Einsetzen' }).click();
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(4);
        await expect(page.locator('#layerList .layerRow')).toHaveCount(6);

        const geometryLayer = page.locator('#layerList [data-layer-id="geometry"]');
        await geometryLayer.getByRole('button', { name: 'Geometrie sperren' }).click();
        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.4);
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(4);
        await expect(page.locator('#workspaceStatusMessage')).toContainText('aktive Ebene ist gesperrt');
        await geometryLayer.getByRole('button', { name: 'Geometrie entsperren' }).click();

        const spawnLayer = page.locator('#layerList [data-layer-id="spawns"]');
        await spawnLayer.getByRole('button', { name: /Spawns ausblenden/ }).click();
        const spawnVisibility = await page.evaluate(() => Array.from(window.CURVIOS_EDITOR.core.objectsContainer.children)
            .filter((object) => object.userData.type === 'spawn').map((object) => object.visible));
        expect(spawnVisibility.every((visible) => visible === false)).toBeTruthy();

        await page.locator('#btnViewTop').click();
        const cameraState = await page.evaluate(() => ({
            mode: window.CURVIOS_EDITOR.core.viewMode,
            orthographic: window.CURVIOS_EDITOR.core.camera.isOrthographicCamera === true,
        }));
        expect(cameraState).toEqual({ mode: 'top', orthographic: true });

        await expect(page.locator('#assetStatusText')).toContainText(/geladen/i);
        await expect.poll(() => page.locator('#dockCards .buildCardPreview img').count()).toBeGreaterThan(0);
    });

    test('Portal- und Parcours-Beziehungen werden bearbeitet, visualisiert und geprueft', async ({ page }) => {
        await loadEditorPage(page);
        const ids = await page.evaluate(() => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            const created = [];
            manager.withSceneMutation(() => {
                created.push(manager.createMesh('portal', 'portal_ring', -300, 300, 0, 120));
                created.push(manager.createMesh('portal', 'portal_ring', 300, 300, 0, 120));
                created.push(manager.createMesh('checkpoint', 'start', -500, 250, 0, 0));
                created.push(manager.createMesh('checkpoint', 'gate', 0, 250, 0, 0));
                created.push(manager.createMesh('checkpoint', 'finish', 500, 250, 0, 0));
            });
            return created.map((object) => object.userData.id);
        });
        await expect.poll(() => page.locator('#objectList .objectRow').count()).toBe(5);
        await page.evaluate((id) => window.CURVIOS_EDITOR.ui.selectObject(window.CURVIOS_EDITOR.mapManager.getObjectById(id)), ids[0]);
        await page.locator('#propPortalPartner').selectOption(ids[1]);
        const relation = await page.evaluate(([left, right]) => ({
            left: window.CURVIOS_EDITOR.mapManager.getObjectById(left).userData.portalPartnerId,
            right: window.CURVIOS_EDITOR.mapManager.getObjectById(right).userData.portalPartnerId,
            lineCount: window.CURVIOS_EDITOR.core.scene.getObjectByName('editor-relationships').children.length,
        }), [ids[0], ids[1]]);
        expect(relation.left).toBe(ids[1]);
        expect(relation.right).toBe(ids[0]);
        expect(relation.lineCount).toBeGreaterThanOrEqual(3);
        await expect(page.locator('#validationList')).toContainText('Portale sind explizit gepaart');
    });

    test('grosse Maps nutzen virtuellen Outliner und raeumliche Auswahlindizes', async ({ page }) => {
        await loadEditorPage(page);
        await page.evaluate(() => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            manager.withSceneMutation(() => {
                for (let index = 0; index < 260; index += 1) {
                    manager.createMesh('hard', null, (index % 26) * 100, 80, Math.floor(index / 26) * 100, 50, {
                        sizeX: 50, sizeY: 50, sizeZ: 50,
                    });
                }
            });
        });
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(260);
        const scaleState = await page.evaluate(() => ({
            renderedRows: document.querySelectorAll('#objectList .objectRow').length,
            nearby: window.CURVIOS_EDITOR.mapManager.queryObjectsNear({ x: 50, z: 50 }, 250).length,
        }));
        expect(scaleState.renderedRows).toBeLessThan(30);
        expect(scaleState.nearby).toBeGreaterThan(0);
        expect(scaleState.nearby).toBeLessThan(260);

        await page.locator('#objectList').evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await page.locator('#objectSearch').fill('hard_260');
        await expect(page.getByRole('button', { name: 'Hartblock · hard_260', exact: true })).toBeVisible();
    });
});

test.describe('Legacy-2D-Editor auf HiDPI-Displays', () => {
    test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });

    test('Canvas-Mitte bleibt bei 200 Prozent Skalierung Weltursprung', async ({ page }) => {
        await page.goto('/editor/map-editor.html', { waitUntil: 'domcontentloaded' });
        const canvas = page.locator('#mapCanvas');
        const box = await canvas.boundingBox();
        expect(box).toBeTruthy();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.locator('#hudPos')).toHaveText('x=0, z=0');
        const sizing = await canvas.evaluate((element) => ({
            internalWidth: element.width,
            displayWidth: element.clientWidth,
        }));
        expect(sizing.internalWidth).toBeCloseTo(sizing.displayWidth * 2, 0);
    });
});
