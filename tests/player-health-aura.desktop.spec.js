import { test, expect } from './helpers.desktop.js';
import { loadGame, returnToMenu, selectSessionType, waitForRenderFrames } from './helpers.js';

async function startTeamHuntSplitMatch(page, { load = false } = {}) {
    if (load) await loadGame(page);
    await selectSessionType(page, 'splitscreen');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => {
        const botSlider = document.getElementById('bot-count');
        botSlider.value = '1';
        botSlider.dispatchEvent(new Event('input', { bubbles: true }));

        const teamToggle = document.getElementById('hunt-team-mode-toggle');
        teamToggle.checked = true;
        teamToggle.dispatchEvent(new Event('change', { bubbles: true }));

        const teamSize = document.getElementById('hunt-team-size-select');
        teamSize.value = '2';
        teamSize.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#submenu-game:not(.hidden) #btn-start');
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.entityManager?.players?.length >= 3
            && game?.renderer?.cameras?.length >= 2
            && game.entityManager.players.every((player) => player?.view?.healthAura);
    }, null, { timeout: 60000 });
    await waitForRenderFrames(page, 3);
}

function readHealthAuraProbe() {
    const game = window.GAME_INSTANCE;
    const players = game?.entityManager?.players || [];
    const cameras = game?.renderer?.cameras || [];
    if (players.length < 3 || cameras.length < 2) return { error: 'missing-runtime' };

    const [first, second, bot] = players;
    first.hp = first.maxHp;
    second.hp = second.maxHp * 0.5;
    bot.hp = bot.maxHp * 0.1;
    second.hasShield = true;
    second.shieldHP = Math.max(1, second.maxShieldHp || 1);
    for (const player of players) player.view.updateVisuals(0);

    const summarize = (player) => {
        const aura = player.view.healthAura;
        return {
            index: player.index,
            teamId: player.teamId,
            isBot: player.isBot,
            rootVisible: aura.root.visible,
            color: aura.inner.material.color.getHex(),
            innerOpacity: aura.inner.material.opacity,
            outerOpacity: aura.outer.material.opacity,
            visibleToCamera0: aura.inner.layers.test(cameras[0].layers),
            visibleToCamera1: aura.inner.layers.test(cameras[1].layers),
            auraRootCount: player.group.children.filter((child) => child.name === 'player-health-aura').length,
        };
    };

    return {
        error: null,
        mode: game.entityManager.activeGameMode,
        first: summarize(first),
        second: summarize(second),
        bot: summarize(bot),
        teammateRelation: first.teamId === bot.teamId,
        enemyRelation: first.teamId !== second.teamId,
        shieldAndAuraVisible: second.shieldMesh.visible && second.view.healthAura.root.visible,
    };
}

test('Fight health aura covers teammates, enemies, split cameras and match restart', async ({ page }) => {
    await startTeamHuntSplitMatch(page, { load: true });
    const firstRun = await page.evaluate(readHealthAuraProbe);

    expect(firstRun.error).toBeNull();
    expect(firstRun.mode).toBe('HUNT');
    expect(firstRun.teammateRelation).toBeTruthy();
    expect(firstRun.enemyRelation).toBeTruthy();
    expect(firstRun.first.rootVisible).toBeTruthy();
    expect(firstRun.second.rootVisible).toBeTruthy();
    expect(firstRun.bot.rootVisible).toBeTruthy();
    expect(firstRun.first.visibleToCamera0).toBeFalsy();
    expect(firstRun.first.visibleToCamera1).toBeTruthy();
    expect(firstRun.second.visibleToCamera0).toBeTruthy();
    expect(firstRun.second.visibleToCamera1).toBeFalsy();
    expect(firstRun.bot.visibleToCamera0).toBeTruthy();
    expect(firstRun.bot.visibleToCamera1).toBeTruthy();
    expect(firstRun.second.color).toBe(0xffd60a);
    expect(firstRun.first.innerOpacity).toBeGreaterThan(firstRun.second.innerOpacity);
    expect(firstRun.second.innerOpacity).toBeGreaterThan(firstRun.bot.innerOpacity);
    expect(firstRun.first.innerOpacity).toBeGreaterThan(firstRun.first.outerOpacity);
    expect(firstRun.shieldAndAuraVisible).toBeTruthy();
    expect([firstRun.first, firstRun.second, firstRun.bot].every((entry) => entry.auraRootCount === 1)).toBeTruthy();

    await returnToMenu(page);
    await startTeamHuntSplitMatch(page);
    const secondRun = await page.evaluate(readHealthAuraProbe);
    expect(secondRun.error).toBeNull();
    expect([secondRun.first, secondRun.second, secondRun.bot].every((entry) => entry.auraRootCount === 1)).toBeTruthy();
});
