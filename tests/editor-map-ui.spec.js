import { mkdir, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as baseTest, expect } from './helpers.desktop.js';
import { collectErrors, resolveAppUrl } from './helpers.js';
import { EDITOR_API_ROUTES, EDITOR_DATA_PATHS, EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { EDITOR_BUILD_CATEGORIES } from '../editor/js/ui/EditorBuildCatalog.js';

const IS_BROWSER_COMPAT = process.env.PW_RUN_PROFILE === 'browser-compat';

// Im Desktop-Profil ist die Seite ein echtes Electron-Fenster. Die
// Playwright-Option `viewport` gilt dort nicht, deshalb merkt sich der Test
// die laufende Anwendung und setzt die Fenstergroesse selbst.
let currentElectronApp = null;

// Exercise the real editor window and leave the game window available for its
// desktop shutdown handshake. Navigating the game window breaks that handshake.
const test = IS_BROWSER_COMPAT ? baseTest : baseTest.extend({
    page: async ({ page, electronApp }, use) => {
        currentElectronApp = electronApp;
        const downloads = await mkdtemp(path.join(os.tmpdir(), 'curvios-editor-ui-downloads-'));
        await electronApp.evaluate(({ app }, directory) => app.setPath('downloads', directory), downloads);
        const popupPromise = page.waitForEvent('popup');
        await page.evaluate((editorPath) => window.open(editorPath, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
        const editorPage = await popupPromise;
        try { await use(editorPage); }
        finally {
            if (!editorPage.isClosed()) {
                await editorPage.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved?.());
                await editorPage.close();
            }
        }
    },
});

const TOOL_DOCK_STORAGE_KEY = 'cuviosclash.editor.tool-dock.v1';
const EDITOR_LAYOUT_STORAGE_KEY = 'curviosclash.editor.layout.v1';
const EDITOR_AUTOSAVE_STORAGE_KEY = 'curviosclash.editor.autosave.v1';
const PLAYTEST_RETURN_STORAGE_KEY = 'curviosclash.editor.playtest-return.v1';

// These tests own a fresh editor session; release its unsaved-close guard after assertions.
test.afterEach(async ({ page }) => {
    if (!page.isClosed()) await page.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved?.());
});

async function loadEditorPage(page, { autosave = null, waitForDockVisible = true } = {}) {
    await page.addInitScript(({ storageKeys, autosaveStorageKey, autosaveValue }) => {
        try {
            storageKeys.forEach((storageKey) => window.localStorage.removeItem(storageKey));
            if (autosaveValue) window.localStorage.setItem(autosaveStorageKey, JSON.stringify(autosaveValue));
        } catch {
            // Ignore storage cleanup failures in restricted contexts.
        }
    }, {
        storageKeys: [TOOL_DOCK_STORAGE_KEY, EDITOR_LAYOUT_STORAGE_KEY, EDITOR_AUTOSAVE_STORAGE_KEY],
        autosaveStorageKey: EDITOR_AUTOSAVE_STORAGE_KEY,
        autosaveValue: autosave,
    });

    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await page.goto(resolveAppUrl(page, EDITOR_VIEW_PATHS.MAP_EDITOR), {
                waitUntil: 'domcontentloaded',
                timeout: 45_000
            });

            await page.waitForFunction(() => (
                !!window.CURVIOS_EDITOR?.getState
                && typeof window.render_game_to_text === 'function'
            ), null, {
                timeout: 30_000
            });

            const dockElementState = waitForDockVisible ? 'visible' : 'attached';
            await page.waitForSelector('#dockCategoryTabs .dockCategoryTab', { state: dockElementState, timeout: 30_000 });
            await page.waitForSelector('#dockCards [data-entry-id]', { state: dockElementState, timeout: 30_000 });
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

/**
 * Legt den Kartenspeicher der Desktop-App in den Testordner und faengt das
 * Oeffnen des Ordners ab, damit kein echter Explorer aufgeht.
 */
async function useIsolatedDesktopMapStore(testInfo) {
    const userDataDirectory = testInfo.outputPath('user-data');
    await mkdir(userDataDirectory, { recursive: true });
    await currentElectronApp.evaluate(({ app }, directory) => app.setPath('userData', directory), userDataDirectory);
    await currentElectronApp.evaluate(({ shell }) => {
        globalThis.__CURVIOS_OPENED_FOLDERS__ = [];
        shell.openPath = (target) => {
            globalThis.__CURVIOS_OPENED_FOLDERS__.push(target);
            return Promise.resolve('');
        };
    });
    const mapsDirectory = path.join(userDataDirectory, EDITOR_DATA_PATHS.USER_MAPS_DIR);
    await mkdir(mapsDirectory, { recursive: true });
    return {
        mapsDirectory,
        countOpenedFolders: () => currentElectronApp.evaluate(
            () => globalThis.__CURVIOS_OPENED_FOLDERS__.length
        ),
    };
}

async function activateInspectorTab(page, panelId) {
    const tab = page.locator(`[data-editor-tab="${panelId}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openFileMenu(page) {
    const menu = page.locator('#fileMenu');
    if (!await menu.getAttribute('open')) await menu.locator('summary').click();
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
        // Blocked checkpoint centres got their own (export blocking) item next to the reachability hint.
        await expect(page.locator('#validationList li')).toHaveCount(11);
        await expect(page.locator('#validationStateBadge')).toHaveText('1 Fehler · 1 Warnung');
        await expect(page.locator('#validationIssueBadge')).toHaveText('2');
        await expect(page.locator('#btnDuplicateSelected')).toBeHidden();
        await expect(page.locator('#btnGroupMarked')).toBeHidden();

        const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
        expect(state.mode).toBe('select');
        expect(state.activeEntryId).toBe('build-hard');
        expect(state.objectCount).toBe(0);
        expect(missingPreviewAssets).toEqual([]);
        expect(errors).toHaveLength(0);
    });

    test('Kategorien filtern Baukarten ohne den Platzierungsmodus zu aktivieren', async ({ page }) => {
        await loadEditorPage(page);

        await page.locator('#dockCategoryTabs [data-category-id="glb"]').click();

        const state = await getEditorState(page);
        expect(state).toMatchObject({
            mode: 'select',
            currentTool: 'select',
            activeCategoryId: 'glb',
            objectCount: 0,
            recentEntryIds: [],
        });
        await expect(page.locator('#dockCards [data-entry-id="glb-pm-abm-altar01-art"]')).toBeVisible();
        await clickCanvas(page, 0.35);
        await expect.poll(() => getEditorState(page).then((value) => value.objectCount)).toBe(0);
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

        expect(errors).toHaveLength(0);
    });

    test('GLB-Katalog laedt ein Modell bei Bedarf und exportiert seine Platzierung', async ({ page }) => {
        const errors = collectErrors(page);
        await loadEditorPage(page);

        await activateDockEntry(page, 'glb', 'glb-pm-abm-altar01-art');
        await clickCanvas(page, 0.5);
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.getState().objects.at(-1)?.type)).toBe('glb');
        await expect.poll(() => page.evaluate(() => (
            window.CURVIOS_EDITOR.core.objectsContainer.children.at(-1)?.userData?.isEditorPlaceholder
        )), { timeout: 30_000 }).toBe(false);

        await openFileMenu(page);
        await page.locator('#btnExport').click();
        const exported = JSON.parse(await page.locator('#jsonOutput').inputValue());
        expect(exported.glbModels).toHaveLength(1);
        expect(exported.glbModels[0]).toMatchObject({
            id: expect.stringContaining('pm-abm/Altar01_Art#'),
            url: 'assets/models/downloaded_cc0/pm-abm/Altar01_Art.glb',
            targetSize: 14,
        });
        expect(exported.glbColliderMode).toBe('fallbackOnly');
        expect(errors).toHaveLength(0);
    });

    test('T65d: Save/Export/Playtest bleiben ueber den Dock-Flow stabil nutzbar', async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        // Im Desktop gibt es keinen Entwicklungsserver: die Karte geht ueber den
        // Hauptprozess auf die Platte. Der Test prueft deshalb echte Dateien.
        const desktopStore = IS_BROWSER_COMPAT ? null : await useIsolatedDesktopMapStore(testInfo);
        await loadEditorPage(page);

        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.34);
        await activateDockEntry(page, 'flow', 'flow-spawn-player');
        await clickCanvas(page, 0.52);
        await activateDockEntry(page, 'flow', 'flow-spawn-bot');
        await clickCanvas(page, 0.72);

        await openFileMenu(page);
        await page.locator('#btnExport').click();
        const exportedJson = await page.locator('#jsonOutput').inputValue();
        expect(exportedJson.length).toBeGreaterThan(20);

        const mapName = `V65 Smoke ${Date.now()}`;
        let saveRequestBody = null;
        let folderOpenRequests = 0;
        if (desktopStore) {
            // Eine gleichnamige Karte liegt schon im Speicher, damit der Dialog
            // den Konfliktfall zeigt.
            await writeFile(
                path.join(desktopStore.mapsDirectory, 'editor_v65_existing.runtime.json'),
                JSON.stringify({ name: mapName }),
                'utf8'
            );
        } else {
            await page.route(`**${EDITOR_API_ROUTES.LIST_MAPS_DISK}`, (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, maps: [{ mapName, mapKey: 'editor_v65_existing' }] }),
            }));
            await page.route(`**${EDITOR_API_ROUTES.OPEN_MAPS_FOLDER}`, (route) => {
                folderOpenRequests += 1;
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: true, folderPath: EDITOR_DATA_PATHS.MAPS_DIR }),
                });
            });
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
        }

        await page.locator('#btnSaveToGame').click();
        await expect(page.locator('#exportDialog')).toHaveAttribute('open', '');
        await page.locator('#exportMapName').fill(mapName);
        await expect(page.locator('#exportTarget')).toHaveValue('install');
        await expect(page.locator('#exportConflictNotice')).toContainText('wird aktualisiert');
        await page.locator('#exportConflictMode').selectOption('copy');
        await expect(page.locator('#exportConflictNotice')).toContainText('bleibt erhalten');
        await expect(page.locator('#btnExportConfirm')).toBeEnabled();
        await page.locator('#btnExportConfirm').click();
        if (desktopStore) {
            // Die Kopie bekommt eine eigene Kennung, die gleichnamige Karte
            // bleibt unberuehrt - zusammen der Beleg fuer "als Kopie speichern".
            const savedKey = `editor_${mapName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            await expect.poll(async () => {
                try {
                    return JSON.parse(await readFile(
                        path.join(desktopStore.mapsDirectory, `${savedKey}.runtime.json`), 'utf8'
                    )).name;
                } catch { return null; }
            }, { timeout: 15_000 }).toBe(mapName);
            const runtimeMap = JSON.parse(await readFile(
                path.join(desktopStore.mapsDirectory, `${savedKey}.runtime.json`), 'utf8'
            ));
            const editorDocument = JSON.parse(await readFile(
                path.join(desktopStore.mapsDirectory, `${savedKey}.editor.json`), 'utf8'
            ));
            expect(JSON.parse(await readFile(
                path.join(desktopStore.mapsDirectory, 'editor_v65_existing.runtime.json'), 'utf8'
            ))).toEqual({ name: mapName });
            expect(editorDocument.contractVersion).toBe('curvios-editor-document.v1');
            expect(editorDocument.authoring?.layerState?.layers?.geometry).toBeTruthy();
            expect(JSON.stringify(runtimeMap)).not.toContain('workspaceMetadata');
        } else {
            await expect.poll(() => saveRequestBody?.mapName || null).toBe(mapName);
            expect(saveRequestBody?.saveAsCopy).toBe(true);
            expect(saveRequestBody?.editorDocument?.contractVersion).toBe('curvios-editor-document.v1');
            expect(saveRequestBody?.editorDocument?.authoring?.layerState?.layers?.geometry).toBeTruthy();
            expect(saveRequestBody?.jsonText).not.toContain('workspaceMetadata');
        }
        await expect(page.locator('#workspaceStatusMessage')).toContainText(`Map neu gespeichert: ${mapName}`);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        await expect(page.locator('#exportResultView')).toBeVisible();
        if (desktopStore) {
            // Das Spielfenster liest die Kartenliste neu, sobald es den Fokus bekommt.
            await expect(page.locator('#exportResultView')).toContainText('beim nächsten Öffnen der Kartenauswahl');
        }
        await expect(page.locator('#btnExportOpenFolder')).toBeVisible();
        await expect(page.locator('#btnExportCopyKey')).toBeVisible();
        await page.locator('#btnExportOpenFolder').click();
        await expect.poll(() => (desktopStore ? desktopStore.countOpenedFolders() : folderOpenRequests)).toBe(1);
        await page.locator('#btnExportClose').click();

        await page.locator('#playtestMenu > summary').click();
        await page.locator('#selPlaytestSession').selectOption('splitscreen');
        await expect(page.locator('#playtestSettingsSummary')).toHaveText('3D · Geteilter Bildschirm');
        const popupPromise = page.waitForEvent('popup');
        await page.locator('#btnPlaytest').click();
        const popup = await popupPromise;
        await popup.waitForURL(/index\.html\?/, { timeout: 15_000 });
        expect(popup.url()).toContain('playtest=1');
        expect(popup.url()).toContain('planar=0');
        expect(popup.url()).toContain('session=splitscreen');
        await expect(popup.locator('#playtest-return-to-editor')).toBeVisible();
        await popup.close();

        const evidenceScreenshotPath = String(process.env.V65_EVIDENCE_SCREENSHOT || '').trim();
        if (evidenceScreenshotPath) {
            await page.screenshot({ path: evidenceScreenshotPath, fullPage: true });
        }

        expect(errors).toHaveLength(0);
    });

    test('Exportdialog blockiert Fehler und laedt den vollstaendigen Editor-Arbeitsstand herunter', async ({ page }) => {
        await loadEditorPage(page);

        await page.locator('#btnSaveToGame').click();
        await expect(page.locator('#exportValidationSummary')).toContainText('Fehler');
        await expect(page.locator('#btnExportConfirm')).toBeDisabled();
        await page.locator('#btnExportCancel').click();

        await activateDockEntry(page, 'flow', 'flow-spawn-player');
        await clickCanvas(page, 0.3);

        await openFileMenu(page);
        await page.locator('#btnDownloadJson').click();
        await page.locator('#exportMapName').fill('Meine Test Map');
        await expect(page.locator('#exportTarget')).toHaveValue('project');
        await expect(page.locator('#exportConflictModeRow')).toBeHidden();
        await expect(page.locator('#exportValidationSummary')).toContainText('1 Warnung');
        await expect(page.locator('#exportWarningAcknowledgeRow')).toBeHidden();
        await expect(page.locator('#btnExportConfirm')).toBeEnabled();
        let documentValue;
        if (process.env.PW_RUN_PROFILE === 'browser-compat') {
            const downloadPromise = page.waitForEvent('download');
            await page.locator('#btnExportConfirm').click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toBe('meine-test-map.curvios-map.json');
            const stream = await download.createReadStream();
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            documentValue = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } else {
            await page.locator('#btnExportConfirm').click();
            await expect(page.locator('#exportResultView')).toBeVisible();
            const savedPath = await page.locator('#exportResultPaths').textContent();
            expect(path.basename(savedPath)).toBe('meine-test-map.curvios-map.json');
            documentValue = JSON.parse(await readFile(savedPath, 'utf8'));
        }
        expect(documentValue.contractVersion).toBe('curvios-editor-document.v1');
        expect(documentValue.authoring?.layerState?.layers?.geometry).toBeTruthy();
        expect(documentValue.map?.playerSpawn?.id).toBeTruthy();
        await expect(page.locator('#exportResultView')).toBeVisible();
    });
});

test.describe('Editor Workspace und Desktop-Layout', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('kompaktes Dock sitzt rechts und Seitenleistenbereiche ueberlappen nicht', async ({ page }) => {
        await loadEditorPage(page);

        const layout = await page.evaluate(() => {
            const dockRect = document.querySelector('#buildDock').getBoundingClientRect();
            const canvasRect = document.querySelector('.canvasShell').getBoundingClientRect();
            const panel = document.querySelector('[data-editor-tab-panel="objects"]');
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

        expect(layout.topGap).toBeGreaterThanOrEqual(65);
        expect(layout.topGap).toBeLessThanOrEqual(67);
        for (const gap of [layout.rightGap, layout.bottomGap]) {
            expect(gap).toBeGreaterThanOrEqual(12);
            expect(gap).toBeLessThanOrEqual(14);
        }
        expect(layout.dockHeight).toBeGreaterThan(layout.dockWidth);
        expect(layout.canvasWidth - layout.dockWidth).toBeGreaterThan(500);
        expect(layout.overlaps).toBeFalsy();
        await expect(page.locator('.editorTopbar')).toBeVisible();
        await expect(page.locator('.inspectorTabs [role="tab"]')).toHaveCount(5);
        await expect(page.locator('#dockPrefabSection')).not.toHaveAttribute('open', '');
        await expect(page.locator('#validationDetails')).not.toHaveAttribute('open', '');
        await expect(page.locator('#btnSaveToGame')).toHaveText('Im Spiel speichern...');
        await openFileMenu(page);
        await expect(page.locator('#btnDownloadJson')).toHaveText('Projektdatei exportieren...');
        await page.locator('#fileMenu > summary').click();

        await page.locator('[data-editor-tab="objects"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-editor-tab="layers"]')).toBeFocused();
        await expect(page.locator('#editorPanelLayers')).toBeVisible();

        await expect(page.locator('#editorHelp')).toBeHidden();
        await page.locator('#btnToggleHelp').click();
        await expect(page.locator('#editorHelp')).toBeVisible();
        const storedLayout = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || '{}'), EDITOR_LAYOUT_STORAGE_KEY);
        expect(storedLayout).toMatchObject({ helpSeen: true, helpVisible: true, activePanel: 'layers' });

        await activateInspectorTab(page, 'validation');
        await expect(page.locator('#validationDetails')).toHaveAttribute('open', '');

        await page.locator('#btnDockCollapse').click();
        await expect(page.locator('#buildDock')).toHaveClass(/is-collapsed/);
        await expect(page.locator('#buildDock')).toBeVisible();
        await expect(page.locator('#dockCards')).toBeHidden();
        await expect(page.locator('#btnDockCollapse')).toHaveText('Ausklappen');
        await expect(page.locator('#btnToggleDockFromScene')).toHaveText('Baukarten zeigen');
        await page.locator('#btnDockCollapse').click();
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-collapsed/);
        await expect(page.locator('#dockCards')).toBeVisible();

        await page.locator('#btnToggleDockFromScene').click();
        await expect(page.locator('#buildDock')).toHaveClass(/is-collapsed/);
        await page.locator('#btnToggleDockFromScene').click();
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-collapsed/);
        await expect(page.locator('#buildDock')).toBeVisible();

        await page.locator('#btnDockDetailToggle').click();
        await expect(page.locator('#buildDock')).toHaveClass(/is-detailed/);
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-compact-view/);
        await expect(page.locator('#dockCards [data-entry-id="build-hard"] .buildCardDescription')).toBeVisible();

        await page.locator('#btnDockViewToggle').click();
        await expect(page.locator('#buildDock')).toHaveClass(/is-compact-view/);
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-detailed/);
        await expect(page.locator('#dockCards [data-entry-id="build-hard"] .buildCardDescription')).toBeHidden();
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

        const spatiallyIndexed = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const object = editor.ui.selectedObject;
            return editor.mapManager.queryObjectsNear(object.position, 0).includes(object);
        });
        expect(spatiallyIndexed).toBe(true);

        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        await expect.poll(() => page.evaluate(() => window.localStorage.getItem('curviosclash.editor.autosave.v1'))).not.toBeNull();
        await expect(page.locator('#selectionTabBadge')).toBeVisible();
        await activateInspectorTab(page, 'selection');
        await expect(page.locator('#propPanel')).toBeVisible();
        await expect.poll(() => page.locator('#propPanel').evaluate((element) => element.parentElement?.id)).toBe('editorPanelSelection');
        await expect(page.locator('#propObjectType')).toHaveValue('Hartblock');
        await expect(page.getByLabel('X-Position')).toBeVisible();
        await expect(page.getByLabel('Rotation Y (Grad)')).toBeVisible();
        await expect(page.locator('#btnDuplicateSelected')).toBeEnabled();

        await page.locator('#propX').fill('125');
        await page.locator('#propX').press('Tab');
        await page.locator('#propX').fill('0');
        await page.locator('#propX').press('Tab');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.ui.selectedObject.position.x)).toBe(0);

        const originalWidth = await page.locator('#propWidth').inputValue();
        await page.locator('#propWidth').fill('-10');
        await page.locator('#propWidth').press('Tab');
        await expect(page.locator('#propWidth')).toHaveValue(originalWidth);
        await activateInspectorTab(page, 'map');
        await page.locator('#numGrid').fill('0');
        await page.locator('#numGrid').press('Tab');
        await expect(page.locator('#numGrid')).toHaveValue('50');
        await page.locator('#numArenaW').fill('-20');
        await page.locator('#numArenaW').press('Tab');
        await expect(page.locator('#numArenaW')).toHaveValue('2800');
        // Die Hoehen-Ebene sitzt seit ae2bec6f im Reiter "Ebenen", die
        // Arenamasse bleiben im Reiter "Map".
        await activateInspectorTab(page, 'layers');
        await page.locator('#numYLayer').fill('900');
        await page.locator('#numYLayer').press('Tab');
        await activateInspectorTab(page, 'map');
        await page.locator('#numArenaH').fill('700');
        await page.locator('#numArenaH').press('Tab');
        await expect(page.locator('#numYLayer')).toHaveValue('700');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.yGridHelper.position.y)).toBe(700);
        await activateInspectorTab(page, 'selection');

        await page.locator('#propX').fill('1300');
        await page.locator('#propX').press('Tab');
        await page.locator('#propWidth').fill('500');
        await page.locator('#propWidth').press('Tab');
        await expect(page.locator('#validationList')).toContainText('Objekt(e) außerhalb der Arena');
        await activateInspectorTab(page, 'objects');

        await page.locator('#btnToggleSelectedLock').click();
        await expect(page.locator('#btnDelSelected')).toBeDisabled();
        await page.keyboard.press('Delete');
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await page.locator('#btnToggleSelectedLock').click();
        await expect(page.locator('#btnDelSelected')).toBeEnabled();

        await page.locator('#btnDuplicateSelected').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(2);
        await expect(page.locator('#btnUndo')).toBeEnabled();
        await expect(page.locator('#btnDuplicateSelected')).toBeVisible();
        await expect(page.locator('#btnGroupMarked')).toBeHidden();

        const marked = page.locator('#objectList input[type="checkbox"]');
        await marked.nth(0).check();
        await marked.nth(1).check();
        await expect(page.locator('#btnGroupMarked')).toBeVisible();
        await expect(page.locator('#btnGroupMarked')).toBeEnabled();
        await page.locator('#btnGroupMarked').click();
        const groupIds = await page.evaluate(() => Array.from(window.CURVIOS_EDITOR.core.objectsContainer.children)
            .map((object) => object.userData?.groupId || ''));
        expect(groupIds[0]).toBeTruthy();
        expect(new Set(groupIds).size).toBe(1);

        await marked.nth(0).uncheck();
        await expect(marked.nth(0)).not.toBeChecked();
        await expect(marked.nth(1)).not.toBeChecked();
        await marked.nth(0).check();
        await expect(marked.nth(0)).toBeChecked();
        await expect(marked.nth(1)).toBeChecked();

        await page.locator('#btnTransformMarked').click();
        await page.locator('[data-transform-fields] [name=dx]').fill('100');
        await page.locator('[data-transform-fields] [name=dz]').fill('50');
        await page.locator('[data-transform-fields] [name=rotationDegrees]').fill('90');
        await page.locator('#btnEditorModalConfirm').click();
        const transformed = await page.evaluate(() => Array.from(window.CURVIOS_EDITOR.core.objectsContainer.children)
            .map((object) => ({ x: Math.round(object.position.x), z: Math.round(object.position.z) })));
        expect(transformed.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))).toBeTruthy();
    });

    test('Gruppentransformation skaliert Abstaende, aber keine nicht skalierbaren Pickups', async ({ page }) => {
        await loadEditorPage(page);
        const ids = await page.evaluate(() => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            const block = manager.createMesh('hard', null, -100, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100, groupId: 'mixed' });
            const item = manager.createMesh('item', 'item_rocket', 100, 100, 0, 0, { groupId: 'mixed' });
            return { block: block.userData.id, item: item.userData.id };
        });
        await activateInspectorTab(page, 'objects');
        await page.getByLabel(`${ids.block} für Mehrfachaktion markieren`).check();
        await page.locator('#btnTransformMarked').click();
        await page.locator('[data-transform-fields] [name=scale]').fill('2');
        await page.locator('#btnEditorModalConfirm').click();

        const transformed = await page.evaluate(({ block, item }) => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            const blockObject = manager.getObjectById(block);
            const itemObject = manager.getObjectById(item);
            return {
                blockScale: blockObject.scale.toArray(),
                itemScale: itemObject.scale.toArray(),
                positions: [blockObject.position.x, itemObject.position.x],
            };
        }, ids);
        expect(transformed.blockScale).toEqual([200, 200, 200]);
        expect(transformed.itemScale).toEqual([30, 80, 30]);
        expect(transformed.positions).toEqual([-200, 200]);
    });

    test('Undo und Redo gleichen den Dirty-State mit dem gespeicherten Stand ab', async ({ page }) => {
        await loadEditorPage(page);
        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.4);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');

        await page.locator('#btnUndo').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(0);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');

        await page.locator('#btnRedo').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
    });

    test('Aktive Ebene folgt History, Autosave und realer Platzierung', async ({ page }) => {
        await page.clock.install();
        await loadEditorPage(page);
        await activateInspectorTab(page, 'layers');

        const geometryLayer = page.locator('#layerList [data-layer-id="geometry"]');
        const gameplayLayer = page.locator('#layerList [data-layer-id="gameplay"]');
        const captureState = () => page.evaluate(() => ({
            layerState: window.CURVIOS_EDITOR.ui.captureLayerState(),
            history: window.CURVIOS_EDITOR.ui.commandHistory.getState(),
            autosave: JSON.parse(window.localStorage.getItem('curviosclash.editor.autosave.v1') || 'null'),
        }));

        await expect(geometryLayer).toHaveClass(/active/);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        expect(await captureState()).toMatchObject({
            layerState: { activeLayerId: 'geometry' },
            history: { undoCount: 0, redoCount: 0 },
            autosave: null,
        });

        await geometryLayer.getByRole('button', { name: 'Geometrie', exact: true }).click();
        await page.clock.fastForward(700);
        await expect(geometryLayer).toHaveClass(/active/);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        expect(await captureState()).toMatchObject({
            layerState: { activeLayerId: 'geometry' },
            history: { undoCount: 0, redoCount: 0 },
            autosave: null,
        });

        await gameplayLayer.getByRole('button', { name: 'Gameplay', exact: true }).click();
        await expect(gameplayLayer).toHaveClass(/active/);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        expect(await captureState()).toMatchObject({
            layerState: { activeLayerId: 'gameplay' },
            history: { undoCount: 1, redoCount: 0 },
        });
        await page.clock.fastForward(700);
        expect((await captureState()).autosave?.layerState?.activeLayerId).toBe('gameplay');

        await gameplayLayer.getByRole('button', { name: 'Gameplay', exact: true }).click();
        expect((await captureState()).history).toMatchObject({ undoCount: 1, redoCount: 0 });

        await page.locator('#btnUndo').click();
        await expect(geometryLayer).toHaveClass(/active/);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        expect(await captureState()).toMatchObject({
            layerState: { activeLayerId: 'geometry' },
            history: { undoCount: 0, redoCount: 1 },
            autosave: null,
        });

        await geometryLayer.getByRole('button', { name: 'Geometrie', exact: true }).click();
        await expect(page.locator('#btnRedo')).toBeEnabled();
        expect((await captureState()).history).toMatchObject({ undoCount: 0, redoCount: 1 });

        await page.locator('#btnRedo').click();
        await expect(gameplayLayer).toHaveClass(/active/);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        expect(await captureState()).toMatchObject({
            layerState: { activeLayerId: 'gameplay' },
            history: { undoCount: 1, redoCount: 0 },
        });

        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.4);
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => (
            window.CURVIOS_EDITOR.ui.selectedObject?.userData?.editorLayerId
        ))).toBe('gameplay');
    });

    test('Playtest-Rueckkehr behaelt den ungespeicherten Zustand', async ({ page }) => {
        await loadEditorPage(page);
        await activateDockEntry(page, 'flow', 'flow-spawn-player');
        await clickCanvas(page, 0.4);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.ui.capturePlaytestReturnState())).toBe(true);

        // Der Arbeitsstand liegt jetzt im Speicher des Browsers. Im Produkt
        // kehrt das Playtest-Fenster selbst zum Editor zurueck; hier wuerde die
        // Verlassen-Sperre des dreckigen Editorfensters die Navigation in
        // Electron still abbrechen, deshalb wird sie vorher geloest. Der
        // wiederhergestellte Stand bleibt trotzdem "ungespeichert", weil das
        // im aufgezeichneten Zustand steht.
        await page.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved?.());
        await page.goto(resolveAppUrl(page, `${EDITOR_VIEW_PATHS.MAP_EDITOR}?returnFromPlaytest=1`), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.CURVIOS_EDITOR?.getState, null, { timeout: 30_000 });
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);
        await expect(page.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PLAYTEST_RETURN_STORAGE_KEY)).toBeNull();
        expect(new URL(page.url()).searchParams.has('returnFromPlaytest')).toBe(false);
    });

    test('S skaliert ausgewaehlte Map-Objekte und exportiert die neue Groesse', async ({ page }) => {
        await loadEditorPage(page);

        const ids = await page.evaluate(() => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            const block = manager.createMesh('hard', null, 0, 100, 0, 100, {
                sizeX: 100,
                sizeY: 100,
                sizeZ: 100,
            });
            const portal = manager.createMesh('portal', null, 300, 100, 0, 80);
            window.CURVIOS_EDITOR.ui.selectObject(block);
            return { block: block.userData.id, portal: portal.userData.id };
        });

        await expect(page.locator('[data-transform-mode="translate"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-transform-mode="scale"]')).toBeEnabled();
        await page.keyboard.press('s');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.transformControl.mode)).toBe('scale');
        await expect(page.locator('[data-transform-mode="scale"]')).toHaveAttribute('aria-pressed', 'true');

        await page.evaluate((blockId) => {
            const editor = window.CURVIOS_EDITOR;
            const control = editor.core.transformControl;
            const block = editor.mapManager.getObjectById(blockId);
            control.dispatchEvent({ type: 'dragging-changed', value: true });
            control.axis = 'X';
            block.scale.x = 240;
            control.dispatchEvent({ type: 'objectChange' });
            control.dispatchEvent({ type: 'dragging-changed', value: false });
            control.axis = null;
        }, ids.block);
        await expect(page.locator('#propWidth')).toHaveValue('240');

        await page.evaluate((portalId) => {
            const editor = window.CURVIOS_EDITOR;
            editor.ui.selectObject(editor.mapManager.getObjectById(portalId));
        }, ids.portal);
        await page.keyboard.press('s');
        const result = await page.evaluate(({ blockId, portalId }) => {
            const editor = window.CURVIOS_EDITOR;
            const control = editor.core.transformControl;
            const portal = editor.mapManager.getObjectById(portalId);
            control.dispatchEvent({ type: 'dragging-changed', value: true });
            control.axis = 'Y';
            portal.scale.y = 120;
            control.dispatchEvent({ type: 'objectChange' });
            control.dispatchEvent({ type: 'dragging-changed', value: false });
            control.axis = null;

            const exported = JSON.parse(editor.mapManager.generateJSONExport({ width: 2800, depth: 2400, height: 950 }));
            return {
                block: exported.hardBlocks.find((entry) => entry.id === blockId),
                portal: exported.portals.find((entry) => entry.id === portalId),
                portalScale: portal.scale.toArray(),
            };
        }, { blockId: ids.block, portalId: ids.portal });

        expect(result.block).toMatchObject({ width: 240, height: 100, depth: 100 });
        expect(result.portal.radius).toBe(120);
        expect(result.portalScale).toEqual([120, 120, 120]);
    });

    test('Transform-Raster, Checkpoint-Radius und nicht skalierbare Objekte bleiben eindeutig', async ({ page }) => {
        await loadEditorPage(page);
        await activateInspectorTab(page, 'map');

        await page.locator('#chkSnap').check();
        await page.locator('#numGrid').fill('25');
        await page.locator('#numGrid').press('Tab');
        await page.locator('#numRotationSnap').fill('30');
        await page.locator('#numRotationSnap').press('Tab');
        await page.locator('#numScaleSnap').fill('0.5');
        await page.locator('#numScaleSnap').press('Tab');

        const snaps = await page.evaluate(() => {
            const control = window.CURVIOS_EDITOR.core.transformControl;
            return {
                translation: control.translationSnap,
                rotation: control.rotationSnap,
                scale: control.scaleSnap,
            };
        });
        expect(snaps.translation).toBe(25);
        expect(snaps.rotation).toBeCloseTo(Math.PI / 6, 8);
        expect(snaps.scale).toBe(0.5);
        await activateInspectorTab(page, 'objects');

        const ids = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const checkpoint = editor.mapManager.createMesh('checkpoint', 'gate', 0, 250, 0, 0);
            const item = editor.mapManager.createMesh('item', 'item_rocket', 300, 100, 0, 50);
            editor.ui.selectObject(checkpoint);
            return { checkpoint: checkpoint.userData.id, item: item.userData.id };
        });

        await activateInspectorTab(page, 'selection');
        await expect(page.locator('#propSizeLabel')).toHaveText('Größe / Radius (gleichmäßig)');
        await expect(page.locator('#propSize')).toHaveValue('5.5');
        await page.locator('#propSize').fill('9');
        await page.locator('#propSize').press('Tab');
        const checkpoint = await page.evaluate((id) => {
            const editor = window.CURVIOS_EDITOR;
            const object = editor.mapManager.getObjectById(id);
            const exported = JSON.parse(editor.mapManager.generateJSONExport({ width: 2800, depth: 2400, height: 950 }));
            return {
                radius: exported.parcours.checkpoints.find((entry) => entry.id === id)?.radius,
                scale: object.scale.toArray(),
            };
        }, ids.checkpoint);
        expect(checkpoint.radius).toBe(9);
        expect(checkpoint.scale).toEqual([126, 126, 126]);

        await page.evaluate((id) => {
            const editor = window.CURVIOS_EDITOR;
            editor.ui.selectObject(editor.mapManager.getObjectById(id));
        }, ids.item);
        await expect(page.locator('[data-transform-mode="scale"]')).toBeDisabled();
        await page.keyboard.press('s');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.transformControl.mode)).toBe('translate');
    });

    test('Skalierungs-Gizmo reagiert auf einen echten Mauszug', async ({ page }) => {
        await loadEditorPage(page);

        await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const block = editor.mapManager.createMesh('hard', null, 0, 100, 0, 100, {
                sizeX: 100,
                sizeY: 100,
                sizeZ: 100,
            });
            editor.ui.selectObject(block);
            editor.core.focusObject(block);
        });
        await page.locator('[data-transform-mode="scale"]').click();
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.transformControl.mode)).toBe('scale');

        const drag = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const control = editor.core.transformControl;
            const renderer = editor.core.renderer;
            const camera = editor.core.camera;
            renderer.render(editor.core.scene, camera);
            const helper = control.getHelper();
            helper.updateMatrixWorld(true);

            const center = control.worldPosition.clone().project(camera);
            const xHandles = control._gizmo.gizmo.scale.children.filter((child) => child.name === 'X');
            const handlePoints = xHandles.map((handle) => {
                handle.geometry.computeBoundingSphere();
                return handle.geometry.boundingSphere.center.clone().applyMatrix4(handle.matrixWorld).project(camera);
            });
            const end = handlePoints.reduce((farthest, point) => (
                point.distanceToSquared(center) > farthest.distanceToSquared(center) ? point : farthest
            ));
            const rect = renderer.domElement.getBoundingClientRect();
            const project = (point) => ({
                x: rect.left + ((point.x + 1) * rect.width / 2),
                y: rect.top + ((1 - point.y) * rect.height / 2),
            });
            const start = project(end);
            const origin = project(center);
            const dx = start.x - origin.x;
            const dy = start.y - origin.y;
            const length = Math.hypot(dx, dy) || 1;
            return {
                start,
                end: {
                    x: start.x + (dx / length) * 70,
                    y: start.y + (dy / length) * 70,
                },
            };
        });

        await page.mouse.move(drag.start.x, drag.start.y);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(drag.end.x, drag.end.y, { steps: 10 });
        await page.mouse.up({ button: 'left' });

        const width = await page.locator('#propWidth').inputValue();
        expect(Number(width)).toBeGreaterThan(100);
        const exportedWidth = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const id = editor.ui.selectedObject.userData.id;
            const exported = JSON.parse(editor.mapManager.generateJSONExport({ width: 2800, depth: 2400, height: 950 }));
            return exported.hardBlocks.find((entry) => entry.id === id)?.width;
        });
        expect(exportedWidth).toBeGreaterThan(100);
    });

    test('Katalogsuche und sicherer Neue-Map-Dialog funktionieren ohne Browser-Popups', async ({ page }) => {
        await loadEditorPage(page);

        await page.locator('#dockSearch').fill('Rakete');
        await expect(page.locator('#dockCards [data-entry-id="pickups-rocket"]')).toBeVisible();
        await expect(page.locator('#dockCards [data-entry-id="pickups-rocket-turret"]')).toBeVisible();
        await expect(page.locator('#dockCards [data-entry-id="gameplay-rocket-turret"]')).toBeVisible();
        await expect(page.locator('#dockCards [data-entry-id]')).toHaveCount(3);

        await page.locator('#dockSearch').fill('');
        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.35, 0.24);
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);

        await openFileMenu(page);
        await page.locator('#btnNew').click();
        await expect(page.locator('#editorModalBackdrop')).toHaveClass(/is-open/);
        await expect(page.locator('#btnEditorModalConfirm')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#btnEditorModalCancel')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#editorModalBackdrop')).not.toHaveClass(/is-open/);
        await expect(page.locator('#btnNew')).toBeFocused();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(1);

        await page.locator('#btnNew').click();
        await page.locator('#btnEditorModalConfirm').click();
        await expect(page.locator('#objectList .objectRow')).toHaveCount(0);
    });

    test('offener Recovery-Stand bleibt bis zur Benutzerentscheidung unveraendert', async ({ page }) => {
        await page.clock.install();
        const recovery = {
            savedAt: '2026-07-16T10:00:00.000Z',
            json: JSON.stringify({
                schemaVersion: 4,
                arenaSize: { width: 2800, depth: 2400, height: 950 },
                hardBlocks: [{ id: 'recovery_block', x: 0, y: 100, z: 0, width: 200, depth: 200, height: 200, size: 100 }],
                playerSpawn: { id: 'recovery_spawn', x: -800, y: 500, z: 0 },
            }),
        };
        await loadEditorPage(page, { autosave: recovery });
        await expect(page.locator('#recoveryBanner')).toHaveClass(/is-visible/);

        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.35, 0.24);
        await page.clock.fastForward(700);
        const storedSavedAt = await page.evaluate((storageKey) => JSON.parse(window.localStorage.getItem(storageKey) || 'null')?.savedAt, EDITOR_AUTOSAVE_STORAGE_KEY);
        expect(storedSavedAt).toBe(recovery.savedAt);

        await page.locator('#btnRestoreAutosave').click();
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.hasObjectId('recovery_block'))).toBeTruthy();
    });

    test('fehlgeschlagener Import stellt den vorherigen Arbeitsstand wieder her', async ({ page }) => {
        await loadEditorPage(page);
        await activateDockEntry(page, 'build', 'build-hard');
        await clickCanvas(page, 0.35, 0.24);
        const before = await getEditorState(page);
        await openFileMenu(page);
        await page.locator('#btnExport').click();

        await page.evaluate(() => {
            const manager = window.CURVIOS_EDITOR.mapManager;
            const createMesh = manager.createMesh.bind(manager);
            let failNextCreate = true;
            manager.createMesh = (...args) => {
                if (failNextCreate) {
                    failNextCreate = false;
                    throw new Error('forced import failure');
                }
                return createMesh(...args);
            };
        });
        await page.locator('#btnImport').click();
        await page.locator('#btnEditorModalConfirm').click();
        await expect(page.locator('#workspaceStatusMessage')).toContainText('Map-Import fehlgeschlagen');
        const after = await getEditorState(page);
        expect(after.objectCount).toBe(before.objectCount);
        expect(after.objects.map((entry) => entry.id)).toEqual(before.objects.map((entry) => entry.id));
    });

    test('neu platzierter Parcours warnt live vor fehlendem Finish', async ({ page }) => {
        await loadEditorPage(page);
        await activateDockEntry(page, 'parcours', 'parcours-checkpoint-gate');
        await clickCanvas(page, 0.35, 0.24);
        await expect(page.locator('#validationList')).toContainText('Parcours-Finish fehlt');
    });

    test('Ebenen, Vorlagen, 3D-Vorschauen und orthografische Ansichten arbeiten zusammen', async ({ page }) => {
        await loadEditorPage(page);
        await expect(page.locator('#prefabList .prefabCard')).toHaveCount(4);
        await expect(page.locator('#dockPrefabSection')).not.toHaveAttribute('open', '');
        await page.locator('#dockPrefabSection > summary').click();
        await expect(page.locator('#dockPrefabSection')).toHaveAttribute('open', '');
        await page.locator('#prefabList .prefabCard').first().getByRole('button', { name: 'Einsetzen' }).click();
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(4);
        await activateInspectorTab(page, 'layers');
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

        await activateInspectorTab(page, 'map');
        await page.locator('#btnViewTop').click();
        const cameraState = await page.evaluate(() => ({
            mode: window.CURVIOS_EDITOR.core.viewMode,
            orthographic: window.CURVIOS_EDITOR.core.camera.isOrthographicCamera === true,
        }));
        expect(cameraState).toEqual({ mode: 'top', orthographic: true });

        await expect(page.locator('#assetStatusText')).toContainText(/geladen/i, { timeout: 20_000 });
        await expect.poll(() => page.locator('#dockCards .buildCardPreviewCanvas').count()).toBeGreaterThan(0);
        const previewHeight = await page.locator('#dockCards [data-entry-id="build-hard"] .buildCardPreview')
            .evaluate((element) => element.getBoundingClientRect().height);
        expect(previewHeight).toBeGreaterThanOrEqual(72);
    });

    test('ausgeblendete Tunnel entfernen auch ihre Hilfslinien', async ({ page }) => {
        await loadEditorPage(page);
        const tunnelId = await page.evaluate(() => {
            const Vector3 = window.CURVIOS_EDITOR.core.scene.position.constructor;
            const manager = window.CURVIOS_EDITOR.mapManager;
            const tunnel = manager.createMesh('tunnel', null, 0, 200, 0, 80, {
                pointA: new Vector3(-200, 200, 0),
                pointB: new Vector3(200, 200, 0),
                radius: 80,
            });
            return tunnel.userData.id;
        });
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.tunnelLines.children.length)).toBe(1);
        expect(tunnelId).toBeTruthy();
        await activateInspectorTab(page, 'layers');
        await page.locator('#layerList [data-layer-id="geometry"]')
            .getByRole('button', { name: 'Geometrie ausblenden' }).click();
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.core.tunnelLines.children.length)).toBe(0);
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
        await activateInspectorTab(page, 'selection');
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

        await page.evaluate((rightId) => {
            const editor = window.CURVIOS_EDITOR;
            editor.mapManager.getObjectById(rightId).userData.portalPartnerId = '';
            editor.ui.refreshWorkspace();
        }, ids[1]);
        await expect(page.locator('#validationList')).toContainText('Portal(e) ohne Partner');
        await page.evaluate(([leftId, rightId]) => {
            const editor = window.CURVIOS_EDITOR;
            editor.ui.setPortalPartner(editor.mapManager.getObjectById(leftId), rightId);
            editor.ui.refreshWorkspace();
        }, [ids[0], ids[1]]);

        await page.evaluate((finishId) => window.CURVIOS_EDITOR.ui.selectObject(window.CURVIOS_EDITOR.mapManager.getObjectById(finishId)), ids[4]);
        await activateInspectorTab(page, 'selection');
        await expect(page.locator('#propCheckpointOrder')).toBeDisabled();
        const finishOrder = await page.evaluate(([finishId, startId]) => {
            const editor = window.CURVIOS_EDITOR;
            const reordered = editor.ui.reorderCheckpointById(finishId, startId);
            const checkpoints = Array.from(editor.core.objectsContainer.children)
                .filter((object) => object.userData.type === 'checkpoint')
                .sort((left, right) => left.userData.checkpointOrder - right.userData.checkpointOrder);
            return { reordered, lastId: checkpoints.at(-1).userData.id };
        }, [ids[4], ids[2]]);
        expect(finishOrder).toEqual({ reordered: false, lastId: ids[4] });
    });

    test('Copy/Paste laesst bestehende Portalpaare intakt und fuegt ein ungepaartes Portal ein', async ({ page }) => {
        await loadEditorPage(page);
        const ids = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const left = editor.mapManager.createMesh('portal', 'portal_ring', -300, 300, 0, 120);
            const right = editor.mapManager.createMesh('portal', 'portal_ring', 300, 300, 0, 120);
            editor.ui.setPortalPartner(left, right.userData.id);
            editor.ui.selectObject(left);
            return { left: left.userData.id, right: right.userData.id };
        });

        await page.locator('#btnSaveToGame').focus();
        await page.keyboard.press('Control+c');
        expect(await page.evaluate(() => window.CURVIOS_EDITOR.ui.clipboardData.portalPartnerId)).toBe(ids.right);
        await page.keyboard.press('Control+v');

        const readRelations = () => page.evaluate(([leftId, rightId]) => {
            const editor = window.CURVIOS_EDITOR;
            const portals = editor.core.objectsContainer.children.filter((object) => object.userData.type === 'portal');
            const pasted = portals.find((object) => object.userData.id !== leftId && object.userData.id !== rightId);
            return {
                count: portals.length,
                leftPartner: editor.mapManager.getObjectById(leftId)?.userData.portalPartnerId || '',
                rightPartner: editor.mapManager.getObjectById(rightId)?.userData.portalPartnerId || '',
                pastedId: pasted?.userData.id || '',
                pastedPartner: pasted?.userData.portalPartnerId || '',
                pastedHasPartnerField: pasted
                    ? Object.prototype.hasOwnProperty.call(pasted.userData, 'portalPartnerId')
                    : false,
                clipboardPartner: editor.ui.clipboardData?.portalPartnerId || '',
                lineCount: editor.core.scene.getObjectByName('editor-relationships')?.children.length || 0,
            };
        }, [ids.left, ids.right]);

        await expect.poll(readRelations).toMatchObject({
            count: 3,
            leftPartner: ids.right,
            rightPartner: ids.left,
            pastedPartner: '',
            pastedHasPartnerField: true,
            clipboardPartner: ids.right,
            lineCount: 1,
        });
        await expect(page.locator('#validationList')).toContainText('1 Portal(e) ohne Partner');

        await page.keyboard.press('Control+z');
        await expect.poll(readRelations).toMatchObject({
            count: 2,
            leftPartner: ids.right,
            rightPartner: ids.left,
            pastedId: '',
            pastedHasPartnerField: false,
            clipboardPartner: ids.right,
            lineCount: 1,
        });

        await page.keyboard.press('Control+y');
        await expect.poll(readRelations).toMatchObject({
            count: 3,
            leftPartner: ids.right,
            rightPartner: ids.left,
            pastedPartner: '',
            pastedHasPartnerField: true,
            clipboardPartner: ids.right,
            lineCount: 1,
        });

        await page.keyboard.press('Control+v');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(4);
        const explicitlyUnpaired = await page.evaluate(([leftId, rightId]) => {
            const editor = window.CURVIOS_EDITOR;
            editor.mapManager.withSceneMutation(() => {
                editor.mapManager.removeObject(editor.mapManager.getObjectById(leftId));
                editor.mapManager.removeObject(editor.mapManager.getObjectById(rightId));
            });
            editor.ui.refreshWorkspace();
            const portals = editor.core.objectsContainer.children.filter((object) => object.userData.type === 'portal');
            return {
                count: portals.length,
                partners: portals.map((object) => object.userData.portalPartnerId),
                allHavePartnerField: portals.every((object) => (
                    Object.prototype.hasOwnProperty.call(object.userData, 'portalPartnerId')
                )),
                lineCount: editor.core.scene.getObjectByName('editor-relationships')?.children.length || 0,
            };
        }, [ids.left, ids.right]);
        expect(explicitlyUnpaired).toEqual({
            count: 2,
            partners: ['', ''],
            allHavePartnerField: true,
            lineCount: 0,
        });
    });

    test('Portal-Duplikate verwerfen externe Partner und remappen gemeinsam duplizierte Paare', async ({ page }) => {
        await loadEditorPage(page);
        const ids = await page.evaluate(() => {
            const editor = window.CURVIOS_EDITOR;
            const left = editor.mapManager.createMesh('portal', 'portal_ring', -300, 300, 0, 120);
            const right = editor.mapManager.createMesh('portal', 'portal_ring', 300, 300, 0, 120);
            editor.ui.setPortalPartner(left, right.userData.id);
            editor.ui.selectObject(left);
            return { left: left.userData.id, right: right.userData.id };
        });

        await page.locator('#btnDuplicateSelected').click();
        const singleDuplicate = await page.evaluate(([leftId, rightId]) => {
            const editor = window.CURVIOS_EDITOR;
            const portals = editor.core.objectsContainer.children.filter((object) => object.userData.type === 'portal');
            const duplicate = portals.find((object) => object.userData.id !== leftId && object.userData.id !== rightId);
            return {
                id: duplicate?.userData.id || '',
                partner: duplicate?.userData.portalPartnerId || '',
                hasPartnerField: duplicate
                    ? Object.prototype.hasOwnProperty.call(duplicate.userData, 'portalPartnerId')
                    : false,
                leftPartner: editor.mapManager.getObjectById(leftId)?.userData.portalPartnerId || '',
                rightPartner: editor.mapManager.getObjectById(rightId)?.userData.portalPartnerId || '',
            };
        }, [ids.left, ids.right]);
        expect(singleDuplicate).toMatchObject({
            partner: '',
            hasPartnerField: true,
            leftPartner: ids.right,
            rightPartner: ids.left,
        });
        expect(singleDuplicate.id).toBeTruthy();

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(2);
        await activateInspectorTab(page, 'objects');
        await page.getByLabel(`${ids.left} für Mehrfachaktion markieren`).check();
        await page.getByLabel(`${ids.right} für Mehrfachaktion markieren`).check();
        await page.locator('#btnDuplicateMarked').click();

        const pairedDuplicates = await page.evaluate(([leftId, rightId]) => {
            const editor = window.CURVIOS_EDITOR;
            const portals = editor.core.objectsContainer.children.filter((object) => object.userData.type === 'portal');
            const duplicates = portals.filter((object) => object.userData.id !== leftId && object.userData.id !== rightId);
            return {
                count: portals.length,
                duplicateIds: duplicates.map((object) => object.userData.id).sort(),
                duplicatePartnerIds: duplicates.map((object) => object.userData.portalPartnerId).sort(),
                leftPartner: editor.mapManager.getObjectById(leftId)?.userData.portalPartnerId || '',
                rightPartner: editor.mapManager.getObjectById(rightId)?.userData.portalPartnerId || '',
                lineCount: editor.core.scene.getObjectByName('editor-relationships')?.children.length || 0,
            };
        }, [ids.left, ids.right]);
        expect(pairedDuplicates).toMatchObject({
            count: 4,
            leftPartner: ids.right,
            rightPartner: ids.left,
            lineCount: 2,
        });
        expect(pairedDuplicates.duplicatePartnerIds).toEqual(pairedDuplicates.duplicateIds);
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

// Dieselbe Schwelle, an der EditorLayoutControls das Baudock einklappt.
const COMPACT_WORKSPACE_MEDIA_QUERY = '(max-width: 1200px)';

/**
 * Verkleinert die Arbeitsflaeche so weit, dass das kompakte Layout greift.
 * Im Browser genuegt die Playwright-Option; im Desktop ist die Seite ein
 * echtes Fenster, das diese Option gar nicht kennt - dort wird das Fenster
 * selbst kleiner gemacht. Kleiner als seine Mindestbreite geht es nicht, die
 * liegt aber unter der Kompakt-Schwelle.
 */
async function useCompactWorkspace(page, { width = 1024, height = 768 } = {}) {
    if (IS_BROWSER_COMPAT) {
        await page.setViewportSize({ width, height });
    } else {
        const browserWindowHandle = await currentElectronApp.browserWindow(page);
        await browserWindowHandle.evaluate((browserWindow, size) => {
            browserWindow.setContentSize(size.width, size.height);
        }, { width, height });
    }
    await expect.poll(
        () => page.evaluate((query) => window.matchMedia(query).matches, COMPACT_WORKSPACE_MEDIA_QUERY),
        { timeout: 15_000 }
    ).toBe(true);
}

test.describe('Editor Small Desktop Layout', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('kompaktes Startlayout haelt Topbar und Arbeitsflaeche zugaenglich', async ({ page }) => {
        await useCompactWorkspace(page);
        await loadEditorPage(page, { waitForDockVisible: false });

        await expect(page.locator('#buildDock')).toHaveClass(/is-collapsed/);
        await expect(page.locator('#dockCards')).toBeHidden();
        await expect(page.locator('#btnDockCollapse')).toHaveText('Ausklappen');
        await expect(page.locator('#btnToggleDockFromScene')).toHaveText('Baukarten zeigen');
        await expect(page.locator('#playtestSettingsSummary')).toHaveText('3D · Solo');

        const topbarMetrics = await page.evaluate(() => {
            const topbar = document.querySelector('.editorTopbar');
            const fileMenu = document.querySelector('#fileMenu');
            const topbarRect = topbar.getBoundingClientRect();
            const fileMenuRect = fileMenu.getBoundingClientRect();
            return {
                clientWidth: topbar.clientWidth,
                scrollWidth: topbar.scrollWidth,
                fileMenuRight: fileMenuRect.right,
                topbarRight: topbarRect.right,
            };
        });
        expect(topbarMetrics.scrollWidth).toBeLessThanOrEqual(topbarMetrics.clientWidth);
        expect(topbarMetrics.fileMenuRight).toBeLessThanOrEqual(topbarMetrics.topbarRight + 1);

        await page.locator('#playtestMenu > summary').click();
        await expect(page.locator('#selPlaytestMode')).toBeVisible();
        await page.locator('#selPlaytestMode').selectOption('planar');
        await page.locator('#selPlaytestSession').selectOption('splitscreen');
        await expect(page.locator('#playtestSettingsSummary')).toHaveText('Planar · Geteilter Bildschirm');

        await page.locator('#btnToggleDockFromScene').click();
        await expect(page.locator('#buildDock')).toBeVisible();
        await expect(page.locator('#buildDock')).not.toHaveClass(/is-collapsed/);
    });
});

test('Raketenwerfer: Editor properties, duplicate, undo and saved roundtrip', async ({ page }, testInfo) => {
    await loadEditorPage(page);
    await activateDockEntry(page, 'gameplay', 'gameplay-rocket-turret');
    await clickCanvas(page, 0.42);
    await activateInspectorTab(page, 'selection');
    await expect(page.locator('#propTurretFields')).toBeVisible();
    await expect(page.locator('#propTurretRange')).toHaveValue('90');
    await page.locator('#propTurretRange').fill('120');
    await page.locator('#propTurretRange').press('Tab');
    await page.locator('#propTurretCooldown').fill('4.5');
    await page.locator('#propTurretCooldown').press('Tab');
    await page.locator('#propTurretRocketType').selectOption('ROCKET_MEDIUM');
    await page.locator('#propTurretHp').fill('130');
    // Under load the queued workspace refresh lands between typing and blur; force it here.
    await page.evaluate(() => window.CURVIOS_EDITOR.ui.refreshLayerState());
    await page.locator('#propTurretHp').press('Tab');
    const result = await page.evaluate(() => {
        const { ui } = window.CURVIOS_EDITOR;
        const manager = ui.mapManager;
        const selected = ui.selectedObject;
        const id = selected.userData.id;
        const saved = manager.generateJSONExport(ui.getArenaSizeForExport());
        ui.executeHistoryMutation('Duplicate launcher', () => {
            const props = { ...selected.userData };
            delete props.id;
            delete props.editorObjectId;
            manager.createMesh('turret', 'rocket', selected.position.x + 50, selected.position.y, selected.position.z, 0, props);
        });
        const count = () => manager.core.objectsContainer.children.filter((entry) => entry.userData.type === 'turret').length;
        const duplicateCount = count();
        ui.commandHistory.undo();
        const undoCount = count();
        ui.commandHistory.redo();
        const redoCount = count();
        manager.importFromJSON(saved);
        const loaded = manager.getObjectById(id);
        ui.selectObject(loaded);
        return { duplicateCount, undoCount, redoCount, settings: JSON.parse(saved).staticTurrets[0],
            loadedHp: loaded.userData.maxHp, preview: !!ui.turretRangePreview };
    });
    expect(result.duplicateCount).toBe(2);
    expect(result.undoCount).toBe(1);
    expect(result.redoCount).toBe(2);
    expect(result.settings).toMatchObject({ rocketType: 'ROCKET_MEDIUM', maxHp: 130, cooldown: 4.5, destructible: true });
    expect(result.loadedHp).toBe(130);
    expect(result.preview).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('rocket-turret-editor.png') });
});
