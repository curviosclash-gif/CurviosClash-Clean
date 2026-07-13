import { expect, test } from '@playwright/test';
import * as THREE from 'three';

import { EditorAssetLoader } from '../editor/js/EditorAssetLoader.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';

function createTestAssetObject() {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    ));
    return group;
}

async function resetVehicleLab(page) {
    await page.goto(EDITOR_VIEW_PATHS.VEHICLE_LAB, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        localStorage.removeItem('vehicle_lab_config');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#partsList .part-item')).toHaveCount(8, { timeout: 15000 });
    await expect(page.locator('#workshopStatusBar')).toBeVisible();
}

async function getVehicleLabPartCount(page) {
    return page.locator('#partsList .part-item').count();
}

test.describe('EditorAssetLoader', () => {
    test('soft timeout does not poison the cache when a late load succeeds', async () => {
        const loader = new EditorAssetLoader({ timeoutMs: 10, maxConcurrentLoads: 1 });
        loader.loader = {
            load(_url, onLoad) {
                setTimeout(() => onLoad(createTestAssetObject()), 25);
            }
        };

        const result = await loader._loadModelWithTimeout('demo_asset', '/demo.obj');
        expect(result.status).toBe('timeout');

        const timeoutClone = loader.getClone('demo_asset');
        expect(timeoutClone.userData.isEditorPlaceholder).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 40));

        const recoveredClone = loader.getClone('demo_asset');
        expect(loader.loadStatus.get('demo_asset')?.state).toBe('loaded');
        expect(recoveredClone.userData.isEditorPlaceholder).toBeFalsy();
    });

    test('loadAll respects maxConcurrentLoads', async () => {
        const loader = new EditorAssetLoader({ timeoutMs: 200, maxConcurrentLoads: 2 });
        loader.modelsToLoad = ['asset_a', 'asset_b', 'asset_c', 'asset_d'];
        loader.jetsToLoad = [];
        loader.portalModelsToLoad = [];
        loader.trailModelsToLoad = [];

        let activeLoads = 0;
        let peakLoads = 0;
        loader.loader = {
            load(_url, onLoad) {
                activeLoads += 1;
                peakLoads = Math.max(peakLoads, activeLoads);
                setTimeout(() => {
                    activeLoads -= 1;
                    onLoad(createTestAssetObject());
                }, 20);
            }
        };

        const summary = await loader.loadAll();
        expect(summary.loaded).toBe(4);
        expect(peakLoads).toBeLessThanOrEqual(2);
    });
});

test.describe('Vehicle Lab', () => {
    test('Ctrl+Z undoes only one step and Ctrl+Y reapplies it', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#btnAddPart').click();
        await expect(page.locator('#partsList .part-item')).toHaveCount(9);
        await expect(page.locator('#workshopHistoryState')).toHaveText('History 2/2');
        await page.locator('#btnAddPart').click();
        await expect(page.locator('#partsList .part-item')).toHaveCount(10);
        await expect(page.locator('#workshopHistoryState')).toHaveText('History 3/3');

        await page.keyboard.press('Control+z');
        await expect(page.locator('#partsList .part-item')).toHaveCount(9);
        await expect(page.locator('#workshopStatusMessage')).toContainText('Undo');
        await expect(page.locator('#btnRedo')).toBeEnabled();

        await page.keyboard.press('Control+y');
        await expect(page.locator('#partsList .part-item')).toHaveCount(10);
        await expect(page.locator('#workshopStatusMessage')).toContainText('Redo');
    });

    test('comparison panel and status bar reflect workshop state', async ({ page }) => {
        await resetVehicleLab(page);

        await expect(page.locator('#compareVehicleSelect')).toHaveValue('spaceship');
        await expect(page.locator('[data-metric="parts"] .compare-current')).toHaveText('8');
        await expect(page.locator('[data-metric="parts"] .compare-baseline')).toHaveText('6');
        await expect(page.locator('[data-metric="parts"] .compare-delta')).toHaveText('+2');
        await expect(page.locator('#workshopBlueprintState')).toContainText('Blueprint');

        await page.locator('#btnAddPart').click();
        await expect(page.locator('[data-metric="parts"] .compare-current')).toHaveText('9');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Bauteil');
    });

    test('deleting a part persists across reload', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#partsList .part-item').first().click();
        await page.locator('#btnDeletePart').click();
        await page.waitForTimeout(100);

        expect(await getVehicleLabPartCount(page)).toBe(7);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#partsList .part-item');

        expect(await getVehicleLabPartCount(page)).toBe(7);
    });

    test('nested child selection stays unique', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#partsList .part-item').first().click();
        await page.locator('#btnAddChild').click();
        await page.waitForTimeout(150);

        const selectedItems = await page.locator('#partsList .part-item.is-selected').evaluateAll((nodes) => (
            nodes.map((node) => node.textContent?.trim())
        ));

        expect(selectedItems).toEqual(['Child Part']);
        await expect(page.locator('#partTitle')).toHaveText('Edit: Child Part');
    });
});

test.describe('ModularVehicleMesh', () => {
    test('rebuild disposes transient compound geometries', async () => {
        const mesh = new ModularVehicleMesh({
            parts: [
                { name: 'Engine', geo: 'engine', size: [0.28, 0.28, 0.5] },
                { name: 'Shield', geo: 'forcefield', size: [0.06, 0.06, 1.2] },
                { name: 'Flame', geo: 'flame', size: [0.15, 0.01, 0.5] }
            ]
        });

        const trackedGeometries = Array.from(mesh.dynamicGeometries);
        expect(trackedGeometries.length).toBeGreaterThan(0);

        let disposeCalls = 0;
        trackedGeometries.forEach((geometry) => {
            const originalDispose = geometry.dispose.bind(geometry);
            geometry.dispose = () => {
                disposeCalls += 1;
                originalDispose();
            };
        });

        mesh.build();

        expect(disposeCalls).toBe(trackedGeometries.length);
        expect(mesh.dynamicGeometries.size).toBeGreaterThan(0);

        mesh.dispose();
    });
});

