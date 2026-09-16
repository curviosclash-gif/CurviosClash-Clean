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

test('network clients ignore local entity round-end callbacks', async () => {
    const harness = createHarness({ network: true, host: false });
    const handlers = await harness.start();
    handlers.onRoundEnd({ name: 'Client' }, { reason: 'ELIMINATION' });
    assert.deepEqual(harness.roundEnds, []);
});

test('network hosts and offline matches retain local round-end handling', async () => {
    for (const options of [{ network: true, host: true }, { network: false, host: false }]) {
        const harness = createHarness(options);
        const handlers = await harness.start();
        handlers.onRoundEnd({ name: 'Winner' }, { reason: 'ELIMINATION' });
        assert.equal(harness.roundEnds.length, 1);
    }
});
