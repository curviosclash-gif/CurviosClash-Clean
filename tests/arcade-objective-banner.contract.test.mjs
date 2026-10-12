// The fight HUD headline in Arcade must name the sector's own goal. The desktop playtest of
// 06.10.2026 showed "Elimination · letzter Überlebender gewinnt" in worm, flood, bomber, breakout
// and hydra sectors and in solo portal runs, where nobody has to be the last one alive.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCADE_SCENARIOS } from '../src/entities/directors/ArcadeScenarioCatalog.js';
import { PORTAL_CHAINS } from '../src/shared/contracts/PortalChainContract.js';
import { resolveHuntObjectiveText } from '../src/ui/HuntMatchStatusHelpers.js';

const ELIMINATION = 'Elimination · letzter Überlebender gewinnt';
const DETAILS = { killLimit: 10, timeText: '', matchPointText: '' };

test('Jedes Arcade-Szenario nennt sein eigenes Ziel statt Elimination', () => {
    for (const scenario of ARCADE_SCENARIOS) {
        const config = { session: { activeGameMode: 'ARCADE' }, arcade: { scenarioId: scenario.id } };
        const text = resolveHuntObjectiveText({}, config, DETAILS);
        assert.notEqual(text, ELIMINATION, scenario.id);
        assert.ok(text.length > 0, scenario.id);
    }
});

test('Portal-Laeufe nennen ihre Kette statt Elimination', () => {
    for (const chain of Object.values(PORTAL_CHAINS)) {
        const config = { session: { activeGameMode: 'ARCADE' }, arcade: { enabled: true, runType: 'five_portals', portalChainId: chain.id } };
        assert.match(resolveHuntObjectiveText({}, config, DETAILS), new RegExp(`^${chain.label} · `));
    }
});

test('Ein normaler Fight ohne Respawn bleibt Elimination', () => {
    const config = { session: { activeGameMode: 'HUNT' }, arcade: { scenarioId: 'hydra_finale' } };
    assert.equal(resolveHuntObjectiveText({}, config, DETAILS), ELIMINATION);
});
