import { expect, test } from './helpers.desktop.js';
import { resolveAppUrl } from './helpers.js';

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 900, height: 720 },
];

const SCALES = [0.6, 1.4];

test('three-player score cards stay in their columns across desktop sizes and HUD scales', async ({ page }) => {
    await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ path: 'src/four-player-planar/three-player-split.css' });
    await page.evaluate(() => {
        document.querySelector('#main-menu')?.classList.add('hidden');
        const hud = document.querySelector('#hud');
        hud.classList.remove('hidden');
        const root = document.createElement('div');
        root.className = 'three-player-split-hud';
        root.innerHTML = [0, 1, 2].map((index) => `
            <section class="three-player-split-hud-column c${index + 1}" style="--player-color:#70ff45">
                <div class="three-player-split-hud-card">
                    <strong>P${index + 1}</strong><span data-tps-stat>Abschüsse 0 · HP 100</span>
                    <span data-tps-rank>Rang 1/9</span><span data-tps-item>Kein Item</span>
                </div>
            </section>`).join('');
        hud.appendChild(root);
    });
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            const columns = await page.evaluate((hudScale) => {
                document.documentElement.style.setProperty('--hud-scale', String(hudScale));
                return [...document.querySelectorAll('.three-player-split-hud-column')].map((column) => {
                    const pane = column.getBoundingClientRect();
                    const card = column.querySelector('.three-player-split-hud-card').getBoundingClientRect();
                    return { pane: { left: pane.left, right: pane.right }, card: { left: card.left, right: card.right } };
                });
            }, scale);
            expect(columns).toHaveLength(3);
            for (const [index, { pane, card }] of columns.entries()) {
                expect(card.left, `P${index + 1} left at ${viewport.width} scale ${scale}`).toBeGreaterThanOrEqual(pane.left - 1);
                expect(card.right, `P${index + 1} right at ${viewport.width} scale ${scale}`).toBeLessThanOrEqual(pane.right + 1);
            }
        }
    }
});

function expectNear(actual, expected, tolerance = 1) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('HUD appearance preserves targeting anchors and split-screen containment', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });

        for (const scale of SCALES) {
            const layout = await page.evaluate(({ scale }) => {
                const rect = (element) => {
                    const value = element.getBoundingClientRect();
                    return {
                        left: value.left,
                        top: value.top,
                        right: value.right,
                        bottom: value.bottom,
                        width: value.width,
                        height: value.height,
                        centerX: value.left + value.width / 2,
                        centerY: value.top + value.height / 2,
                    };
                };
                const overlaps = (a, b) => !(
                    a.right <= b.left || a.left >= b.right
                    || a.bottom <= b.top || a.top >= b.bottom
                );
                const setAppearance = (element) => {
                    element.style.setProperty('--hud-scale', String(scale));
                    element.style.setProperty('--hud-opacity', '0.4');
                    element.style.setProperty('--hud-color', '#8ddcff');
                    element.style.setProperty('--hud-text', '#c8efff');
                    element.style.setProperty('--hud-line', 'rgba(141, 220, 255, 0.85)');
                    element.style.setProperty('--hud-line-soft', 'rgba(141, 220, 255, 0.55)');
                };

                document.querySelector('#main-menu')?.classList.add('hidden');
                const hud = document.querySelector('#hud');
                hud.classList.remove('hidden');
                hud.classList.add('split-screen');
                setAppearance(hud);
                setAppearance(document.documentElement);

                const p1 = document.querySelector('#p1-fighter-hud');
                const p2 = document.querySelector('#p2-fighter-hud');
                p1.classList.remove('hidden');
                p2.classList.remove('hidden');

                const localX = p1.clientWidth * 0.37;
                const localY = p1.clientHeight * 0.43;
                for (const reticle of [
                    document.querySelector('#p1-lock-reticle'),
                    document.querySelector('#p2-lock-reticle'),
                ]) {
                    reticle.classList.remove('hidden');
                    reticle.style.transform = `translate(${localX}px, ${localY}px) translate(-50%, -50%) scale(var(--hud-scale, 1))`;
                }

                const hunt = document.querySelector('#hunt-hud');
                hunt.classList.remove('hidden');
                const crosshair = document.querySelector('#crosshair-p1');
                crosshair.classList.add('p1-split');
                crosshair.style.display = 'block';
                const itemBar = document.querySelector('#p1-items');
                if (itemBar.children.length === 0) {
                    for (let index = 0; index < 5; index += 1) {
                        const slot = document.createElement('div');
                        slot.className = 'item-slot active';
                        slot.dataset.actionHintLabel = 'SHOT';
                        slot.innerHTML = '<span class="item-icon">🚀</span>';
                        itemBar.appendChild(slot);
                    }
                }
                document.querySelector('#hunt-p2-panel')?.classList.remove('hidden');
                document.querySelector('#hunt-p1-respawn')?.classList.remove('hidden');
                document.querySelector('#parcours-hud')?.classList.remove('hidden');

                let arcadeScore = document.querySelector('#arcade-score-hud');
                if (!arcadeScore) {
                    arcadeScore = document.createElement('section');
                    arcadeScore.id = 'arcade-score-hud';
                    arcadeScore.innerHTML = '<strong class="arcade-score-hud-score">0</strong>';
                    document.body.appendChild(arcadeScore);
                }
                let arcadeMission = document.querySelector('#arcade-mission-hud');
                if (!arcadeMission) {
                    arcadeMission = document.createElement('div');
                    arcadeMission.id = 'arcade-mission-hud';
                    arcadeMission.innerHTML = '<div class="arcade-mission-card">Mission</div>';
                    document.body.appendChild(arcadeMission);
                }

                const p1Rect = rect(p1);
                const p2Rect = rect(p2);
                const p1Reticle = rect(document.querySelector('#p1-lock-reticle'));
                const p2Reticle = rect(document.querySelector('#p2-lock-reticle'));
                const headingTape = rect(p1.querySelector('.hud-tape.top'));
                const matchStatus = rect(document.querySelector('.hunt-match-status'));
                const p1Root = rect(document.querySelector('#hunt-p1-panel'));
                const hp = rect(document.querySelector('#hunt-p1-panel .hunt-meter-hp'));
                const shield = rect(document.querySelector('#hunt-p1-panel .hunt-meter-shield'));
                const boost = rect(document.querySelector('.hunt-arc-boost'));
                const slowmo = rect(document.querySelector('.hunt-arc-slowmo'));
                const overheat = rect(document.querySelector('.hunt-arc-overheat'));
                const crosshairRect = rect(crosshair);
                const p2Panel = rect(document.querySelector('#hunt-p2-panel'));
                const itemSlots = [...itemBar.children].map(rect);

                return {
                    localX,
                    localY,
                    p1Rect,
                    p2Rect,
                    p1Reticle,
                    p2Reticle,
                    headingMatchOverlap: overlaps(headingTape, matchStatus),
                    p1Root,
                    hp,
                    shield,
                    boost,
                    slowmo,
                    overheat,
                    crosshair: crosshairRect,
                    p2Panel,
                    itemSlots,
                    arcOverlap: overlaps(boost, overheat),
                    p2Overlap: overlaps(overheat, p2Panel),
                    arcLabelCount: document.querySelectorAll('.hunt-arc-meter .hunt-label').length,
                    arcOpacity: getComputedStyle(document.querySelector('.hunt-arc-boost')).opacity,
                    arcSegmentCounts: [...document.querySelectorAll('#hunt-p1-panel .hunt-arc-meter .hunt-segment-track')]
                        .map((path) => (path.getAttribute('d').match(/M/g) || []).length),
                    tapes: [...p1.querySelectorAll('.hud-tape'), ...p2.querySelectorAll('.hud-tape')]
                        .map((element) => ({
                            owner: element.closest('#p1-fighter-hud') ? 'p1' : 'p2',
                            rect: rect(element),
                        })),
                    opacity: {
                        fighter: getComputedStyle(p1).opacity,
                        fighterTape: getComputedStyle(p1.querySelector('.hud-tape.top')).opacity,
                        fighterLock: getComputedStyle(document.querySelector('#p1-lock-reticle')).opacity,
                        player: getComputedStyle(document.querySelector('#p1-hud')).opacity,
                        hunt: getComputedStyle(hunt).opacity,
                        parcours: getComputedStyle(document.querySelector('#parcours-hud')).opacity,
                        arcadeScore: getComputedStyle(arcadeScore).opacity,
                        arcadeMission: getComputedStyle(arcadeMission).opacity,
                    },
                    colors: {
                        parcours: getComputedStyle(document.querySelector('.parcours-route')).color,
                        hunt: getComputedStyle(document.querySelector('.hunt-match-status .hunt-label')).color,
                        arcadeScore: getComputedStyle(arcadeScore.querySelector('.arcade-score-hud-score')).color,
                    },
                };
            }, { scale });

            const halfWidth = viewport.width / 2;
            expectNear(layout.p1Rect.left, 0);
            expectNear(layout.p1Rect.width, halfWidth);
            expectNear(layout.p2Rect.left, halfWidth);
            expectNear(layout.p2Rect.width, halfWidth);

            expectNear(layout.p1Reticle.centerX, layout.p1Rect.left + layout.localX);
            expectNear(layout.p1Reticle.centerY, layout.p1Rect.top + layout.localY);
            expectNear(layout.p2Reticle.centerX, layout.p2Rect.left + layout.localX);
            expectNear(layout.p2Reticle.centerY, layout.p2Rect.top + layout.localY);
            expect(layout.headingMatchOverlap).toBe(false);

            for (const tape of layout.tapes) {
                const owner = tape.owner === 'p1' ? layout.p1Rect : layout.p2Rect;
                expect(tape.rect.left).toBeGreaterThanOrEqual(owner.left - 1);
                expect(tape.rect.right).toBeLessThanOrEqual(owner.right + 1);
                expect(tape.rect.top).toBeGreaterThanOrEqual(owner.top - 1);
                expect(tape.rect.bottom).toBeLessThanOrEqual(owner.bottom + 1);
            }

            expectNear(layout.p1Root.left, 0);
            expectNear(layout.p1Root.right, halfWidth);
            expect(layout.shield.left).toBeLessThan(layout.p1Root.left);
            expect(layout.hp.right).toBeGreaterThan(layout.p1Root.right);
            expect(layout.hp.top).toBeLessThan(viewport.height);
            expect(layout.shield.top).toBeLessThan(viewport.height);
            expect(layout.hp.bottom).toBeGreaterThan(viewport.height);
            expect(layout.shield.bottom).toBeGreaterThan(viewport.height);
            for (const arc of [layout.boost, layout.slowmo, layout.overheat]) {
                expect(arc.left).toBeGreaterThanOrEqual(layout.p1Root.left - 1);
                expect(arc.right).toBeLessThanOrEqual(layout.p1Root.right + 1);
            }
            expect(layout.arcOverlap).toBe(true);
            expectNear(layout.boost.centerX, layout.slowmo.centerX);
            expectNear(layout.boost.centerX, layout.overheat.centerX);
            expectNear(layout.boost.centerY, layout.slowmo.centerY);
            expectNear(layout.boost.centerY, layout.overheat.centerY);
            expectNear(layout.boost.width, layout.slowmo.width);
            expectNear(layout.boost.width, layout.overheat.width);
            expectNear(layout.boost.centerX, layout.crosshair.centerX);
            expectNear(layout.boost.centerY, layout.crosshair.centerY);
            expect(layout.p2Overlap).toBe(false);
            expect(layout.arcLabelCount).toBe(0);
            expect(layout.arcOpacity).toBe('0.5');
            expect(layout.arcSegmentCounts).toEqual([10, 10, 10]);
            expect(layout.itemSlots).toHaveLength(5);
            for (const [index, slot] of layout.itemSlots.entries()) {
                expect(
                    slot.left,
                    `item slot ${index + 1} escaped at ${viewport.width}x${viewport.height}, scale ${scale}`
                ).toBeGreaterThanOrEqual(layout.p1Root.left - 1);
                expect(slot.right).toBeLessThanOrEqual(layout.p1Root.right + 1);
                expect(slot.bottom).toBeLessThanOrEqual(viewport.height + 1);
                expect(slot.bottom).toBeGreaterThan(viewport.height - 80);
                if (index > 0) {
                    expectNear(slot.top, layout.itemSlots[0].top);
                    expect(slot.left).toBeGreaterThan(layout.itemSlots[index - 1].right);
                }
            }
            expect(layout.opacity).toEqual({
                fighter: '1',
                fighterTape: '0.4',
                fighterLock: '0.85',
                player: '0.4',
                hunt: '0.4',
                parcours: '0.4',
                arcadeScore: '0.4',
                arcadeMission: '0.4',
            });
            expect(layout.colors).toEqual({
                parcours: 'rgb(141, 220, 255)',
                hunt: 'rgb(141, 220, 255)',
                arcadeScore: 'rgb(141, 220, 255)',
            });
        }
    }
});

test('Klassik and Arcade use the Fight HUD shell without duplicate Arcade score', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });

    const layout = await page.evaluate(() => {
        const hud = document.querySelector('#hud');
        const p1 = document.querySelector('#p1-hud');
        const itemBar = document.querySelector('#p1-items');
        document.querySelector('#main-menu')?.classList.add('hidden');
        hud.classList.remove('hidden');

        if (itemBar.children.length === 0) {
            for (let index = 0; index < 5; index += 1) {
                const slot = document.createElement('div');
                slot.className = 'item-slot active';
                slot.dataset.actionHintLabel = 'SHOT';
                itemBar.appendChild(slot);
            }
        }

        hud.dataset.hudMode = 'normal';
        const normalSummary = p1.querySelector('.player-hud-summary');
        const normalItemRect = itemBar.getBoundingClientRect();
        const classicBoost = p1.querySelector('.classic-boost-widget');
        const classicBoostRect = classicBoost.getBoundingClientRect();
        const classicBoostArc = classicBoost.querySelector('.hunt-segmented-arc');
        const classicBoostArcRect = classicBoostArc?.getBoundingClientRect();
        const classicBoostPaths = [...(classicBoostArc?.querySelectorAll('path') || [])];
        const normal = {
            summaryWidth: normalSummary.getBoundingClientRect().width,
            scoreVisible: getComputedStyle(p1.querySelector('.player-score')).display !== 'none',
            legacyBoostVisible: getComputedStyle(p1.querySelector('.hud-boost-bar:not(.hud-life-bar)')).display !== 'none',
            classicBoostVisible: getComputedStyle(classicBoost).display !== 'none',
            classicBoostCenterX: classicBoostRect.left + classicBoostRect.width / 2,
            classicBoostBottom: classicBoostRect.bottom,
            classicBoostArcBottom: classicBoostArcRect?.bottom || classicBoostRect.bottom,
            classicBoostPathCount: classicBoostPaths.length,
            classicBoostSegmentCounts: classicBoostPaths.map((path) => (path.getAttribute('d').match(/M/g) || []).length),
            classicBoostViewBox: classicBoostArc?.getAttribute('viewBox') || '',
            itemBottom: normalItemRect.bottom,
            itemTop: normalItemRect.top,
            itemDisplay: getComputedStyle(itemBar).display,
            panelPosition: getComputedStyle(normalSummary).position,
        };
        hud.style.setProperty('--hud-scale', '1.4');
        const scaledArcBottom = classicBoost.querySelector('.hunt-segmented-arc')?.getBoundingClientRect().bottom
            || classicBoost.getBoundingClientRect().bottom;
        const scaledItemTop = itemBar.getBoundingClientRect().top;
        normal.scaledBoostClearsItems = scaledArcBottom <= scaledItemTop;
        normal.scaledBoostClearsCrosshair = scaledArcBottom <= window.innerHeight / 2 - 20;
        hud.style.setProperty('--hud-scale', '1');

        let arcadeScore = document.querySelector('#arcade-score-hud');
        if (!arcadeScore) {
            arcadeScore = document.createElement('section');
            arcadeScore.id = 'arcade-score-hud';
            arcadeScore.className = 'arcade-score-hud';
            arcadeScore.style.cssText = 'position:fixed;display:flex';
            arcadeScore.innerHTML = `
                <div class="arcade-score-hud-scoreline"><span>Score</span><strong class="arcade-score-hud-score">0</strong></div>
                <div class="arcade-score-hud-metrics"><div class="arcade-score-hud-metric">Combo 0</div></div>
            `;
            hud.appendChild(arcadeScore);
        }
        hud.dataset.hudMode = 'arcade';
        const arcadeScoreRect = arcadeScore.getBoundingClientRect();
        const arcade = {
            playerScoreVisible: getComputedStyle(p1.querySelector('.player-score')).display !== 'none',
            playerNameVisible: getComputedStyle(p1.querySelector('.player-name')).display !== 'none',
            boostVisible: getComputedStyle(p1.querySelector('.hud-boost-bar:not(.hud-life-bar)')).display !== 'none',
            scoreRect: {
                left: arcadeScoreRect.left,
                top: arcadeScoreRect.top,
                width: arcadeScoreRect.width,
            },
            scoreClip: getComputedStyle(arcadeScore).clipPath,
        };
        return { normal, arcade, viewportHeight: window.innerHeight };
    });

    expect(layout.normal.summaryWidth).toBe(280);
    expect(layout.normal.scoreVisible).toBe(true);
    expect(layout.normal.legacyBoostVisible).toBe(false);
    expect(layout.normal.classicBoostVisible).toBe(true);
    expectNear(layout.normal.classicBoostCenterX, 640);
    expect(layout.normal.classicBoostArcBottom).toBeLessThanOrEqual(layout.normal.itemTop);
    expect(layout.normal.classicBoostArcBottom).toBeLessThanOrEqual(layout.viewportHeight / 2 - 20);
    expect(layout.normal.classicBoostPathCount).toBe(2);
    expect(layout.normal.classicBoostSegmentCounts).toEqual([100, 100]);
    expect(layout.normal.classicBoostViewBox).toBe('0 0 270 170');
    expect(layout.normal.scaledBoostClearsItems).toBe(true);
    expect(layout.normal.scaledBoostClearsCrosshair).toBe(true);
    expect(layout.normal.itemDisplay).toBe('grid');
    expect(layout.normal.panelPosition).toBe('absolute');
    expectNear(layout.normal.itemBottom, layout.viewportHeight - 20);

    expect(layout.arcade.playerScoreVisible).toBe(false);
    expect(layout.arcade.playerNameVisible).toBe(false);
    expect(layout.arcade.boostVisible).toBe(true);
    expectNear(layout.arcade.scoreRect.left, 20);
    expectNear(layout.arcade.scoreRect.top, 20);
    expect(layout.arcade.scoreRect.width).toBe(280);
    expect(layout.arcade.scoreClip).not.toBe('none');
});

test('split-screen keeps every classic/arcade panel inside its own viewport half', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });

        for (const hudMode of ['normal', 'arcade']) {
            const layout = await page.evaluate(({ hudMode }) => {
                const rect = (selector) => {
                    const element = document.querySelector(selector);
                    if (!element) return null;
                    const value = element.getBoundingClientRect();
                    return {
                        left: value.left,
                        right: value.right,
                        top: value.top,
                        bottom: value.bottom,
                        width: value.width,
                    };
                };
                const overlaps = (a, b) => !!a && !!b && !(
                    a.right <= b.left || a.left >= b.right
                    || a.bottom <= b.top || a.top >= b.bottom
                );

                document.querySelector('#main-menu')?.classList.add('hidden');
                const hud = document.querySelector('#hud');
                hud.classList.remove('hidden');
                hud.classList.add('split-screen');
                hud.dataset.hudMode = hudMode;
                document.querySelector('#p2-hud')?.classList.remove('hidden');
                document.querySelector('#parcours-hud')?.classList.remove('hidden');
                document.querySelector('#p2-parcours-hud')?.classList.remove('hidden');

                for (const barId of ['p1-items', 'p2-items']) {
                    const bar = document.querySelector('#' + barId);
                    while (bar.children.length < 5) {
                        const slot = document.createElement('div');
                        slot.className = 'item-slot active';
                        slot.dataset.actionHintLabel = 'SHOT';
                        slot.dataset.actionKey = 'F';
                        slot.innerHTML = '<span class="item-icon">R</span>';
                        bar.appendChild(slot);
                    }
                }

                const p1 = {
                    items: rect('#p1-items'),
                    parcours: rect('#parcours-hud'),
                    summary: rect('#p1-hud .player-hud-summary'),
                };
                const p2 = {
                    items: rect('#p2-items'),
                    parcours: rect('#p2-parcours-hud'),
                    summary: rect('#p2-hud .player-hud-summary'),
                };
                return {
                    p1,
                    p2,
                    parcoursOverlapsSummary: overlaps(p1.parcours, p1.summary)
                        || overlaps(p2.parcours, p2.summary),
                    parcoursOverlapsItems: overlaps(p1.parcours, p1.items)
                        || overlaps(p2.parcours, p2.items),
                };
            }, { hudMode });

            const half = viewport.width / 2;
            const context = `${hudMode} at ${viewport.width}x${viewport.height}`;
            for (const [name, panel] of Object.entries(layout.p1)) {
                expect(panel, `${name} exists (${context})`).not.toBeNull();
                expect(panel.left, `p1 ${name} starts on screen (${context})`).toBeGreaterThanOrEqual(-1);
                expect(panel.right, `p1 ${name} stays left of the divider (${context})`).toBeLessThanOrEqual(half + 1);
            }
            for (const [name, panel] of Object.entries(layout.p2)) {
                expect(panel, `${name} exists (${context})`).not.toBeNull();
                expect(panel.left, `p2 ${name} stays right of the divider (${context})`).toBeGreaterThanOrEqual(half - 1);
                expect(panel.right, `p2 ${name} ends on screen (${context})`).toBeLessThanOrEqual(viewport.width + 1);
            }
            expect(
                layout.parcoursOverlapsSummary,
                `parcours panel clears the score box (${context})`
            ).toBe(false);
            expect(
                layout.parcoursOverlapsItems,
                `parcours panel clears the item bar (${context})`
            ).toBe(false);
        }
    }
});

test('rocket queue stacks between the item bar and the effect badges in every mode', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const hudMode of ['normal', 'arcade', 'fight']) {
            for (const split of [true, false]) {
                for (const scale of [1, 1.4]) {
                    await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });
                    const layout = await page.evaluate(({ hudMode, split, scale }) => {
                        const rect = (element) => {
                            if (!element) return null;
                            const value = element.getBoundingClientRect();
                            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
                        };
                        const overlaps = (a, b) => !!a && !!b && !(
                            a.right <= b.left || a.left >= b.right
                            || a.bottom <= b.top || a.top >= b.bottom
                        );
                        const fill = (bar, label) => {
                            while (bar.children.length < 5) {
                                const slot = document.createElement('div');
                                slot.className = 'item-slot active';
                                slot.dataset.actionKey = 'F';
                                const icon = document.createElement('span');
                                icon.className = 'item-icon';
                                icon.textContent = label;
                                slot.appendChild(icon);
                                bar.appendChild(slot);
                            }
                        };

                        document.querySelector('#main-menu')?.classList.add('hidden');
                        const hud = document.querySelector('#hud');
                        hud.classList.remove('hidden');
                        hud.classList.toggle('split-screen', split);
                        hud.dataset.hudMode = hudMode;
                        hud.style.setProperty('--hud-scale', String(scale));
                        const hunt = hudMode === 'fight';
                        document.querySelector('#hunt-hud').classList.toggle('hidden', !hunt);
                        document.querySelector('#p2-hud')?.classList.toggle('hidden', !split);
                        document.querySelector('#hunt-p2-panel')?.classList.toggle('hidden', !hunt || !split);

                        const players = [];
                        for (const id of split ? ['p1', 'p2'] : ['p1']) {
                            const items = document.querySelector(`#${id}-items`);
                            fill(items, 'I');
                            // Same DOM the runtime HUD builds around the item bar.
                            const rocket = document.createElement('div');
                            rocket.className = 'item-bar rocket-bar';
                            items.parentNode.insertBefore(rocket, items);
                            fill(rocket, 'R');
                            const effects = document.createElement('div');
                            effects.className = 'active-effect-bar';
                            const badge = document.createElement('div');
                            badge.className = 'active-effect-badge';
                            badge.textContent = 'Schild 5.0s';
                            effects.appendChild(badge);
                            items.parentNode.insertBefore(effects, items.nextSibling);

                            const box = rect(items.closest('.player-hud'));
                            const rocketRect = rect(rocket);
                            const vitals = hunt ? [
                                rect(document.querySelector(`#hunt-${id}-panel .hunt-meter-hp`)),
                                rect(document.querySelector(`#hunt-${id}-panel .hunt-meter-shield`)),
                            ] : [];
                            const label = getComputedStyle(rocket, '::before');
                            players.push({
                                id,
                                box,
                                items: rect(items),
                                rocket: rocketRect,
                                rocketSlotTops: [...rocket.children].map((slot) => rect(slot).top),
                                labelPosition: label.position,
                                labelText: label.content,
                                rocketOverItems: overlaps(rocketRect, rect(items)),
                                rocketOverEffects: overlaps(rocketRect, rect(effects)),
                                rocketOverVitals: vitals.some((meter) => overlaps(rocketRect, meter)),
                                itemsOverVitals: vitals.some((meter) => overlaps(rect(items), meter)),
                            });
                        }
                        return players;
                    }, { hudMode, split, scale });

                    for (const player of layout) {
                        const context = `${player.id} ${hudMode} ${split ? 'split' : 'single'} ${viewport.width}x${viewport.height} scale ${scale}`;
                        expect(player.rocketOverItems, `rocket bar clears the item bar (${context})`).toBe(false);
                        expect(player.rocketOverEffects, `rocket bar clears the effect badges (${context})`).toBe(false);
                        // An oversized HUD can push the item bar itself under the vitals;
                        // the rocket bar must not add an overlap the item bar does not have.
                        if (scale === 1 || !player.itemsOverVitals) {
                            expect(player.rocketOverVitals, `rocket bar clears the hunt vitals (${context})`).toBe(false);
                        }
                        expect(player.labelPosition, `rocket label stays out of the slot grid (${context})`).toBe('absolute');
                        expect(player.labelText).toBe('"RAKETEN"');
                        if (hudMode === 'fight') {
                            expect(player.rocketSlotTops).toEqual([...player.rocketSlotTops].sort((a, b) => a - b));
                            for (let index = 1; index < player.rocketSlotTops.length; index += 1) {
                                expect(player.rocketSlotTops[index]).toBeGreaterThan(player.rocketSlotTops[index - 1]);
                            }
                        } else {
                            expectNear(player.rocket.left, player.items.left);
                            expectNear(player.rocket.right, player.items.right);
                            for (const top of player.rocketSlotTops) expectNear(top, player.rocketSlotTops[0]);
                        }
                        if (scale === 1 && hudMode !== 'fight') {
                            expect(player.rocket.left, `rocket bar stays in its view (${context})`).toBeGreaterThanOrEqual(player.box.left - 1);
                            expect(player.rocket.right, `rocket bar stays in its view (${context})`).toBeLessThanOrEqual(player.box.right + 1);
                        }
                    }
                }
            }
        }
    }
});

test('round end headline wraps its hunt summary and stays inside the window', async ({ page }) => {
    const viewport = { width: 1280, height: 720 };
    await page.setViewportSize(viewport);
    await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'domcontentloaded' });

    const layout = await page.evaluate(() => {
        document.querySelector('#main-menu')?.classList.add('hidden');
        document.querySelector('#hud').classList.remove('hidden');
        document.querySelector('#message-overlay').classList.remove('hidden');
        const messageText = document.querySelector('#message-text');
        messageText.textContent = 'Bot 3 gewinnt die Runde\nP1 K0/T0/A0 | Bot 2 K0/T0/A0 | Bot 3 K0/T0/A0 | Bot 4 K0/T0/A0';
        const winnerLine = document.createRange();
        winnerLine.setStart(messageText.firstChild, 0);
        winnerLine.setEnd(messageText.firstChild, 'Bot 3 gewinnt die Runde'.length);
        const rect = messageText.getBoundingClientRect();
        return {
            whiteSpace: getComputedStyle(messageText).whiteSpace,
            winnerLineBoxes: winnerLine.getClientRects().length,
            winnerLineWidth: winnerLine.getBoundingClientRect().width,
            scrollWidth: messageText.scrollWidth,
            clientWidth: messageText.clientWidth,
            left: rect.left,
            right: rect.right,
        };
    });

    // F-01: the winner line must own its line box instead of merging with the scoreboard line.
    expect(layout.whiteSpace, 'newline in the round end text is rendered as a line break')
        .toMatch(/^pre-line|^pre-wrap|^break-spaces/);
    expect(layout.winnerLineBoxes, 'the winner line stays on a single line box of its own').toBe(1);
    expect(layout.winnerLineWidth, 'the winner line does not span the whole text box')
        .toBeLessThan(layout.clientWidth);
    // F-02: the headline keeps a margin to both window edges instead of bleeding off screen.
    expect(layout.scrollWidth, 'the round end text does not overflow its box')
        .toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.left, 'the round end text keeps a margin to the left window edge')
        .toBeGreaterThanOrEqual(8);
    expect(layout.right, 'the round end text keeps a margin to the right window edge')
        .toBeLessThanOrEqual(viewport.width - 8);
});
