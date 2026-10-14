import { expect, test } from './helpers.desktop.js';
import { chooseMenuModePath, openStartSetupSection, returnToMenu, selectSessionType, waitForLoadedGame } from './helpers.js';
import { ARCADE_RANKED_STORAGE_KEY, ARCADE_RANKED_VERSION } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';

const LEGACY_KEY = 'gauntlet:arcade-score.v3:normal:1-5';
const CURRENT_KEY = 'gauntlet:arcade-score.v4:normal:1-5';

async function openArcade(page) {
    await returnToMenu(page);
    await selectSessionType(page, 'single');
    await chooseMenuModePath(page, 'arcade');
    await openStartSetupSection(page, 'arcade');
}

async function playUntilEliminated(page) {
    await page.locator('#btn-arcade-start-inline').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 30_000 });
    // Let ordinary flight, collisions and enemies end the run; do not inject health or round outcomes.
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?.arcadeRunRuntime;
        return runtime?.getStateSnapshot?.()?.postRunSummary?.aborted === false
            && runtime?.getPhase?.() === 'finished';
    }, null, { timeout: 120_000 });
    return page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime;
        return { context: runtime.rankContext, summary: runtime.getStateSnapshot().postRunSummary };
    });
}

async function readBoard(page, profileId) {
    return page.evaluate(({ id, key }) => window.GAME_INSTANCE.playerProfileManager
        .getRecordStorePort(id).readJsonRecordResult(key), { id: profileId, key: ARCADE_RANKED_STORAGE_KEY });
}

test('a real standard Arcade run writes only v4 scores and a custom run preserves both boards', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await waitForLoadedGame(page);
    const profileId = await page.evaluate(() => window.GAME_INSTANCE.playerProfileManager.getActiveProfile().id);
    const legacy = { runId: 'legacy-v3-sentinel', vehicleId: 'ship5', vehicleLevel: 1,
        tierId: 'normal', scoreModel: 'arcade-score.v3', score: 900, date: '2025-01-01T00:00:00.000Z' };
    const seeded = await page.evaluate(({ id, key, version, boardKey, row }) => window.GAME_INSTANCE.playerProfileManager
        .getRecordStorePort(id).saveJsonRecord(key, { schemaVersion: version, boards: { [boardKey]: [row] } }),
    { id: profileId, key: ARCADE_RANKED_STORAGE_KEY, version: ARCADE_RANKED_VERSION, boardKey: LEGACY_KEY, row: legacy });
    expect(seeded === true || seeded?.success === true || seeded?.ok === true).toBe(true);

    await openArcade(page);
    const standard = await playUntilEliminated(page);
    expect(standard.context.ranked).toBe(true);
    expect(standard.context.scoreModel).toBe('arcade-score.v4');
    expect(standard.summary.ranking.key).toBe(CURRENT_KEY);
    expect(standard.summary.aborted).toBe(false);
    expect(standard.summary.succeeded).toBe(false);
    expect(standard.summary.completedSectors).toBeLessThan(5);
    const afterStandard = await readBoard(page, profileId);
    expect(afterStandard.status).toBe('found');
    expect(afterStandard.value.boards[LEGACY_KEY]).toEqual([legacy]);
    expect(afterStandard.value.boards[CURRENT_KEY]).toHaveLength(1);
    expect(afterStandard.value.boards[CURRENT_KEY][0]).toMatchObject({ runId: standard.context.runId, scoreModel: 'arcade-score.v4', score: standard.summary.score });
    await page.screenshot({ path: testInfo.outputPath('ranked-v4-result.png') });

    await openArcade(page);
    await openStartSetupSection(page, 'match');
    await page.locator('details.start-inline-advanced > summary').click();
    await page.locator('#arcade-sector-count').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#arcade-sector-count')).toHaveValue('4');
    await openStartSetupSection(page, 'arcade');
    const custom = await playUntilEliminated(page);
    expect(custom.context.ranked).toBe(false);
    expect(custom.context.customSettings).toBe(true);
    expect(custom.summary.ranking).toBeNull();
    expect(custom.summary.succeeded).toBe(false);
    expect((await readBoard(page, profileId)).value).toEqual(afterStandard.value);
    await page.screenshot({ path: testInfo.outputPath('custom-unranked-result.png') });
    await testInfo.attach('ranking-persistence', { body: JSON.stringify({ standard, custom, stored: afterStandard.value }, null, 2), contentType: 'application/json' });
});
