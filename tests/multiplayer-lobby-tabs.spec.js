import { test, expect } from '@playwright/test';
import { loadGame, openMultiplayerSubmenu } from './helpers.js';

// Both tests need a second tab in the same browser context (`page.context().newPage()`).
// Electron answers that CDP call with "Target.createTarget: Not supported", so these tests
// can never run in a desktop profile. They live in their own spec so the `network` cluster
// can run them in the `browser-compat` profile against the Vite dev server, and so a red
// T20d1 no longer aborts the serial chain of `core-targeted-platform.spec.js`.
const REQUIRED_RUN_PROFILE = 'browser-compat';

// The wrapper scripts pin PW_RUN_PROFILE via applyPlaywrightRunProfileEnv()
// (scripts/playwright-run-profile.mjs), so the worker process can read the active profile.
function assertTwoTabProfile() {
    const activeProfile = String(process.env.PW_RUN_PROFILE || '').trim() || '(nicht gesetzt)';
    if (activeProfile === REQUIRED_RUN_PROFILE) return;
    throw new Error(
        `Zwei-Tab-Tests laufen nur im Profil ${REQUIRED_RUN_PROFILE}, aktiv ist "${activeProfile}". `
        + 'Electron beantwortet page.context().newPage() mit "Target.createTarget: Not supported". '
        + 'Start: node scripts/run-playwright-browser-contract.mjs tests/multiplayer-lobby-tabs.spec.js '
        + '(Cluster: node scripts/run-playwright-targeted-clusters.mjs network).'
    );
}

test.describe('T20d1-T20d2: Multiplayer-Lobby ueber zwei Tabs', () => {
    // The guard sits in every test instead of a beforeAll hook: a failing beforeAll would
    // leave the second test as "did not run", and this file deliberately has no serial chain.
    test('T20d1: Multiplayer-Lobby synchronisiert Join, Ready und Host-Invalidation ueber zwei Tabs', async ({ page }) => {
        assertTwoTabProfile();
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
            globalThis.__CURVIOS_E2E_LOBBY_TRANSPORT__ = 'storage-bridge';
        });
        const secondPage = await page.context().newPage();
        try {
            await loadGame(page);
            await loadGame(secondPage);

            const hostMultiplayerActive = await openMultiplayerSubmenu(page);
            await page.fill('#multiplayer-lobby-code', 'SYNC-LOBBY');
            await page.click('[data-connection-intent-target="host"]');
            await page.click('#btn-multiplayer-host');
            await page.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

            const clientMultiplayerActive = await openMultiplayerSubmenu(secondPage);
            expect(hostMultiplayerActive && clientMultiplayerActive, 'Multiplayer-Surface muss in beiden Tabs aktiv sein.').toBe(true);
            await secondPage.fill('#multiplayer-lobby-code', 'SYNC-LOBBY');
            await secondPage.click('#btn-multiplayer-join');
            await secondPage.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });
            await secondPage.check('#multiplayer-ready-toggle');

            await page.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.memberCount === 2 && state?.readyCount === 2;
            }, null, { timeout: 5000 });

            const syncedState = await page.evaluate(() => ({
                sessionState: window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.(),
                lobbyStateText: document.getElementById('multiplayer-lobby-state')?.textContent || '',
            }));
            expect(syncedState.sessionState?.isHost).toBeTruthy();
            expect(syncedState.sessionState?.memberCount).toBe(2);
            expect(syncedState.sessionState?.readyCount).toBe(2);
            expect(syncedState.lobbyStateText).toContain('2 Spieler auf 2 Gerät(en)');
            await expect(page.locator('#multiplayer-member-list .mp-player-card')).toHaveCount(2);

            await page.evaluate(() => {
                const slider = document.getElementById('bot-count');
                slider.value = '4';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });

            await secondPage.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.joined === true && state?.localReady === false && state?.readyCount === 1;
            }, null, { timeout: 5000 });

            const invalidatedState = await secondPage.evaluate(() => ({
                sessionState: window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.(),
                readyChecked: !!document.getElementById('multiplayer-ready-toggle')?.checked,
            }));
            expect(invalidatedState.sessionState?.role).toBe('client');
            expect(invalidatedState.sessionState?.localReady).toBeFalsy();
            expect(invalidatedState.readyChecked).toBeFalsy();
        } finally {
            await secondPage.close();
        }
    });

    test('T20d2: Multiplayer-Host startet Match synchron mit autoritativem Snapshot ueber zwei Tabs', async ({ page }) => {
        assertTwoTabProfile();
        test.setTimeout(120000);
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
            globalThis.__CURVIOS_E2E_LOBBY_TRANSPORT__ = 'storage-bridge';
        });
        const secondPage = await page.context().newPage();
        try {
            await loadGame(page);
            await loadGame(secondPage);

            const hostMultiplayerActive = await openMultiplayerSubmenu(page);
            await page.fill('#multiplayer-lobby-code', 'START-LOBBY');
            await page.click('[data-connection-intent-target="host"]');
            await page.click('#btn-multiplayer-host');
            await page.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

            // The map picker lives in the match setup screen, which the host reaches from the
            // lobby through "Match aendern" and leaves again through "Zur Lobby".
            await page.click('#btn-lobby-edit-match');
            await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
            const selectedMapKey = await page.evaluate(() => {
                const select = document.getElementById('map-select');
                if (!(select instanceof HTMLSelectElement)) return null;
                const mapKeys = Array.from(select.options)
                    .map((option) => String(option.value || '').trim())
                    .filter((value) => value && value !== 'custom');
                return mapKeys.includes('maze') ? 'maze' : (mapKeys[0] || null);
            });
            expect(selectedMapKey).toBeTruthy();
            await page.selectOption('#map-select', String(selectedMapKey));
            await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, String(selectedMapKey), { timeout: 5000 });
            await page.click('#btn-setup-lobby');
            await page.waitForSelector('#submenu-multiplayer:not(.hidden)', { timeout: 5000 });

            const clientMultiplayerActive = await openMultiplayerSubmenu(secondPage);
            expect(hostMultiplayerActive && clientMultiplayerActive, 'Multiplayer-Surface muss in beiden Tabs aktiv sein.').toBe(true);
            await secondPage.fill('#multiplayer-lobby-code', 'START-LOBBY');
            await secondPage.click('#btn-multiplayer-join');
            await secondPage.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

            await secondPage.check('#multiplayer-ready-toggle');

            await page.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.canStart === true && state?.allReady === true;
            }, null, { timeout: 5000 });

            await page.click('#btn-multiplayer-start');

            await page.waitForFunction(() => {
                const game = window.GAME_INSTANCE;
                return game?.state === 'PLAYING' && !!game?.entityManager;
            }, null, { timeout: 30000 });
            await secondPage.waitForFunction((mapKey) => {
                const game = window.GAME_INSTANCE;
                return game?.state === 'PLAYING' && game?.settings?.mapKey === mapKey && !!game?.entityManager;
            }, String(selectedMapKey), { timeout: 30000 });

            const secondProbe = await secondPage.evaluate(() => ({
                state: window.GAME_INSTANCE?.state,
                mapKey: window.GAME_INSTANCE?.settings?.mapKey,
                hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
            }));
            expect(secondProbe.state).toBe('PLAYING');
            expect(secondProbe.mapKey).toBe(String(selectedMapKey));
            expect(secondProbe.hudVisible).toBeTruthy();
        } finally {
            await secondPage.close();
        }
    });
});
