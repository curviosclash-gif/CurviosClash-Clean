import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test } from '@playwright/test';
import { startGameFromMenu } from './helpers.js';
import { destroyAllElectronWindows } from './desktop-process-teardown.mjs';

const require = createRequire(new URL('../electron/package.json', import.meta.url));
const executablePath = require('electron');
const closeIsolatedApp = async (app) => {
    await app.evaluate(destroyAllElectronWindows).catch(() => {});
    await app.close();
};

test('tested map values can be approved, used by an ordinary game start, and withdrawn', async ({}, testInfo) => {
    test.setTimeout(180_000);
    const fixture = path.join(
        testInfo.project.outputDir,
        'profiles',
        `${testInfo.testId.slice(-12)}-${testInfo.retry}`
    );
    await fs.mkdir(fixture, { recursive: true });
    const project = path.join(fixture, 'project');
    const dataRoot = path.join(fixture, 'profiles');
    await fs.mkdir(path.join(project, 'data/balancing'), { recursive: true });
    await fs.symlink(path.resolve('src'), path.join(project, 'src'), 'junction');
    await fs.copyFile('data/balancing/modes.json', path.join(project, 'data/balancing/modes.json'));
    const env = { ...process.env, CURVIOS_USER_DATA_ROOT: dataRoot,
        CURVIOS_MAP_BALANCING_ROOT: project, CURVIOS_SETTINGS_STUDIO_PROJECT_ROOT: project,
        CURVIOS_ELECTRON_SHOW_WINDOW: '1', CURVIOS_E2E_RENDERER: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const launchStudio = () => electron.launch({ executablePath, args: [path.resolve('electron/settings-studio/main.cjs')], env });
    const openMap = async (window) => {
        await expect(window.locator('[data-bind="status"]')).not.toHaveText('Lade Daten...');
        await window.locator('[data-nav-section="mapBalancing"]').click();
        await window.locator('.map-balancing__mode').selectOption('normal');
        await window.locator('.map-balancing__map').filter({ has: window.locator('small', { hasText: /^standard$/ }) }).click();
        await expect(window.locator('.map-balancing__number').first()).toBeVisible();
    };
    const readLocal = async () => JSON.parse(await fs.readFile(path.join(dataRoot, 'curviosclash-app/map-balancing.applied.json'), 'utf8'));
    const sourceFile = path.join(project, 'data/balancing/applied/standard.normal.json');
    let studio = await launchStudio();
    try {
        const window = await studio.firstWindow();
        await openMap(window);
        const speed = () => window.locator('.map-balancing__number').first();
        await speed().fill('24');
        await speed().blur();
        await expect(window.getByRole('button', { name: 'Für normales Spiel übernehmen', exact: true })).toBeDisabled();
        await window.getByRole('button', { name: 'Für Karte speichern', exact: true }).click();
        await expect(window.getByRole('button', { name: 'Für normales Spiel übernehmen', exact: true })).toBeEnabled();
        await window.getByRole('button', { name: 'Für normales Spiel übernehmen', exact: true }).click();
        await expect(window.locator('.map-balancing__status')).toContainText('Übernommen.');
        expect((await readLocal()).entries[0].values.speed).toBe(24);
        expect(JSON.parse(await fs.readFile(sourceFile, 'utf8')).values.speed).toBe(24);
        await window.screenshot({ path: testInfo.outputPath('map-balancing-applied.png') });
        await speed().fill('28');
        await speed().blur();
        await window.getByRole('button', { name: 'Für Karte speichern', exact: true }).click();
        await expect(window.getByRole('button', { name: 'Für Karte speichern', exact: true })).toBeDisabled();
        await expect(window.locator('.map-balancing__hint')).toContainText(['Für Klassisch übernommen. Die aktuellen Änderungen sind noch nicht übernommen.']);
        expect((await readLocal()).entries[0].values.speed).toBe(24);
    } finally {
        await closeIsolatedApp(studio);
    }

    const runGame = async () => {
        const app = await electron.launch({ executablePath, args: [path.resolve('electron')], env });
        try {
            const page = await app.firstWindow();
            await page.waitForFunction(() => !!window.GAME_INSTANCE?.settingsManager);
            const snapshot = await page.evaluate(() => window.curviosApp.settingsDefaults.getOverrideSnapshot());
            expect(snapshot.appliedMapBalancing.error).toBeNull();
            await startGameFromMenu(page);
            return await page.evaluate(() => {
                const config = window.GAME_INSTANCE.runtimeFacade.getRuntimeState().runtimeConfig;
                return { map: config.session.mapKey, mode: config.session.modePath, speed: config.player.speed };
            });
        } finally {
            await closeIsolatedApp(app);
        }
    };
    expect(await runGame()).toEqual({ map: 'standard', mode: 'normal', speed: 24 });

    studio = await launchStudio();
    try {
        const window = await studio.firstWindow();
        await openMap(window);
        await window.getByRole('button', { name: 'Übernahme zurücknehmen', exact: true }).click();
        await expect(window.locator('.map-balancing__status')).toContainText('Übernahme zurückgenommen.');
        expect((await readLocal()).entries[0].enabled).toBe(false);
        expect(JSON.parse(await fs.readFile(sourceFile, 'utf8')).enabled).toBe(false);
    } finally {
        await closeIsolatedApp(studio);
    }
    const defaults = JSON.parse(await fs.readFile('data/balancing/modes.json', 'utf8'));
    expect(await runGame()).toEqual({ map: 'standard', mode: 'normal', speed: defaults.modes.normal.values.speed });
});
