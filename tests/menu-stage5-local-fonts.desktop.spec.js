import { test, expect } from './helpers.desktop.js';
import { loadGame } from './helpers.js';

test('stage 5 loads local Q fonts on the live desktop menu', async ({ page }) => {
    await loadGame(page);

    const menuTypography = await page.evaluate(async () => {
        await document.fonts.ready;
        const title = document.getElementById('main-menu-title');
        const summary = document.getElementById('quick-last-summary');
        return {
            chakraLoaded: document.fonts.check('700 24px "Chakra Petch"'),
            barlowLoaded: document.fonts.check('400 16px Barlow'),
            titleFont: title ? getComputedStyle(title).fontFamily : '',
            summaryFont: summary ? getComputedStyle(summary).fontFamily : '',
            titleColor: title ? getComputedStyle(title).color : '',
        };
    });

    expect(menuTypography.chakraLoaded).toBe(true);
    expect(menuTypography.barlowLoaded).toBe(true);
    expect(menuTypography.titleFont).toContain('Chakra Petch');
    expect(menuTypography.summaryFont).toContain('Barlow');
    expect(menuTypography.titleColor).toBe('rgb(233, 238, 248)');
});
