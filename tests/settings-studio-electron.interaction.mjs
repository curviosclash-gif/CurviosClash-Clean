import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test } from '@playwright/test';

const requireElectron = createRequire(new URL('../electron/package.json', import.meta.url));
const electronExecutablePath = requireElectron('electron');

test('Settings Studio edits a numeric default and interval without losing focus', async () => {
    const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-settings-studio-e2e-'));
    const appDataPath = path.join(profilePath, 'AppData', 'Roaming');
    const localAppDataPath = path.join(profilePath, 'AppData', 'Local');
    await Promise.all([
        fs.mkdir(appDataPath, { recursive: true }),
        fs.mkdir(localAppDataPath, { recursive: true }),
    ]);
    const env = {
        ...process.env,
        APPDATA: appDataPath,
        LOCALAPPDATA: localAppDataPath,
        USERPROFILE: profilePath,
        CURVIOS_ELECTRON_SHOW_WINDOW: '1',
        CURVIOS_SETTINGS_STUDIO_PROJECT_ROOT: profilePath,
    };
    delete env.ELECTRON_RUN_AS_NODE;

    let electronApp;
    let window;
    try {
        electronApp = await electron.launch({
            executablePath: electronExecutablePath,
            args: [path.resolve('electron/settings-studio/main.cjs')],
            env,
        });
        window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await expect(window.locator('[data-bind="status"]')).not.toHaveText('Lade Daten...');

        const target = await window.evaluate(async () => {
            const loaded = await window.settingsStudioApi.load();
            const item = loaded.menuEditorModel.items.find((entry) => (
                entry.settingsPath === 'baseSettings.botBridge.timeoutMs'
            ));
            return { id: item.id, panelId: item.panelId };
        });
        await window.locator('[data-nav-section="gameMenu"]').click();
        await window.locator(`[data-menu-panel-id="${target.panelId}"]`).click();
        await window.locator(`[data-menu-item-id="${target.id}"]`).click();

        const defaultInput = window.locator(
            '[data-menu-range-path="baseSettings.botBridge.timeoutMs"][data-menu-range-component="default"]'
        );
        await defaultInput.click();
        await defaultInput.pressSequentially('120');
        await expect(defaultInput).toBeFocused();
        await expect(defaultInput).toHaveValue('120');
        await expect(window.locator(`[data-menu-item-id="${target.id}"] strong`)).toHaveText('120');

        const stepInput = window.locator(
            '[data-menu-range-path="baseSettings.botBridge.timeoutMs"][data-menu-range-component="step"]'
        );
        await stepInput.fill('0');
        await expect(stepInput).toHaveAttribute('aria-invalid', 'true');
        await expect(window.locator('.menu-range-error')).toContainText('Step');
        await window.locator('[data-action="save"]').click();
        await expect(window.locator('[data-bind="save-preview-modal"]')).toBeHidden();

        await stepInput.fill('10');
        await expect(stepInput).toHaveAttribute('aria-invalid', 'false');
        await window.locator('[data-action="save"]').click();
        await expect(window.locator('[data-bind="save-preview-modal"]')).toBeVisible();
        await expect(window.locator('[data-bind="save-preview-body"]')).toContainText(/step/iu);
        await window.locator('[data-action="confirm-save"]').click();
        await expect(window.locator('[data-bind="status"]')).toContainText('Gespeichert');

        const persisted = await window.evaluate(async () => window.settingsStudioApi.load());
        expect(persisted.draft.baseSettings.botBridge.timeoutMs).toBe(120);
        expect(persisted.draft.limitOverrides['baseSettings.botBridge.timeoutMs']).toEqual({
            step: 10,
        });
    } finally {
        await window?.evaluate(() => window.settingsStudioApi?.setDirtyState?.(false)).catch(() => {});
        await electronApp?.close().catch(() => {});
        await fs.rm(profilePath, { recursive: true, force: true });
    }
});
