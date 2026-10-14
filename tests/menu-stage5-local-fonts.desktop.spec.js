import { test, expect } from './helpers.desktop.js';
import {
    loadGame,
    menuScreenSelector,
    openGameSubmenu,
    openStartSetupSection,
    startGameFromMenu,
} from './helpers.js';

async function setDesktopContentSize(electronApp, page, width, height) {
    const nativeSize = await electronApp.evaluate(({ BrowserWindow }, nextSize) => {
        const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
        if (!window) throw new Error('No live desktop window for menu layout check');
        if (window.isMaximized()) window.unmaximize();
        window.setContentSize(nextSize.width, nextSize.height);
        // Windows can include its off-screen non-client frame in setContentSize's first result.
        // Correct the outer dimensions from the measured content, keeping the requested viewport exact.
        const [contentWidth, contentHeight] = window.getContentSize();
        if (contentWidth !== nextSize.width || contentHeight !== nextSize.height) {
            const [outerWidth, outerHeight] = window.getSize();
            window.setSize(outerWidth + nextSize.width - contentWidth,
                outerHeight + nextSize.height - contentHeight);
        }
        return { content: window.getContentSize(), bounds: window.getBounds() };
    }, { width, height });
    console.info('MENU_LAYOUT_SIZE', { requested: { width, height }, nativeSize,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) });
    await page.waitForFunction(({ expectedWidth, expectedHeight }) => (
        window.innerWidth === expectedWidth && window.innerHeight === expectedHeight
    ), { expectedWidth: width, expectedHeight: height });
}

async function installPreviewDrawProbe(page, canvasSelector) {
    return page.evaluate((selector) => {
        if (window.__menuStage5PreviewDrawProbe) {
            throw new Error('A menu preview draw probe is already installed');
        }
        const canvas = document.querySelector(selector);
        const gl = canvas?.getContext('webgl2')
            || canvas?.getContext('webgl')
            || canvas?.getContext('experimental-webgl');
        if (!canvas || !gl) throw new Error(`No WebGL context for ${selector}`);

        const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
        const counts = Object.create(null);
        const restores = [];
        try {
            for (const name of names) {
                const original = gl[name];
                if (typeof original !== 'function') continue;
                const ownDescriptor = Object.getOwnPropertyDescriptor(gl, name);
                counts[name] = 0;
                Object.defineProperty(gl, name, {
                    configurable: true,
                    writable: true,
                    value: function countedDraw(...args) {
                        counts[name] += 1;
                        return Reflect.apply(original, this, args);
                    },
                });
                restores.push(() => {
                    if (ownDescriptor) Object.defineProperty(gl, name, ownDescriptor);
                    else delete gl[name];
                });
            }
            if (!Object.keys(counts).length) throw new Error(`No supported WebGL draw methods on ${selector}`);
        } catch (error) {
            for (const restore of restores.reverse()) restore();
            throw error;
        }

        const probe = {
            selector,
            canvas,
            counts,
            restore() {
                for (const restore of restores.reverse()) restore();
                delete window.__menuStage5PreviewDrawProbe;
            },
        };
        window.__menuStage5PreviewDrawProbe = probe;
        return { canvasClass: canvas.className, methods: Object.keys(counts) };
    }, canvasSelector);
}

async function readPreviewDrawProbe(page, canvasSelector) {
    return page.evaluate((selector) => {
        const probe = window.__menuStage5PreviewDrawProbe;
        if (!probe || probe.selector !== selector) return null;
        const counts = { ...probe.counts };
        return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
    }, canvasSelector);
}

async function waitForActualFrames(page, frameCount) {
    await page.evaluate((requestedFrames) => new Promise((resolve) => {
        let remaining = requestedFrames;
        const nextFrame = () => {
            remaining -= 1;
            if (remaining === 0) resolve();
            else requestAnimationFrame(nextFrame);
        };
        requestAnimationFrame(nextFrame);
    }), frameCount);
}

async function assertPreviewStopsOnlyWhileCovered(page, canvasSelector, label) {
    let probeInstalled = false;
    try {
        const probeInfo = await installPreviewDrawProbe(page, canvasSelector);
        probeInstalled = true;
        expect(probeInfo.methods).toEqual(expect.arrayContaining([
            'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced',
        ]));
        await page.waitForFunction((selector) => {
            const probe = window.__menuStage5PreviewDrawProbe;
            return probe?.selector === selector
                && Object.values(probe.counts).some((count) => count > 0);
        }, canvasSelector, { timeout: 10_000 });
        const visible = await readPreviewDrawProbe(page, canvasSelector);
        expect(visible.total, `${label} preview draws while visible`).toBeGreaterThan(0);

        await page.locator('#btn-open-level4').click();
        await expect(page.locator(menuScreenSelector('settings'))).toBeVisible();
        await waitForActualFrames(page, 2);
        const coveredStart = await readPreviewDrawProbe(page, canvasSelector);
        await waitForActualFrames(page, 30);
        const covered = await readPreviewDrawProbe(page, canvasSelector);
        expect(covered.total - coveredStart.total, `${label} preview draws while the settings drawer covers it`).toBe(0);

        await page.locator('#btn-close-level4').click();
        await expect(page.locator(menuScreenSelector('settings'))).toBeHidden();
        await waitForActualFrames(page, 30);
        const uncovered = await readPreviewDrawProbe(page, canvasSelector);
        expect(uncovered.total - covered.total, `${label} preview resumes after the drawer closes`).toBeGreaterThan(0);
    } finally {
        if (probeInstalled) {
            await page.evaluate(() => window.__menuStage5PreviewDrawProbe?.restore());
        }
    }
}

test('stage 5 uses local Q typography and keeps the primary action and drawer reachable', async ({ page, electronApp }, testInfo) => {
    await loadGame(page);
    await setDesktopContentSize(electronApp, page, 1400, 900);

    const menuTypography = await page.evaluate(async () => {
        await document.fonts.ready;
        const title = document.getElementById('main-menu-title');
        const summary = document.getElementById('quick-last-summary');
        const primary = document.querySelector('#main-menu .menu-primary-start');
        const primaryLabel = primary?.querySelector('.menu-primary-start-label');
        const primaryStyle = primary ? getComputedStyle(primary) : null;
        return {
            chakraLoaded: document.fonts.check('700 24px "Chakra Petch"'),
            barlowLoaded: document.fonts.check('400 16px Barlow'),
            titleFont: title ? getComputedStyle(title).fontFamily : '',
            summaryFont: summary ? getComputedStyle(summary).fontFamily : '',
            titleColor: title ? getComputedStyle(title).color : '',
            titleWeight: title ? getComputedStyle(title).fontWeight : '',
            primary: primaryStyle ? {
                backgroundColor: primaryStyle.backgroundColor,
                backgroundImage: primaryStyle.backgroundImage,
                borderRadius: primaryStyle.borderRadius,
                labelFont: primaryLabel ? getComputedStyle(primaryLabel).fontFamily : '',
                labelWeight: primaryLabel ? getComputedStyle(primaryLabel).fontWeight : '',
                rect: primary.getBoundingClientRect().toJSON(),
            } : null,
            viewport: { width: innerWidth, height: innerHeight },
        };
    });

    expect(menuTypography.chakraLoaded).toBe(true);
    expect(menuTypography.barlowLoaded).toBe(true);
    expect(menuTypography.titleFont).toContain('Chakra Petch');
    expect(menuTypography.summaryFont).toContain('Barlow');
    expect(menuTypography.titleColor).toBe('rgb(233, 238, 248)');
    expect(menuTypography.titleWeight).toBe('700');
    expect(menuTypography.primary).not.toBeNull();
    expect(menuTypography.primary.backgroundColor).toBe('rgb(47, 214, 255)');
    expect(menuTypography.primary.backgroundImage).toBe('none');
    expect(menuTypography.primary.borderRadius).toBe('3px');
    expect(menuTypography.primary.labelFont).toContain('Chakra Petch');
    expect(menuTypography.primary.labelWeight).toBe('700');
    expect(menuTypography.primary.rect.x).toBeGreaterThanOrEqual(0);
    expect(menuTypography.primary.rect.y).toBeGreaterThanOrEqual(0);
    expect(menuTypography.primary.rect.right).toBeLessThanOrEqual(menuTypography.viewport.width);
    expect(menuTypography.primary.rect.bottom).toBeLessThanOrEqual(menuTypography.viewport.height);

    await page.locator('#menu-nav [data-session-type="single"]').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#main-menu .menu-primary-start')).toBeFocused();

    await page.locator('.menu-settings-entry').click();
    await expect(page.locator(menuScreenSelector('settings'))).toBeVisible();
    const drawerFooter = page.locator(`${menuScreenSelector('settings')} .menu-q-drawer__foot`);
    const closeButton = page.locator('#btn-close-level4');
    await expect(drawerFooter).toBeVisible();
    await expect(closeButton).toBeVisible();
    await closeButton.click({ trial: true });

    await setDesktopContentSize(electronApp, page, 1024, 768);
    const compactLayout = await page.evaluate((settingsSelector) => {
        const primary = document.querySelector('#main-menu .menu-primary-start');
        const drawer = document.querySelector(settingsSelector);
        const footer = drawer?.querySelector('.menu-q-drawer__foot');
        const close = document.getElementById('btn-close-level4');
        const bounds = (element) => element?.getBoundingClientRect().toJSON() || null;
        return {
            viewport: { width: innerWidth, height: innerHeight },
            primary: bounds(primary),
            drawerVisible: !!drawer && getComputedStyle(drawer).display !== 'none'
                && !drawer.classList.contains('hidden'),
            footer: bounds(footer),
            close: bounds(close),
        };
    }, menuScreenSelector('settings'));
    expect(compactLayout.viewport).toEqual({ width: 1024, height: 768 });
    expect(compactLayout.primary?.x).toBeGreaterThanOrEqual(0);
    expect(compactLayout.primary?.right).toBeLessThanOrEqual(1024);
    expect(compactLayout.primary?.bottom).toBeLessThanOrEqual(768);
    expect(compactLayout.drawerVisible).toBe(true);
    expect(compactLayout.footer?.height).toBeGreaterThan(0);
    expect(compactLayout.footer?.bottom).toBeLessThanOrEqual(768);
    expect(compactLayout.close?.x).toBeGreaterThanOrEqual(0);
    expect(compactLayout.close?.right).toBeLessThanOrEqual(1024);
    await expect(drawerFooter).toBeVisible();
    await closeButton.click({ trial: true });
    await testInfo.attach('menu-compact-drawer', { body: await page.screenshot(), contentType: 'image/png' });
});

test('menu size slider scales pause and settings fonts through the real desktop UI', async ({ page }, testInfo) => {
    await startGameFromMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await page.locator('#btn-pause-settings').click();
    await expect(page.locator(menuScreenSelector('settings'))).toBeVisible();
    await page.locator('#btn-pause-resume').click({ trial: true });
    await page.locator('#level4-tab-graphics').click();

    const scaleSlider = page.locator('#menu-scale-slider');
    await scaleSlider.focus();
    await page.keyboard.press('End');
    await expect(page.locator('#menu-scale-label')).toHaveText('150%');

    const scaledFonts = await page.evaluate(async (settingsSelector) => {
        await document.fonts.ready;
        const pauseCard = document.querySelector('#pause-overlay .menu-q-pause__card');
        const pauseButton = document.getElementById('btn-pause-resume');
        const drawerLabel = document.querySelector(`${settingsSelector} #level4-section-graphics label`);
        const drawerButton = document.querySelector(`${settingsSelector} .level4-section-tab`);
        return {
            scale: document.documentElement.style.getPropertyValue('--menu-scale'),
            pauseCardBody: pauseCard ? getComputedStyle(pauseCard).fontSize : '',
            pauseButton: pauseButton ? getComputedStyle(pauseButton).fontSize : '',
            drawerBody: drawerLabel ? getComputedStyle(drawerLabel).fontSize : '',
            drawerButton: drawerButton ? getComputedStyle(drawerButton).fontSize : '',
            localFontsReady: document.fonts.check('700 24px "Chakra Petch"')
                && document.fonts.check('400 24px Barlow'),
        };
    }, menuScreenSelector('settings'));

    expect(scaledFonts.scale).toBe('1.5');
    expect(scaledFonts.pauseCardBody).toBe('24px');
    expect(scaledFonts.pauseButton).toBe('25.5px');
    expect(scaledFonts.drawerBody).toBe('24px');
    expect(scaledFonts.drawerButton).toBe('25.5px');
    expect(scaledFonts.localFontsReady).toBe(true);
    await testInfo.attach('menu-pause-scale-150', { body: await page.screenshot(), contentType: 'image/png' });
});

test('covered map and vehicle previews issue no GPU draws while the settings drawer is open', async ({ page, electronApp }) => {
    test.setTimeout(180_000);
    await loadGame(page);
    await setDesktopContentSize(electronApp, page, 1400, 900);
    await openGameSubmenu(page);

    await openStartSetupSection(page, 'map');
    const mapCanvas = 'canvas.start-map-preview-canvas-node';
    await page.waitForSelector(mapCanvas, { state: 'visible', timeout: 10_000 });
    await assertPreviewStopsOnlyWhileCovered(page, mapCanvas, 'map');

    await openStartSetupSection(page, 'vehicle');
    const vehicleCanvas = 'canvas.arcade-vehicle-preview-canvas-node';
    await page.waitForSelector(vehicleCanvas, { state: 'visible', timeout: 10_000 });
    await assertPreviewStopsOnlyWhileCovered(page, vehicleCanvas, 'vehicle');
});
