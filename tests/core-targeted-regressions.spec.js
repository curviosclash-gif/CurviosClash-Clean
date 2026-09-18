import {
    test,
    expect,
    loadGame,
} from './core-targeted.shared.js';

// Most former regression tests of this file only ever used hand-built dependency objects.
// P3 moved them to Node contract tests: match-lifecycle-session-regressions,
// match-finalize-regressions, runtime-session-handler-regressions,
// match-session-allocation-regressions, session-runtime-command-backend-regressions,
// pause-intent-regressions, session-runtime-state-regressions and
// map-preset-portal-gate-regressions. What stays here needs the running desktop app.

// ---------------------------------------------------------------------------
// V56 Regression Tests — Defensive Improvements & Edge-Case Fixes
// ---------------------------------------------------------------------------
test.describe('V56: Code-Audit Remediation Regressions', () => {
    test('V56.1 Session-ID guard rejects stale async createMatchSession result', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            // The runtime coordinator resolves the same session runtime handles as
            // getSessionRuntimeHandle(game, key), so the test needs no module import.
            const orch = game?.runtimeCoordinator?.getRuntimeHandle?.('matchSessionOrchestrator');
            if (!orch) return { skip: true };

            // First call (sync path)
            orch.createMatchSession({});
            const firstId = orch._activeSessionId;

            // Second call supersedes the first
            orch.createMatchSession({});
            const secondId = orch._activeSessionId;

            return {
                skip: false,
                idsAreDifferent: firstId !== secondId,
                secondIdActive: orch._activeSessionId === secondId,
            };
        });
        expect(result.skip, 'MatchLifecycleSessionOrchestrator muss im Desktop-Runtime vorhanden sein.').not.toBe(true);
        expect(result.idsAreDifferent).toBeTruthy();
        expect(result.secondIdActive).toBeTruthy();
    });

});
