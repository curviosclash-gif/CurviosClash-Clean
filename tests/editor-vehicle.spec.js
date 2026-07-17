import { expect, test } from '@playwright/test';

import { EDITOR_API_ROUTES, EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { waitForRenderFrames } from './helpers.js';

async function resetVehicleLab(page) {
    await page.goto(EDITOR_VIEW_PATHS.VEHICLE_LAB, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        localStorage.removeItem('vehicle_lab_config');
        localStorage.removeItem('vehicle_lab_recovery_config');
        localStorage.removeItem('curviosclash.vehicle-lab.catalog.v1');
        localStorage.removeItem('curviosclash.vehicle-lab.hangar-parts.v1');
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

        await expect(page.locator('.vehicle-library')).not.toHaveAttribute('open', '');
        await expect(page.locator('#standardVehiclesList button', { hasText: 'Auswählen' })).toHaveCount(21);

        await page.locator('#presetSelect').selectOption('lab_spaceship');
        await expect(page.locator('#partsList .part-item')).toHaveCount(6);
        await expect(page.locator('#shipLabel')).toHaveValue('Lab-Vorlage: Raumschiff');
        await expect(page.locator('[data-camera-view="fit"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Entwurf geladen');
    });

    test('all built-in game vehicles load as read-only references and can return to editing', async ({ page }) => {
        await resetVehicleLab(page);

        await page.locator('#presetSelect').selectOption('ship1');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Spielmodell geladen: Interceptor');
        await expect(page.locator('#referenceVehicleNotice')).toBeVisible();
        await expect(page.locator('#referenceVehicleNotice')).toContainText('schreibgeschützt');
        await expect(page.locator('#btnAddPart')).toBeDisabled();
        await expect(page.locator('#btnSaveToGameVehicle')).toBeDisabled();
        await expect(page.locator('#polyCountBadge')).not.toHaveText('Polygone: 0');

        await page.locator('#presetSelect').selectOption('lab_jet_fighter');
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

        await expect(page.locator('#compareVehicleSelect')).toHaveValue('lab_spaceship');
        await expect(page.locator('[data-metric="parts"] .compare-current')).toHaveText('8');
        await expect(page.locator('[data-metric="parts"] .compare-baseline')).toHaveText('6');
        await expect(page.locator('[data-metric="parts"] .compare-delta')).toHaveText('+2');
        await expect(page.locator('#workshopBlueprintState')).toContainText('Blueprint');

        await page.locator('#btnAddPart').click();
        await expect(page.locator('[data-metric="parts"] .compare-current')).toHaveText('9');
        await expect(page.locator('#workshopStatusMessage')).toContainText('Entwurf automatisch gesichert.');
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
        await expect(page.locator('#partTitle')).toHaveText('Bearbeiten: Child Part');
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
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(center.x + 90, center.y + 35, { steps: 8 });
        await page.mouse.up({ button: 'right' });
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

    test('desktop layout prioritizes the part tree over the collapsed vehicle library', async ({ page }) => {
        await resetVehicleLab(page);
        const visiblePartRows = await page.locator('#partsList .part-item').evaluateAll((nodes) => {
            const listRect = nodes[0]?.parentElement?.parentElement?.getBoundingClientRect();
            return nodes.filter((node) => {
                const rect = node.getBoundingClientRect();
                return listRect && rect.top >= listRect.top && rect.bottom <= listRect.bottom;
            }).length;
        });
        expect(visiblePartRows).toBeGreaterThanOrEqual(6);
    });

    test('preset changes keep a recoverable auto-saved draft across reloads', async ({ page }) => {
        await resetVehicleLab(page);
        await page.locator('#shipLabel').fill('Mein Entwurf');
        await expect(page.locator('#workshopSaveState')).toContainText('Entwurf automatisch gesichert');

        await page.locator('#presetSelect').selectOption('lab_spaceship');
        await expect(page.locator('#shipLabel')).toHaveValue('Lab-Vorlage: Raumschiff');
        await expect(page.locator('#btnRestoreDraft')).toBeEnabled();
        await page.locator('#btnRestoreDraft').click();
        await expect(page.locator('#shipLabel')).toHaveValue('Mein Entwurf');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#shipLabel')).toHaveValue('Mein Entwurf');
    });

    test('named desktop save works without the developer disk API', async ({ page }) => {
        await page.route(`**${EDITOR_API_ROUTES.SAVE_VEHICLE_DISK}`, (route) => (
            route.fulfill({ status: 404, body: 'not available' })
        ));
        await resetVehicleLab(page);
        await page.locator('#btnSaveVehicle').click();
        await page.locator('#workshopDialogInput').fill('Desktop Testflieger');
        await page.locator('#workshopDialogConfirm').click();

        await expect(page.locator('#workshopSaveState')).toHaveText('Fahrzeug gespeichert');
        const catalog = await page.evaluate(() => JSON.parse(
            localStorage.getItem('curviosclash.vehicle-lab.catalog.v1')
        ));
        expect(catalog.vehicles[0].id).toBe('editor_vehicle_desktop-testflieger');
        expect(catalog.vehicles[0].config.parts).toHaveLength(8);

        await page.locator('#btnSaveToGameVehicle').click();
        await page.locator('#workshopDialogConfirm').click();
        await expect(page.locator('#workshopSaveState')).toHaveText('Im Hangar veröffentlicht');
        const publications = await page.evaluate(() => JSON.parse(
            localStorage.getItem('curviosclash.vehicle-lab.hangar-parts.v1')
        ).publications);
        expect(publications[0].label).toBe('Desktop Testflieger');
        expect(publications[0].vehicleId).toBe('editor_vehicle_desktop-testflieger');
    });

    test('properties expose localized roles, labeled axes and directional budget deltas', async ({ page }) => {
        await resetVehicleLab(page);
        await page.locator('#partsList .part-item').first().click();
        await expect(page.locator('#partTitle')).toContainText('Bearbeiten:');
        const roleSelect = page.locator('#propertiesContainer select').nth(1);
        await expect(roleSelect).toContainText('Rumpf');
        await roleSelect.selectOption('core');
        await expect(page.locator('#propertiesContainer input[aria-label="Position X"]')).toBeVisible();
        await expect(page.locator('[data-metric="budgetUsed"] .compare-current')).toContainText('/100');
        await expect(page.locator('[data-metric="budgetUsed"] .compare-delta')).toHaveClass(/is-worse/);
        await page.locator('#partsList .part-item').first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#partsList .part-item.is-selected')).toHaveText('Nose Cone');
    });

    test('transform tools separate dimensions from scale and keyboard snap avoids the S conflict', async ({ page }) => {
        await resetVehicleLab(page);
        await page.locator('#partsList .part-item').first().click();

        await expect(page.locator('[data-transform-mode="translate"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#propertiesContainer input[aria-label="Grundabmessungen X"]')).toBeVisible();
        const positionZ = page.locator('#propertiesContainer input[aria-label="Position Z"]');
        const beforeZ = await positionZ.inputValue();
        await page.keyboard.press('s');
        await expect(page.locator('[data-transform-mode="scale"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(positionZ).toHaveValue(beforeZ);

        const positionX = page.locator('#propertiesContainer input[aria-label="Position X"]');
        const beforeX = Number(await positionX.inputValue());
        await page.keyboard.press('ArrowRight');
        await expect(positionX).toHaveValue((beforeX + 0.25).toFixed(2));
        await page.keyboard.press('Shift+ArrowRight');
        await expect(positionX).toHaveValue((beforeX + 2.75).toFixed(2));

        const scaleX = page.locator('#propertiesContainer input[aria-label="Skalierung X"]');
        await scaleX.fill('1.7');
        await scaleX.press('Tab');
        await expect(page.locator('#propertiesContainer input[aria-label="Skalierung X"]')).toHaveValue('1.70');
        await page.getByRole('button', { name: 'Skalierung zurücksetzen' }).click();
        await expect(page.locator('#propertiesContainer input[aria-label="Skalierung X"]')).toHaveValue('1.00');

        await page.locator('#chkFlyMode').check();
        await expect(page.locator('[data-transform-mode="translate"]')).toBeDisabled();
        await expect(page.locator('[data-transform-mode="rotate"]')).toBeDisabled();
        await expect(page.locator('[data-transform-mode="scale"]')).toBeDisabled();
        await page.locator('#chkFlyMode').uncheck();
        await expect(page.locator('[data-transform-mode="scale"]')).toBeEnabled();
    });
});

