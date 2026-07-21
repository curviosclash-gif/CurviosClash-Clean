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
                const p1Root = rect(document.querySelector('#hunt-p1-panel'));
                const boost = rect(document.querySelector('.hunt-arc-boost'));
                const overheat = rect(document.querySelector('.hunt-arc-overheat'));
                const p2Panel = rect(document.querySelector('#hunt-p2-panel'));

                return {
                    localX,
                    localY,
                    p1Rect,
                    p2Rect,
                    p1Reticle,
                    p2Reticle,
                    p1Root,
                    boost,
                    overheat,
                    p2Panel,
                    arcOverlap: overlaps(boost, overheat),
                    p2Overlap: overlaps(overheat, p2Panel),
                    tapes: [...p1.querySelectorAll('.hud-tape'), ...p2.querySelectorAll('.hud-tape')]
                        .map((element) => ({
                            owner: element.closest('#p1-fighter-hud') ? 'p1' : 'p2',
                            rect: rect(element),
                        })),
                    opacity: {
                        fighter: getComputedStyle(p1).opacity,
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

            for (const tape of layout.tapes) {
                const owner = tape.owner === 'p1' ? layout.p1Rect : layout.p2Rect;
                expect(tape.rect.left).toBeGreaterThanOrEqual(owner.left - 1);
                expect(tape.rect.right).toBeLessThanOrEqual(owner.right + 1);
                expect(tape.rect.top).toBeGreaterThanOrEqual(owner.top - 1);
                expect(tape.rect.bottom).toBeLessThanOrEqual(owner.bottom + 1);
            }

            expectNear(layout.p1Root.left, 0);
            expectNear(layout.p1Root.right, halfWidth);
            for (const arc of [layout.boost, layout.overheat]) {
                expect(arc.left).toBeGreaterThanOrEqual(layout.p1Root.left - 1);
                expect(arc.right).toBeLessThanOrEqual(layout.p1Root.right + 1);
            }
            expect(layout.arcOverlap).toBe(false);
            expect(layout.p2Overlap).toBe(false);
            expect(Object.values(layout.opacity)).toEqual(Array(6).fill('0.4'));
            expect(layout.colors).toEqual({
                parcours: 'rgb(141, 220, 255)',
                hunt: 'rgb(141, 220, 255)',
                arcadeScore: 'rgb(141, 220, 255)',
            });
        }
    }
});
