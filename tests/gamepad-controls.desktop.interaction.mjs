import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron, expect } from '@playwright/test';
import { acquirePlaywrightRunLock } from '../scripts/playwright-run-lock.mjs';

const requireElectron = createRequire(new URL('../electron/package.json', import.meta.url));

test('desktop controller editor swaps bindings and persists them across reload', { timeout: 120_000 }, async () => {
    const lock = await acquirePlaywrightRunLock({ label: 'controller bindings desktop' });
    let app;
    try {
        const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-controller-ui-'));
        let main = path.resolve('electron/main.cjs');
        if (process.env.CONTROLLER_BUILD_DIR) {
            // A private desktop shell keeps other sessions' dist-app untouched.
            await fs.cp(path.resolve('electron'), path.join(artifacts, 'electron'), {
                recursive: true, filter: (entry) => !entry.split(path.sep).includes('node_modules'),
            });
            await fs.symlink(path.resolve(process.env.CONTROLLER_BUILD_DIR), path.join(artifacts, 'dist-app'), 'junction');
            main = path.join(artifacts, 'electron/main.cjs');
        }
        const boot = path.join(artifacts, 'boot.cjs');
        await fs.writeFile(boot, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(artifacts)});require(${JSON.stringify(main)});`);
        const env = { ...process.env, PW_RUN_TAG: `controller-${Date.now()}`, CURVIOS_ELECTRON_SHOW_WINDOW: '1' };
        delete env.ELECTRON_RUN_AS_NODE;
        app = await _electron.launch({ executablePath: requireElectron('electron'), args: [boot], env });
        const page = await app.firstWindow();
        await page.waitForSelector('#main-menu[data-shell-ready="true"]', { timeout: 60_000 });
        await page.locator('.menu-utility-shell [data-level4-section=controls]').click();
        const editor = page.locator('#keybind-global [data-gamepad-editor]');
        await expect(editor).toBeVisible();
        await expect(editor.locator('[data-gamepad-action]')).toHaveCount(11);
        const assignment = editor.getByLabel('Splitscreen: Eingabegeräte');
        await expect(assignment.locator('option')).toHaveCount(5);
        for (const layout of ['controller-keyboard', 'keyboard-controller', 'keyboard-keyboard', 'controller-controller']) {
            await assignment.selectOption(layout);
            await expect(assignment).toHaveValue(layout);
        }
        await editor.locator('[data-gamepad-action="BOOST"]').selectOption('4');
        await expect(editor.locator('[data-gamepad-action="BOOST"]')).toHaveValue('4');
        await expect(editor.locator('[data-gamepad-action="SLOWMO"]')).toHaveValue('0');
        await editor.getByLabel('Controller auswählen').selectOption('GAMEPAD_2');
        await editor.locator('[data-gamepad-action="PAUSE"]').selectOption('8');
        await expect(editor.getByLabel('Controller auswählen')).toHaveValue('GAMEPAD_2');
        // Changes save on their own after a short delay; the dirty flag clears once they are stored.
        await page.waitForFunction(() => window.GAME_INSTANCE?.settingsDirty === false);
        await page.reload();
        await page.waitForSelector('#main-menu[data-shell-ready="true"]');
        await page.locator('.menu-utility-shell [data-level4-section=controls]').click();
        await expect(assignment).toHaveValue('controller-controller');
        await expect(editor.locator('[data-gamepad-action="BOOST"]')).toHaveValue('4');
        await expect(editor.locator('[data-gamepad-action="SLOWMO"]')).toHaveValue('0');
        await editor.getByLabel('Controller auswählen').selectOption('GAMEPAD_2');
        await expect(editor.locator('[data-gamepad-action="PAUSE"]')).toHaveValue('8');
        for (const width of [1280, 900]) {
            await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
            await editor.scrollIntoViewIfNeeded();
            const geometry = await editor.evaluate((element) => ({ width: element.getBoundingClientRect().width, scroll: element.scrollWidth }));
            assert.ok(geometry.scroll <= geometry.width + 2, 'controller editor must not overflow');
            await page.screenshot({ path: path.join(artifacts, `controller-${width}.png`) });
        }
        console.log(`Controller desktop QA: ${artifacts}`);
    } finally { await app?.close(); lock.release(); }
});
