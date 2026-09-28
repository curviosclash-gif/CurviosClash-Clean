import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu } from './helpers.js';

// Paket 1 "Arcade-Hangar: Fahrzeugrollen": each factory ship starts a normal arcade
// run with its balance-table values; the HUD shows both storages in their own size.
const CASES = [
    { vehicleId: 'manta', maxHp: 150, itemCapacity: 7, rocketCapacity: 8, speedPct: 80, turnPct: 75 },
    { vehicleId: 'drone', maxHp: 70, itemCapacity: 3, rocketCapacity: 2, speedPct: 115, turnPct: 130 },
];

for (const expected of CASES) {
    test(`T-ARC-R1: ${expected.vehicleId} starts a gauntlet run with its table values`, async ({ page }) => {
        await waitForLoadedGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', 'standard');
        await page.evaluate((vehicleId) => {
            const game = window.GAME_INSTANCE;
            game.settings.vehicles.PLAYER_1 = vehicleId;
            Object.assign(game.settings.arcade, { runType: 'gauntlet', dailyChallenge: false, sectorCount: 2, seed: 7 });
            game.settings.numBots = 1;
            const botSlider = document.getElementById('bot-count');
            if (botSlider) botSlider.value = '1';
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count', 'arcade.runType', 'arcade.sectorCount'] });
        }, expected.vehicleId);
        await page.click('#btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
            && window.GAME_INSTANCE?.entityManager?.humanPlayers?.[0]?.alive === true, null, { timeout: 60000 });
        await page.waitForFunction(() => document.querySelectorAll('.rocket-bar .item-slot').length > 0);

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const em = game.entityManager;
            const human = em.humanPlayers[0];
            const strategy = em.gameModeStrategy;
            const settingsSpeed = Number(human._arcadeBaseSpeed);
            const bot = em.bots[0]?.player || null;
            const itemBar = game.ui?.p1Items;
            return {
                vehicleId: human.vehicleId,
                maxHp: human.maxHp,
                itemCapacity: human.itemCapacity,
                rocketCapacity: human.rocketCapacity,
                speedPct: Math.round((human.baseSpeed / settingsSpeed) * 100),
                // Sector modifiers (e.g. tight_turns) scale the turn rate on top of the vehicle value.
                turnPct: Math.round(strategy.getTurnRateMultiplier(human)
                    / (strategy._getAggregatedModifierEffects()?.turnRateMultiplier || 1) * 100),
                hudItemSlots: itemBar ? itemBar.querySelectorAll('.item-slot').length : -1,
                hudRocketSlots: document.querySelectorAll('.rocket-bar .item-slot').length,
                bot: bot ? { vehicleId: bot.vehicleId, itemCapacity: bot.itemCapacity, rocketCapacity: bot.rocketCapacity } : null,
            };
        });
        console.log(`[arcade-roles] ${JSON.stringify(state)}`);
        expect(state).toMatchObject({
            vehicleId: expected.vehicleId,
            maxHp: expected.maxHp,
            itemCapacity: expected.itemCapacity,
            rocketCapacity: expected.rocketCapacity,
            speedPct: expected.speedPct,
            turnPct: expected.turnPct,
            hudItemSlots: expected.itemCapacity,
            hudRocketSlots: expected.rocketCapacity,
        });
        expect(state.bot, 'bot present').not.toBeNull();
        expect(state.bot.itemCapacity).toBeGreaterThan(0);
        expect(state.bot.rocketCapacity).toBeGreaterThan(0);
    });
}
