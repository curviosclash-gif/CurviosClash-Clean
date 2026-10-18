import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType } from './helpers.js';

async function openHub(page, session = 'single') {
    await waitForLoadedGame(page); await returnToMenu(page); await selectSessionType(page, session);
    await expect(page.locator('.arcade-journey')).toBeVisible();
}

test('Arcade map hub: real desktop map, filters, valuation, keyboard, Daily and custom return', async ({ page }, testInfo) => {
    await openHub(page);
    const root = page.locator('.arcade-journey');
    await expect(root.locator('[data-journey-node]')).toHaveCount(13);
    await expect(root.locator('[data-journey-world]')).toHaveCount(5);
    await expect(root.locator('.journey-map-path')).toHaveCount(7);
    await expect(root.locator('.journey-start-hub #btn-free-play')).toBeVisible();
    await expect(page.locator('.arcade-start-mode-options')).toBeHidden();
    for (const size of [{width:1920,height:1080},{width:1366,height:768},{width:1280,height:720},{width:1024,height:768}]) {
        await page.setViewportSize(size);
        const layout = await root.evaluate(element => {
            const rects = [...element.querySelectorAll('[data-journey-node]')].map(node => ({id:node.dataset.journeyNode,r:node.getBoundingClientRect()}));
            const overlaps=[];
            for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i].r,b=rects[j].r;if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)overlaps.push([rects[i].id,rects[j].id]);}
            return {overlaps,overflow:document.documentElement.scrollWidth>innerWidth+1};
        });
        expect(layout,JSON.stringify(size)).toEqual({overlaps:[],overflow:false});
    }
    await page.setViewportSize({width:1366,height:768});
    for(const scale of ['1.25','1.5']){
        await page.locator('#main-menu').evaluate((element,value)=>element.style.setProperty('--menu-scale',value),scale);
        expect(await root.locator('[data-journey-node]').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().width>=44))).toBe(true);
    }
    await page.locator('#main-menu').evaluate(element=>element.style.removeProperty('--menu-scale'));
    await page.getByLabel('Kartenziele anzeigen', {exact:true}).selectOption('tour');
    await expect(root.locator('[data-journey-node]:visible')).toHaveCount(3);
    await root.locator('[data-journey-node="sky_ladder"]').click();
    const card=root.locator('[data-journey-stage="sky_ladder"]');
    await expect(card.locator('.journey-tour-route li')).toHaveCount(4);
    await expect(card.locator('[data-journey-start]')).toBeDisabled();
    await expect(card.locator('.journey-map-node-mark')).toHaveCount(0);
    await card.getByRole('button',{name:'Zur Voraussetzung',exact:true}).click();
    await expect(root.locator('[data-journey-stage="orbital_shipyard"]')).toBeVisible();
    await root.locator('[data-journey-back]').click();
    await root.locator('[data-journey-node="five_portals"]').press('Enter');
    await expect(root.locator('[data-journey-stage="five_portals"] select')).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>window.GAME_INSTANCE.state)).toBe('MENU');
    await page.locator('#btn-arcade-daily-open').click();
    await expect(page.locator('#arcade-daily-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#btn-arcade-daily-open')).toBeFocused();
    await page.locator('#btn-arcade-custom-open').click();
    await expect(page.locator('#btn-arcade-custom-configure')).toBeVisible();
    await expect(page.locator('#arcade-difficulty-tier')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(root).toBeVisible();
    await page.locator('#btn-arcade-records-open').click();
    await expect(page.locator('#arcade-inline-surface')).toHaveAttribute('open','');
    await expect(page.locator('#arcade-records-line')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#btn-arcade-records-open')).toBeFocused();
    await root.locator('.journey-map').scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('arcade-map-hub.png')});
});

test('Arcade map hub: shared group cannot silently become solo for Daily or weapon race', async ({page})=>{
    await openHub(page,'splitscreen');
    await page.locator('[data-journey-node="weapon_race"]').click();
    const card=page.locator('[data-journey-stage="weapon_race"]');
    await expect(card.locator('[data-journey-start]')).toBeDisabled();
    await card.getByLabel('Waffenrennen: Wertung',{exact:true}).selectOption('free');
    await expect(card.locator('[data-journey-start]')).toBeDisabled();
    await page.locator('#btn-arcade-daily-open').click(); await expect(page.locator('#btn-arcade-daily')).toBeDisabled();
    expect(await page.evaluate(()=>window.GAME_INSTANCE.settings.localSettings.sessionType)).toBe('splitscreen');
    await page.keyboard.press('Escape'); await expect(page.locator('.journey-start-hub')).toBeVisible();
});

test('Arcade map hub: free tour bypasses the Journey gate without binding a Journey stage', async ({ page }) => {
    await openHub(page);
    await page.locator('[data-journey-node="five_portals"]').click();
    const card=page.locator('[data-journey-stage="five_portals"]');
    await expect(card.locator('[data-journey-start]')).toBeDisabled();
    await card.getByLabel('Fünf Portale: Wertung',{exact:true}).selectOption('free');
    await expect(card.locator('[data-journey-start]')).toBeEnabled();
    await card.locator('[data-journey-start]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE.state==='PLAYING');
    const config=await page.evaluate(()=>({runType:window.GAME_INSTANCE.runtimeConfig.arcade.runType,journey:window.GAME_INSTANCE.runtimeConfig.arcade.journeyStageId,chain:window.GAME_INSTANCE.runtimeConfig.arcade.portalChainId}));
    expect(config).toMatchObject({runType:'five_portals',chain:'five_portals'}); expect(config.journey||'').toBe('');
    await returnToMenu(page);
    await expect(page.locator('[data-journey-stage="five_portals"]')).toBeVisible();
    await expect(card.getByLabel('Fünf Portale: Wertung',{exact:true})).toHaveValue('free');
});
