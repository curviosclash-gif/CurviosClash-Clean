import { test, expect } from '@playwright/test';
import { getEditorBuildEntriesForCategory } from '../editor/js/ui/EditorBuildCatalog.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('sichtbare GLB-Karten laden echte 3D-Vorschauen nach', async ({ page }) => {
    const glbEntries = getEditorBuildEntriesForCategory('glb');
    const firstEntry = glbEntries[0];

    await page.goto(EDITOR_VIEW_PATHS.MAP_EDITOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CURVIOS_EDITOR?.getState);
    await expect(page.locator('#assetStatusText')).toContainText(/geladen/i, { timeout: 20_000 });

    const initial = await page.evaluate(({ entry, assetId }) => ({
        previewReady: window.CURVIOS_EDITOR.ui.isBuildPreviewReady(entry),
        assetState: window.CURVIOS_EDITOR.assetLoader.getLoadStatus(assetId).state,
    }), { entry: firstEntry, assetId: firstEntry.subType });
    expect(initial).toEqual({ previewReady: false, assetState: 'idle' });

    await page.locator('#dockCategoryTabs [data-category-id="glb"]').click();
    const firstCard = page.locator(`#dockCards [data-entry-id="${firstEntry.id}"]`);
    await expect(firstCard).toBeVisible();
    await expect.poll(() => page.evaluate((assetId) => (
        window.CURVIOS_EDITOR.assetLoader.getLoadStatus(assetId).state
    ), firstEntry.subType)).toBe('loaded');
    await expect(firstCard.locator('.buildCardPreviewCanvas')).toBeVisible();
    await expect.poll(() => firstCard.locator('.buildCardPreviewCanvas').evaluate((canvas) => {
        const context = canvas.getContext('2d');
        return context.getImageData(0, 0, 1, 1).data[3];
    })).toBeGreaterThan(0);
    const firstFrame = await firstCard.locator('.buildCardPreviewCanvas').evaluate((canvas) => canvas.toDataURL());
    await expect.poll(() => firstCard.locator('.buildCardPreviewCanvas').evaluate((canvas) => canvas.toDataURL()))
        .not.toBe(firstFrame);

    const loadedCount = await page.evaluate((assetIds) => assetIds.filter((assetId) => (
        window.CURVIOS_EDITOR.assetLoader.getLoadStatus(assetId).state === 'loaded'
    )).length, glbEntries.map((entry) => entry.subType));
    expect(loadedCount).toBeGreaterThan(0);
    expect(loadedCount).toBeLessThan(glbEntries.length);
});
