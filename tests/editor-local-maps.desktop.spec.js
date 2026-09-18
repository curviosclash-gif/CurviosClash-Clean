import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu } from './helpers.js';

import { EDITOR_DATA_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const MAP_KEY = 'editor_desktop-probe';
const MAP_NAME = 'Desktop Probe';

// Im Desktop legt der Editor Karten in userData/maps ab. Das Spielfenster liest
// sie beim Start; dieser Test belegt den Weg vom Ordner bis zur gestarteten Runde.
test('T65e:a map saved in the desktop user folder shows up in the map menu and starts', async ({ page, electronApp }, testInfo) => {
    const userDataDirectory = testInfo.outputPath('user-data');
    const mapsDirectory = path.join(userDataDirectory, EDITOR_DATA_PATHS.USER_MAPS_DIR);
    await mkdir(mapsDirectory, { recursive: true });
    await writeFile(path.join(mapsDirectory, `${MAP_KEY}.runtime.json`), JSON.stringify({
        name: MAP_NAME,
        size: [80, 30, 80],
        obstacles: [{ pos: [10, 5, 10], size: [6, 10, 6], kind: 'hard', rotateY: 0 }],
    }), 'utf8');
    await electronApp.evaluate(({ app }, directory) => app.setPath('userData', directory), userDataDirectory);

    // Die Kartenliste entsteht beim Laden; erst ein neuer Start sieht den Ordner.
    await loadGame(page, { forceReload: true });
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

    const option = page.locator(`#map-select option[value="${MAP_KEY}"]`);
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(MAP_NAME);

    await page.selectOption('#map-select', MAP_KEY);
    await page.click('#btn-start');
    await page.waitForFunction(
        (mapKey) => window.GAME_INSTANCE?.arena?.currentMapKey === mapKey,
        MAP_KEY,
        { timeout: 30_000 },
    );
});
