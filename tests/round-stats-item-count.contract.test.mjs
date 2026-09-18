import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundRecorder } from '../src/state/RoundRecorder.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';

const PLAYERS = [
    { index: 0, isBot: false, score: 0 },
    { index: 1, isBot: true, score: 0 },
];

// One Fight round: the trigger was held for 400 frames, two items were used and one fired;
// a rocket key pressed with an empty rack and an item on cooldown were refused.
function recordRound() {
    const recorder = new RoundRecorder();
    recorder.startMatch?.();
    recorder.startRound(PLAYERS);
    for (let i = 0; i < 400; i++) {
        recorder.logEvent('ITEM_USE', 0, 'mode=mg type=MG_BULLET code=mg.fire.success ok=1');
    }
    recorder.logEvent('ITEM_USE', 0, 'mode=use type=SHIELD code=item.use.success ok=1');
    recorder.logEvent('ITEM_USE', 0, 'mode=use type=HEALTH code=item.use.success ok=1');
    recorder.logEvent('ITEM_USE', 0, 'mode=shoot type=ROCKET_WEAK code=item.shoot.success ok=1');
    recorder.logEvent('ITEM_USE', 0, 'mode=shoot type=UNKNOWN code=item.shoot.empty ok=0');
    recorder.logEvent('ITEM_USE', 0, 'mode=use type=UNKNOWN code=item.use.cooldown ok=0');
    return recorder;
}

function readRow(summary, blockId, rowKey) {
    return summary?.blocks?.find((block) => block.id === blockId)?.rows?.find((row) => row.key === rowKey)?.value ?? null;
}

function endRound(recorder) {
    return coordinateRoundEnd({
        recorder,
        winner: PLAYERS[0],
        players: PLAYERS.map((player) => ({ ...player })),
        roundStateController: {
            deriveOnRoundEndPlan: () => ({ outcome: { state: 'ROUND_END', requiredWins: 2 }, transition: {} }),
        },
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 2,
        outcomeReason: 'KILL_LIMIT',
        logger: { log() {} },
    });
}

test('the round result overlay counts used items, not machine gun trigger frames', () => {
    const recorder = recordRound();
    const result = endRound(recorder);

    // v2 carries raw numbers, so the board can show "3" and a tooltip can show "3,0".
    assert.equal(readRow(result.statsSummary, 'round', 'item-uses'), 3);
    assert.equal(readRow(result.statsSummary, 'match', 'item-use-per-round'), 3);
});

test('the raw telemetry count stays untouched by the overlay figure', () => {
    const recorder = recordRound();
    endRound(recorder);

    assert.equal(recorder.getLastRoundMetrics().itemUseEvents, 405);
});
