import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test } from '@playwright/test';
import { openGameSubmenu, startGameFromMenu } from './helpers.js';
import { destroyAllElectronWindows } from './desktop-process-teardown.mjs';

const requireElectron = createRequire(new URL('../electron/package.json', import.meta.url));

async function openStudio() {
    // Keep Chromium's deeply nested profile files below Windows' path limit.
    const info = test.info();
    const fixture = path.join(info.project.outputDir, 'studio', info.testId.slice(-12), String(info.retry));
    await fs.mkdir(fixture, { recursive: true });
    const env = { ...process.env, CURVIOS_USER_DATA_ROOT: fixture,
        CURVIOS_SETTINGS_STUDIO_PROJECT_ROOT: path.join(fixture, 'project'),
        CURVIOS_MAP_BALANCING_ROOT: process.cwd(), CURVIOS_MAP_BALANCING_DATA_ROOT: path.join(fixture, 'project'),
        CURVIOS_ELECTRON_SHOW_WINDOW: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ executablePath: requireElectron('electron'),
        args: [path.resolve('electron/settings-studio/main.cjs')], cwd: process.cwd(), env });
    const page = await app.firstWindow();
    await expect(page.locator('[data-nav-section]')).toHaveCount(10);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    return { app, page, errors, env, async dispose() {
        if (!page.isClosed()) {
            await page.locator('[data-action="reset-all"]').click();
            await page.evaluate(() => window.settingsStudioApi.setDirtyState(false));
        }
        await app.close();
        expect(errors).toEqual([]);
    } };
}

const field = (page, pathValue) => page.locator(`[data-path="${pathValue}"]`).first();
const nav = (page, section) => page.locator(`[data-nav-section="${section}"]`).click();
async function save(page) {
    await page.locator('[data-action="save"]').click();
    await page.locator('[data-action="confirm-save"]').click();
    await expect(page.locator('[data-bind="status"]')).toContainText(/gespeichert/iu);
}

// These exercise the production main/preload/renderer and real IPC, without replacing services.
test('Studio search, first-click navigation and undo retain the actual draft', async () => {
    const studio = await openStudio(); const { page } = studio;
    try {
        await field(page, 'baseSettings.gameplay.speed').fill('31');
        await nav(page, 'localSettings');
        await expect(page.locator('[data-nav-section="localSettings"]')).toHaveAttribute('aria-current', 'page');
        await page.keyboard.press('Control+k');
        await expect(page.locator('[data-global-search]')).toBeFocused();
        await page.locator('[data-global-search]').fill('baseSettings.gameplay.speed');
        await page.locator('.search-result').click();
        await expect(field(page, 'baseSettings.gameplay.speed')).toBeFocused();
        await page.keyboard.press('Control+z');
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('30');
        await page.keyboard.press('Control+y');
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('31');
        await page.locator('[data-action="review-changes"]').click();
        await expect(page.locator('.search-result')).toHaveCount(1);
        await page.locator('.search-result').click();
        await save(page);
        await page.reload();
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('31');
    } finally { await studio.dispose(); }
});

test('Studio preserves invalid input and renders errors after navigation', async () => {
    const studio = await openStudio(); const { page } = studio;
    try {
        const speed = field(page, 'baseSettings.gameplay.speed');
        await speed.fill('');
        await nav(page, 'localSettings'); await nav(page, 'baseSettings');
        await expect(speed).toHaveValue('');
        await page.locator('[data-action="save"]').click();
        await expect(page.locator('[data-bind="save-preview-modal"]')).toBeHidden();
        await expect(speed).toHaveAttribute('aria-invalid', 'true');
        await page.locator('[data-action="reset-all"]').click();
        await expect(speed).toHaveValue('30');
        await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
        await nav(page, 'limits');
        const max = page.locator('[data-limit-path="baseSettings.gameplay.speed"][data-limit-key="max"]');
        await max.fill('49');
        await page.locator('[data-action="review-changes"]').click();
        await page.locator('.search-result').click();
        await expect(max).toBeFocused();
    } finally { await studio.dispose(); }
});

test('Studio refuses stale saves and can reload the externally changed file', async () => {
    const studio = await openStudio(); const { page } = studio;
    try {
        await field(page, 'baseSettings.gameplay.speed').fill('31'); await save(page);
        const loaded = await page.evaluate(() => window.settingsStudioApi.load());
        const external = JSON.stringify({ ...loaded.draft, language: 'en' });
        await fs.writeFile(loaded.paths.overrideFilePath, external);
        await field(page, 'baseSettings.gameplay.speed').fill('32');
        await page.locator('[data-action="save"]').click();
        await page.locator('[data-action="confirm-save"]').click();
        await expect(page.locator('[data-bind="notice"]')).toContainText('außerhalb');
        expect(await fs.readFile(loaded.paths.overrideFilePath, 'utf8')).toBe(external);
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('[data-action="reload"]').click();
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('31');
        await page.locator('[data-action="save"]').click();
        await expect(page.locator('[data-bind="status"]')).toContainText('Keine Änderungen');
    } finally { await studio.dispose(); }
});

test('Studio close confirmation cancels, traps focus and discards only after a real click', async () => {
    const studio = await openStudio(); const { page, app } = studio;
    try {
        await field(page, 'baseSettings.gameplay.speed').fill('31');
        await nav(page, 'localSettings');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        const dialog = page.locator('[data-close-dialog]');
        await expect(dialog).toBeVisible();
        await expect(page.locator('[data-close-cancel]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-close-discard]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await nav(page, 'baseSettings');
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('31');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect(dialog).toBeVisible();
        await page.locator('[data-close-cancel]').click();
        await expect(dialog).toBeHidden();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect(dialog).toBeVisible();
        const closed = page.waitForEvent('close');
        await page.locator('[data-close-discard]').click({ noWaitAfter: true }).catch((error) => {
            if (!page.isClosed()) throw error;
        });
        await closed;
    } finally { await studio.dispose(); }
});


test('Studio defaults, preset values, captions and start-reset survive a real game restart', async () => {
    test.setTimeout(120_000);
    const studio = await openStudio(); const { page, env } = studio;
    try {
        const loaded = await page.evaluate(() => window.settingsStudioApi.load());
        const presetIndex = loaded.draft.fixedPresets.findIndex((entry) => entry.id === 'normal-standard');
        const fightIndex = loaded.draft.fixedPresets.findIndex((entry) => entry.id === 'fight-standard');
        expect(presetIndex).toBeGreaterThanOrEqual(0);
        await field(page, 'baseSettings.gameplay.speed').fill('31');
        await nav(page, 'localSettings');
        await field(page, 'localSettings.modePath').selectOption('normal');
        await field(page, 'localSettings.audio.masterVolume').fill('0.42');
        await nav(page, 'fixedPresets');
        await field(page, `fixedPresets.${presetIndex}.values.gameplay.speed`).fill('23');
        // The free-play entry visits Fight before Classic; configure both curated styles.
        await field(page, `fixedPresets.${fightIndex}.values.gameplay.speed`).fill('23');
        await nav(page, 'limits');
        await page.locator('[data-limit-path="baseSettings.gameplay.speed"][data-limit-key="max"]').fill('40');
        await nav(page, 'level3Reset');
        await field(page, 'level3Reset.mapKey').fill('maze');
        await field(page, 'level3Reset.vehicles.PLAYER_1').fill('ship2');
        await nav(page, 'gameMenu');
        const item = loaded.menuEditorModel.items.find((entry) => entry.textId === 'menu.level3.start.label');
        await page.locator(`[data-menu-panel-id="${item.panelId}"]`).click();
        await page.locator(`.menu-preview-item[data-menu-item-id="${item.id}"]`).click();
        await page.locator(`[data-menu-text-id="${item.textId}"]`).fill('Studio Teststart');
        await save(page);
    } finally { await studio.dispose(); }
    const app = await electron.launch({ executablePath: requireElectron('electron'),
        args: [path.resolve('electron')], cwd: process.cwd(), env: { ...env, CURVIOS_E2E_RENDERER: '1' } });
    try {
        const gamePage = await app.firstWindow();
        await gamePage.waitForFunction(() => !!window.GAME_INSTANCE?.settingsManager);
        const snapshot = await gamePage.evaluate(() => {
            const manager = window.GAME_INSTANCE.settingsManager;
            return { defaults: manager.createDefaultSettings(), settings: window.GAME_INSTANCE.settings,
                clamped: manager.sanitizeSettings({ ...manager.createDefaultSettings(), gameplay: { speed: 49 } }).gameplay.speed,
                preset: manager.listMenuPresets().find((entry) => entry.id === 'normal-standard') };
        });
        expect(snapshot.defaults.gameplay.speed).toBe(31);
        expect(snapshot.clamped).toBe(40);
        expect(snapshot.defaults.localSettings.audio.masterVolume).toBe(0.42);
        expect(snapshot.preset.values['gameplay.speed']).toBe(23);
        expect(snapshot.settings.gameplay.speed).toBe(23);
        await openGameSubmenu(gamePage);
        await expect(gamePage.locator('#btn-start')).toHaveText('Studio Teststart');
        const reset = gamePage.locator('#btn-level3-reset');
        await reset.click(); await reset.click();
        await expect.poll(() => gamePage.evaluate(() => window.GAME_INSTANCE.settings.mapKey)).toBe('maze');
        await expect.poll(() => gamePage.evaluate(() => window.GAME_INSTANCE.settings.vehicles.PLAYER_1)).toBe('ship2');
        await startGameFromMenu(gamePage);
        const runtime = await gamePage.evaluate(() => {
            const config = window.GAME_INSTANCE.runtimeFacade.getRuntimeState().runtimeConfig;
            return { speed: config.player.speed, mapKey: config.session.mapKey };
        });
        expect(runtime).toEqual({ speed: 23, mapKey: 'maze' });
    } finally {
        await app.evaluate(destroyAllElectronWindows).catch(() => {}); await app.close();
    }
});


test('Studio refuses unreadable or future files and preserves unrelated drafts on typed restore', async () => {
    const studio = await openStudio(); const { page } = studio;
    try {
        const loaded = await page.evaluate(() => window.settingsStudioApi.load());
        const item = loaded.menuEditorModel.items.find((entry) => entry.kind === 'text' && entry.editable);
        await nav(page, 'gameMenu');
        await page.locator(`[data-menu-panel-id="${item.panelId}"]`).click();
        await page.locator(`.menu-preview-item[data-menu-item-id="${item.id}"]`).click();
        await page.locator(`[data-menu-text-id="${item.textId}"]`).fill('Backup test');
        await save(page);
        await nav(page, 'baseSettings');
        await field(page, 'baseSettings.gameplay.speed').fill('32');
        await nav(page, 'backups');
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('[data-action="restore-backup"]').first().click();
        await expect(page.locator('[data-bind="status"]')).toContainText(/gespeichert/iu);
        await nav(page, 'baseSettings');
        await expect(field(page, 'baseSettings.gameplay.speed')).toHaveValue('32');
        await page.locator('[data-action="reset-all"]').click();
        const raw = JSON.stringify({ schemaVersion: 'future-studio-100', secretToPreserve: 'fixture' });
        await fs.writeFile(loaded.paths.overrideFilePath, raw);
        await page.reload();
        await expect(page.locator('[data-bind="notice"]')).toBeVisible();
        await expect(page.locator('[data-action="save"]')).toBeDisabled();
        expect(await fs.readFile(loaded.paths.overrideFilePath, 'utf8')).toBe(raw);
        await fs.writeFile(loaded.paths.menuTextOverrideFilePath, '{broken json');
        await page.reload();
        await expect(page.locator('[data-bind="notice"]')).toBeVisible();
        await expect(page.locator('[data-action="save"]')).toBeDisabled();
        expect(await fs.readFile(loaded.paths.menuTextOverrideFilePath, 'utf8')).toBe('{broken json');
    } finally { await studio.dispose(); }
});
