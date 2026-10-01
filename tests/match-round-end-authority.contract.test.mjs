import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchStartRuntimeService } from '../src/core/runtime/MatchStartRuntimeService.js';

function createHarness({ network = false, host = true } = {}) {
    const roundEnds = [];
    let handlers = null;
    const facade = {
        isNetworkSession: () => network,
        isHost: () => host,
        getPorts: () => ({
            matchUiPort: {
                prepareMatchStartProjection: () => true,
                configureMatchInputSources() {},
                startRound() {},
                onRoundEnd: (winner, outcome) => roundEnds.push({ winner, outcome }),
            },
            lifecyclePort: { initializeSession: () => true },
        }),
        getRuntimeHandle: () => ({
            createMatchSession: (nextHandlers) => {
                handlers = nextHandlers;
                return { ok: true };
            },
        }),
    };
    return {
        roundEnds,
        async start() {
            assert.equal(await new MatchStartRuntimeService({ facade }).execute(), true);
            return handlers;
        },
    };
}

// A client's own outcome evaluation is suppressed in RoundOutcomeSystem (see
// network-client-round-end.contract.test.mjs), so a round end that reaches this handler on a
// client is the host's. Dropping it here left the kernel on round_end while the game stayed
// PLAYING, which froze the client at the first round end.
test('network clients forward the host round end to the match UI', async () => {
    const harness = createHarness({ network: true, host: false });
    const handlers = await harness.start();
    handlers.onRoundEnd({ name: 'Host winner' }, { reason: 'KILL_LIMIT' });
    assert.equal(harness.roundEnds.length, 1);
});

test('network hosts and offline matches retain local round-end handling', async () => {
    for (const options of [{ network: true, host: true }, { network: false, host: false }]) {
        const harness = createHarness(options);
        const handlers = await harness.start();
        handlers.onRoundEnd({ name: 'Winner' }, { reason: 'ELIMINATION' });
        assert.equal(harness.roundEnds.length, 1);
    }
});
