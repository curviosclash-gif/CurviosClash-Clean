import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu } from './helpers.js';

import { EDITOR_DATA_PATHS, EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const MAP_KEY = 'editor_desktop-probe';
const MAP_NAME = 'Desktop Probe';
const LIVE_MAP_KEY = 'editor_live-probe';
const LIVE_MAP_NAME = 'Live Probe';

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

// Der Editor speichert in seinem eigenen Fenster. Das laufende Spielfenster
// wird dabei nie neu geladen; es holt die Karte beim Oeffnen der Kartenauswahl.
test('T65f:a map saved in the desktop editor reaches the running game window without a restart', async ({ page, electronApp }, testInfo) => {
    await loadGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    const bootMarker = await page.evaluate(() => {
        window.__T65F_SAME_PAGE__ = true;
        return window.GAME_INSTANCE ? 'booted' : 'missing';
    });
    expect(bootMarker).toBe('booted');

    // Erst nach dem Start in einen leeren Kartenspeicher wechseln: was danach
    // im Menue auftaucht, kann nur aus dem Nachladen stammen.
    const userDataDirectory = testInfo.outputPath('user-data-live');
    await mkdir(path.join(userDataDirectory, EDITOR_DATA_PATHS.USER_MAPS_DIR), { recursive: true });
    await electronApp.evaluate(({ app }, directory) => app.setPath('userData', directory), userDataDirectory);

    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((editorPath) => window.open(editorPath, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popupPromise;
    try {
        await editorPage.waitForFunction(
            () => typeof window.__CURVIOS_EDITOR_DISK__?.saveMap === 'function',
            null,
            { timeout: 30_000 },
        );
        const saved = await editorPage.evaluate((mapName) => window.__CURVIOS_EDITOR_DISK__.saveMap({
            mapName,
            runtimeJson: JSON.stringify({
                name: mapName,
                size: [80, 30, 80],
                obstacles: [{ pos: [10, 5, 10], size: [6, 10, 6], kind: 'hard', rotateY: 0 }],
            }),
            editorJson: JSON.stringify({ contractVersion: 'curvios-editor-document.v1' }),
        }), LIVE_MAP_NAME);
        expect(saved).toMatchObject({ ok: true, mapKey: LIVE_MAP_KEY });
    } finally {
        await editorPage.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved?.()).catch(() => {});
        await editorPage.close();
    }

    const option = page.locator(`#map-select option[value="${LIVE_MAP_KEY}"]`);
    await expect(option).toHaveCount(0);

    // Zurueck ins Spielfenster und die Kartenauswahl neu oeffnen, wie ein
    // Spieler es tut. Genau dieser Schritt laedt die Karte nach.
    await page.click('#submenu-game:not(.hidden) [data-back]');
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(LIVE_MAP_NAME);
    expect(await page.evaluate(() => window.__T65F_SAME_PAGE__ === true)).toBe(true);

    await page.selectOption('#map-select', LIVE_MAP_KEY);
    await page.click('#btn-start');
    await page.waitForFunction(
        (mapKey) => window.GAME_INSTANCE?.arena?.currentMapKey === mapKey,
        LIVE_MAP_KEY,
        { timeout: 30_000 },
    );
});
