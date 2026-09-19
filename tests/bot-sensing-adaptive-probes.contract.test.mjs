import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseReducedProbeScan } from '../src/entities/ai/BotSensingOps.js';

test('bot sensing keeps full probe scans on their assigned frame', () => {
    const lookAhead = 20;

    assert.equal(shouldUseReducedProbeScan({
        immediateDanger: false,
        forwardRisk: 0.1,
        localOpenness: 18,
        lookAhead,
    }, true), true);

    assert.equal(shouldUseReducedProbeScan({
        immediateDanger: false,
        forwardRisk: 0.1,
        localOpenness: 10,
        lookAhead,
    }, true), false, 'tight space must receive the complete probe set on a full-scan frame');

    assert.equal(shouldUseReducedProbeScan({
        immediateDanger: false,
        forwardRisk: 0.4,
        localOpenness: 18,
        lookAhead,
    }, true), false, 'forward risk must receive the complete probe set on a full-scan frame');

    assert.equal(shouldUseReducedProbeScan({
        immediateDanger: true,
        forwardRisk: 0,
        localOpenness: 20,
        lookAhead,
    }, true), false, 'immediate danger must receive the complete probe set on a full-scan frame');

    assert.equal(shouldUseReducedProbeScan({
        immediateDanger: true,
        forwardRisk: 1,
        localOpenness: 0,
        lookAhead,
    }, false), true, 'non-assigned frames remain time-sliced');
});
