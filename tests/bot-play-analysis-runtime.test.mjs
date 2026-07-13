import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BotPlayAnalysisService,
    buildBotPlayAnalysisReport,
} from '../src/state/validation/BotPlayAnalysisService.js';
import { RoundRecorder } from '../src/state/RoundRecorder.js';

function createRound(overrides = {}) {
    return {
        duration: 6,
        winnerIsBot: false,
        botCount: 1,
        botSurvivalAverage: 4,
        bounceWallEvents: 1,
        bounceTrailEvents: 0,
        stuckEvents: 1,
        ...overrides,
    };
}

test('buildBotPlayAnalysisReport flags weak survival and stuck pressure', () => {
    const report = buildBotPlayAnalysisReport([
        createRound(),
        createRound({ winnerIsBot: true, botSurvivalAverage: 5, stuckEvents: 0 }),
    ]);

    assert.equal(report.metrics.rounds, 2);
    assert.ok(report.findings.some((finding) => finding.id === 'survival-low'));
    assert.ok(report.findings.some((finding) => finding.id === 'stuck-rate'));
});

test('BotPlayAnalysisService emits automatically after configured bot rounds', () => {
    const recorder = new RoundRecorder();
    let emitted = null;
    const service = new BotPlayAnalysisService({
        roundInterval: 2,
        minRounds: 1,
        logger: { info() {} },
        onReport(report) {
            emitted = report;
        },
    });

    recorder.onRoundFinalized((_round, sourceRecorder) => service.handleRoundFinalized(sourceRecorder));
    recorder.startRound([{ index: 1, isBot: true }]);
    recorder.finalizeRound(null, [{ index: 1, isBot: true }]);
    assert.equal(emitted, null);

    recorder.startRound([{ index: 1, isBot: true }]);
    recorder.finalizeRound(null, [{ index: 1, isBot: true }]);

    assert.ok(emitted);
    assert.equal(service.getStatus().hasReport, true);
});
