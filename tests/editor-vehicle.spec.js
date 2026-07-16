import { expect, test } from '@playwright/test';

import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { waitForRenderFrames } from './helpers.js';

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

test.describe('Vehicle Lab', () => {
    test('vehicle selection is visible and loads a preset immediately', async ({ page }) => {
        await resetVehicleLab(page);

        await expect(page.locator('.vehicle-library')).toHaveAttribute('open', '');
        await expect(page.locator('#standardVehiclesList button', { hasText: 'Auswählen' })).toHaveCount(15);

        await page.locator('#presetSelect').selectOption('spaceship');
        await expect(page.locator('#partsList .part-item')).toHaveCount(6);
        await expect(page.locator('#shipLabel')).toHaveValue('Spaceship');
        await expect(page.locator('[data-camera-view="fit"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Fahrzeug geladen');
    });

    test('all game OBJ ships load as read-only references and can return to editing', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#presetSelect').selectOption('ship1');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Spielmodell geladen: Interceptor');
        await expect(page.locator('#referenceVehicleNotice')).toBeVisible();
        await expect(page.locator('#referenceVehicleNotice')).toContainText('schreibgeschützt');
        await expect(page.locator('#btnAddPart')).toBeDisabled();
        await expect(page.locator('#btnSaveToGameVehicle')).toBeDisabled();
        await expect(page.locator('#polyCountBadge')).not.toHaveText('Polygone: 0');

        await page.locator('#presetSelect').selectOption('jet_fighter');
        await expect(page.locator('#partsList .part-item')).toHaveCount(8);
        await expect(page.locator('#referenceVehicleNotice')).toBeHidden();
        await expect(page.locator('#btnAddPart')).toBeEnabled();
    });

    test('Ctrl+Z undoes only one step and Ctrl+Y reapplies it', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#btnAddPart').click();
        await expect(page.locator('#partsList .part-item')).toHaveCount(9);
        await expect(page.locator('#workshopHistoryState')).toHaveText('Verlauf 2/2');
        await page.locator('#btnAddPart').click();
        await expect(page.locator('#partsList .part-item')).toHaveCount(10);
        await expect(page.locator('#workshopHistoryState')).toHaveText('Verlauf 3/3');

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
        await expect(page.locator('#workshopStatusMessage')).toContainText('Änderungen lokal gespeichert.');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Auswahl: New Part');
    });

    test('deleting a part persists across reload', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#partsList .part-item').first().click();
        await page.locator('#btnDeletePart').click();
        await waitForRenderFrames(page, 2);

        expect(await getVehicleLabPartCount(page)).toBe(7);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#partsList .part-item');

        expect(await getVehicleLabPartCount(page)).toBe(7);
    });

    test('nested child selection stays unique', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#partsList .part-item').first().click();
        await page.locator('#btnAddChild').click();
        await waitForRenderFrames(page, 2);

        const selectedItems = await page.locator('#partsList .part-item.is-selected').evaluateAll((nodes) => (
            nodes.map((node) => node.textContent?.trim())
        ));

        expect(selectedItems).toEqual(['Child Part']);
        await expect(page.locator('#partTitle')).toHaveText('Edit: Child Part');
    });

    test('typing editor shortcuts in the vehicle name does not move the selected part', async ({ page }) => {
        await resetVehicleLab(page);
        await page.locator('#partsList .part-item').first().click();
        const before = await page.locator('#propertiesContainer input[type="number"]').evaluateAll((inputs) => (
            inputs.map((input) => input.value)
        ));

        await page.locator('#shipLabel').fill('WASD TRS Vehicle');
        await waitForRenderFrames(page, 2);

        const after = await page.locator('#propertiesContainer input[type="number"]').evaluateAll((inputs) => (
            inputs.map((input) => input.value)
        ));
        expect(after).toEqual(before);
    });

    test('duplicate, nested mirror and part search remain usable', async ({ page }) => {
        await resetVehicleLab(page);
        await page.locator('#partsList .part-item').first().click();
        await page.locator('#btnAddChild').click();
        await page.locator('#btnMirrorPart').click();
        await expect(page.locator('#workshopStatusMessage')).toContainText('Spiegelung X');

        await page.locator('#btnDuplicatePart').click();
        await expect(page.locator('#partsList .part-item')).toHaveCount(10);
        await page.locator('#partSearch').fill('Kopie');
        await expect(page.locator('#partsList .part-item')).toHaveCount(2);
    });

    test('camera can orbit, pan and zoom without selecting a part after dragging', async ({ page }) => {
        await resetVehicleLab(page);
        const canvas = page.locator('#vehicleCanvas');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        const initial = await canvas.screenshot();
        await page.mouse.move(center.x, center.y);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(center.x + 90, center.y + 35, { steps: 8 });
        await page.mouse.up({ button: 'left' });
        await waitForRenderFrames(page, 3);
        const orbited = await canvas.screenshot();
        expect(orbited.equals(initial)).toBe(false);
        await expect(page.locator('#propertyPanel')).toHaveClass(/is-hidden/);

        await page.mouse.down({ button: 'middle' });
        await page.mouse.move(center.x + 45, center.y - 30, { steps: 6 });
        await page.mouse.up({ button: 'middle' });
        await waitForRenderFrames(page, 3);
        const panned = await canvas.screenshot();
        expect(panned.equals(orbited)).toBe(false);

        await page.mouse.move(center.x, center.y);
        await page.mouse.wheel(0, -500);
        await waitForRenderFrames(page, 3);
        const zoomed = await canvas.screenshot();
        expect(zoomed.equals(panned)).toBe(false);
    });

    test('fixed camera views recenter the vehicle and expose the active view', async ({ page }) => {
        await resetVehicleLab(page);
        const canvas = page.locator('#vehicleCanvas');
        const captures = [];

        for (const view of ['front', 'side', 'top', 'fit']) {
            const button = page.locator(`[data-camera-view="${view}"]`);
            await button.click();
            await waitForRenderFrames(page, 3);
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            captures.push((await canvas.screenshot()).toString('base64'));
        }

        expect(new Set(captures).size).toBe(4);
    });
});

