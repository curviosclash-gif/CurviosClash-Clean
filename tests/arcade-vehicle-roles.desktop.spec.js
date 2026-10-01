import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu } from './helpers.js';
import {
    VEHICLE_LAB_CATALOG_STORAGE_KEY,
    saveVehicleLabCatalog,
    upsertVehicleLabCatalogVehicle,
} from '../src/shared/contracts/VehicleLabConfigContract.js';

// Paket 1 "Arcade-Hangar: Fahrzeugrollen": each factory ship starts a normal arcade
// run with its balance-table values; the HUD shows both storages in their own size.
const CASES = [
    { vehicleId: 'manta', maxHp: 150, itemCapacity: 7, rocketCapacity: 8, speedPct: 80, turnPct: 75 },
    { vehicleId: 'drone', maxHp: 70, itemCapacity: 3, rocketCapacity: 2, speedPct: 115, turnPct: 130 },
];

const FACTORY_VEHICLE_IDS = ['ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor'];

async function startGauntlet(page, vehicleId) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'standard');
    await page.evaluate((id) => {
        const game = window.GAME_INSTANCE;
        game.settings.vehicles.PLAYER_1 = id;
        Object.assign(game.settings.arcade, { runType: 'gauntlet', dailyChallenge: false, sectorCount: 2, seed: 7 });
        game.settings.numBots = 1;
        const botSlider = document.getElementById('bot-count');
        if (botSlider) botSlider.value = '1';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count', 'arcade.runType', 'arcade.sectorCount'] });
    }, vehicleId);
    await page.click('#btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.[0]?.alive === true, null, { timeout: 60000 });
}

for (const expected of CASES) {
    test(`T-ARC-R1: ${expected.vehicleId} starts a gauntlet run with its table values`, async ({ page }) => {
        await startGauntlet(page, expected.vehicleId);
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

// Paket 1 (Korrektur): base regeneration of normal runs on the simulation clock.
test('T-ARC-R2: gauntlet heals about 2 % max HP per second once 3 s passed since the last hit', async ({ page }) => {
    test.setTimeout(120_000);
    await startGauntlet(page, 'manta');
    const hit = await page.evaluate(() => {
        const em = window.GAME_INSTANCE.entityManager;
        const human = em.humanPlayers[0];
        const strategy = em.gameModeStrategy;
        strategy.setActiveModifier(null); // a heat_stress sector would drain instead of heal
        strategy.applyDamage(human, 40, { ignoreShield: true });
        human.spawnProtectionTimer = 999; // no further weapon, wall or trail hits during the measurement
        return { hp: human.hp, maxHp: human.maxHp, stamp: human.lastDamageTimestamp, clockMs: em._simulationClockMs };
    });
    expect(hit.maxHp).toBe(150);
    expect(hit.stamp * 1000).toBeCloseTo(hit.clockMs, -1);
    const readAfter = async (clockMs) => {
        await page.waitForFunction((target) => window.GAME_INSTANCE.entityManager._simulationClockMs >= target, clockMs, { timeout: 30_000 });
        return page.evaluate(() => {
            const em = window.GAME_INSTANCE.entityManager;
            const human = em.humanPlayers[0];
            return { hp: human.hp, stamp: human.lastDamageTimestamp, clockMs: em._simulationClockMs };
        });
    };
    const waiting = await readAfter(hit.clockMs + 2000);
    expect(waiting.hp, 'no regeneration within the 3 s delay').toBe(hit.hp);
    const first = await readAfter(hit.clockMs + 3500);
    const second = await readAfter(first.clockMs + 2000);
    const rate = (second.hp - first.hp) / ((second.clockMs - first.clockMs) / 1000);
    console.log(`[arcade-regen] ${JSON.stringify({ hit, waiting, first, second, rate })}`);
    expect(second.stamp, 'no other hit during the measurement').toBe(hit.stamp);
    expect(second.hp).toBeLessThan(hit.maxHp);
    expect(Math.abs(rate - 0.02 * hit.maxHp)).toBeLessThan(0.02 * hit.maxHp * 0.15);
});

test('T-ARC-R2: Arcade offers only the factory ships and starts a stored Lab build as Star-Cruiser', async ({ page }) => {
    test.setTimeout(180_000);
    let labRecord = '';
    const lab = upsertVehicleLabCatalogVehicle(null, { label: 'T-ARC-R2 Lab', parts: [{ name: 'Rumpf', geo: 'box', role: 'core' }] });
    saveVehicleLabCatalog(lab.record, { setItem: (_key, value) => { labRecord = value; } });
    await waitForLoadedGame(page);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: VEHICLE_LAB_CATALOG_STORAGE_KEY, value: labRecord });
    try {
        await page.reload();
        await waitForLoadedGame(page);
        // Earlier tests leave the menu on the Arcade path, so pick Classic explicitly.
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await expect(page.locator(`#vehicle-select-p1 option[value="${lab.vehicle.id}"]`), 'Classic keeps the Lab build').toHaveCount(1);
        await page.click('#submenu-game [data-back]');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await expect(page.locator(`#vehicle-select-p1 option[value="${lab.vehicle.id}"]`), 'the Arcade menu offers only the factory ships').toHaveCount(0);

        await page.goto(new URL('/hangar.html?mode=arcade', page.url()).href);
        await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 10_000 });
        const cardIds = await page.locator('#arcade-vehicle-manager .arcade-vehicle-card').evaluateAll((cards) => cards.map((card) => card.dataset.vehicleId));
        expect([...cardIds].sort()).toEqual([...FACTORY_VEHICLE_IDS].sort());
        await expect(page.locator('#arcade-vehicle-manager .arcade-vehicle-card[data-vehicle-role="tank"]')).toHaveCount(2);

        await page.goto(new URL('/', page.url()).href);
        await startGauntlet(page, lab.vehicle.id);
        const vehicleId = await page.evaluate(() => window.GAME_INSTANCE.entityManager.humanPlayers[0].vehicleId);
        expect(vehicleId, 'a stored Lab build falls back to the Star-Cruiser in Arcade').toBe('ship5');
    } finally {
        await page.evaluate((key) => localStorage.removeItem(key), VEHICLE_LAB_CATALOG_STORAGE_KEY).catch(() => {});
    }
});
