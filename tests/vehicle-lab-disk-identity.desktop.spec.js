import { mkdir, readFile, readdir } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';

import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('Vehicle Lab keeps long colliding names separate in the desktop store', async ({ page, electronApp }, testInfo) => {
    const userDataDirectory = testInfo.outputPath('user-data');
    await mkdir(userDataDirectory, { recursive: true });
    await electronApp.evaluate(({ app }, directory) => app.setPath('userData', directory), userDataDirectory);

    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((vehicleLabPath) => window.open(vehicleLabPath, '_blank'), EDITOR_VIEW_PATHS.VEHICLE_LAB);
    const labPage = await popupPromise;

    try {
        await labPage.waitForLoadState('domcontentloaded');
        await labPage.evaluate(() => {
            localStorage.removeItem('vehicle_lab_config');
            localStorage.removeItem('vehicle_lab_recovery_config');
            localStorage.removeItem('curviosclash.vehicle-lab.catalog.v1');
            localStorage.removeItem('curviosclash.vehicle-lab.hangar-parts.v1');
        });
        await labPage.reload({ waitUntil: 'domcontentloaded' });
        await expect(labPage.locator('#partsList .part-item')).toHaveCount(8, { timeout: 15000 });

        const slug = 'a'.repeat(48);
        const vehicleNames = [`${slug}!`, `${slug}?`];
        for (const [index, vehicleName] of vehicleNames.entries()) {
            await labPage.locator('#btnSaveVehicle').click();
            await labPage.locator('#workshopDialogInput').fill(vehicleName);
            await labPage.locator('#workshopDialogConfirm').click();
            await expect(labPage.locator('#workshopSaveState')).toHaveText('Fahrzeug gespeichert');
            await expect.poll(async () => (
                await readdir(`${userDataDirectory}/vehicles`)
            ).length).toBe(index + 1);
        }

        const baseId = `editor_vehicle_${slug}`;
        const savedFromDisk = await Promise.all([baseId, `${baseId}-2`].map(async (vehicleId) => JSON.parse(
            await readFile(`${userDataDirectory}/vehicles/${vehicleId}.vehicle.json`, 'utf8')
        )));
        expect(savedFromDisk.map((config) => config.label)).toEqual(vehicleNames);

        const catalog = await labPage.evaluate(() => JSON.parse(
            localStorage.getItem('curviosclash.vehicle-lab.catalog.v1')
        ));
        expect(catalog.vehicles.map((vehicle) => vehicle.id)).toEqual([
            `${baseId}-2`,
            baseId,
        ]);
    } finally {
        if (!labPage.isClosed()) await labPage.close();
    }
});
