import { expect, test } from '@playwright/test';

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 900, height: 720 },
];

const SCALES = [0.6, 1.4];

function expectNear(actual, expected, tolerance = 1) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('HUD appearance preserves targeting anchors and split-screen containment', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto('/', { waitUntil: 'domcontentloaded' });

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
                const vitals = rect(document.querySelector('.hunt-vitals'));
                const boost = rect(document.querySelector('.hunt-arc-boost'));
                const overheat = rect(document.querySelector('.hunt-arc-overheat'));
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
                    vitals,
                    boost,
                    overheat,
                    p2Panel,
                    itemSlots,
                    arcOverlap: overlaps(boost, overheat),
                    p2Overlap: overlaps(overheat, p2Panel),
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
            expectNear(layout.vitals.left, layout.p1Root.left + 20);
            expectNear(layout.vitals.bottom, viewport.height - 20);
            for (const arc of [layout.boost, layout.overheat]) {
                expect(arc.left).toBeGreaterThanOrEqual(layout.p1Root.left - 1);
                expect(arc.right).toBeLessThanOrEqual(layout.p1Root.right + 1);
            }
            expect(layout.arcOverlap).toBe(false);
            expect(layout.p2Overlap).toBe(false);
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
    await page.goto('/', { waitUntil: 'domcontentloaded' });

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
