import assert from 'node:assert/strict';
import test from 'node:test';

import { BotAI } from '../src/entities/Bot.js';

test('BotAI clears expired bounce, recovery-chain, and portal intent state', () => {
    const bot = new BotAI();
    bot._bounceStreak = 3;
    bot._bounceStreakTimer = 0.01;
    bot._recoveryChainCount = 2;
    bot._recoveryChainTimer = 0.01;
    bot._lastRecoveryReason = 'wall';
    bot.state.portalIntentActive = true;
    bot.state.portalIntentTimer = 0.01;
    bot.state.portalIntentScore = 4;
    bot._portalTarget = { id: 'portal-1' };

    bot._updateTimers(0.02);

    assert.equal(bot._bounceStreakTimer, 0);
    assert.equal(bot._bounceStreak, 0);
    assert.equal(bot._recoveryChainTimer, 0);
    assert.equal(bot._recoveryChainCount, 0);
    assert.equal(bot._lastRecoveryReason, '');
    assert.equal(bot.state.portalIntentTimer, 0);
    assert.equal(bot.state.portalIntentActive, false);
    assert.equal(bot.state.portalIntentScore, 0);
    assert.equal(bot._portalTarget, null);
});
