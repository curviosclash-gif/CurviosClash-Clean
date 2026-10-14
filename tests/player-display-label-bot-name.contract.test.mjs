import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BOT_DISPLAY_NAME_MAX_LENGTH,
    PLAYER_LABEL_STYLES,
    formatPlayerDisplayLabel,
    normalizeBotDisplayName,
} from '../src/shared/contracts/PlayerDisplayLabelContract.js';

test('a bot without a display name keeps the seat label exactly', () => {
    assert.equal(formatPlayerDisplayLabel({ isBot: true, index: 2 }), 'Bot 3');
    assert.equal(formatPlayerDisplayLabel({ isBot: true, index: 2, botDisplayName: '   ' }), 'Bot 3');
    assert.equal(formatPlayerDisplayLabel({ isBot: true, index: 0, botDisplayName: 42 }), 'Bot 1');
    assert.equal(formatPlayerDisplayLabel({ isBot: true, index: 1, name: 'Spieler 9' }), 'Bot 2',
        'the lobby name field still cannot rename a bot');
});

test('a bot with a display name shows that name in every style', () => {
    const rival = { isBot: true, index: 1, botDisplayName: 'Nemesis' };
    assert.equal(formatPlayerDisplayLabel(rival), 'Nemesis');
    assert.equal(formatPlayerDisplayLabel(rival, { style: PLAYER_LABEL_STYLES.LONG }), 'Nemesis');
    assert.equal(formatPlayerDisplayLabel({ ...rival, index: 3 }), 'Nemesis', 'a spread copy keeps the name');
});

test('the bot display name is normalized: no markup, no control characters, bounded length', () => {
    assert.equal(normalizeBotDisplayName('  Die   <b>Füchsin</b>\n'), 'Die bFüchsin/b');
    assert.equal(normalizeBotDisplayName('a\u0000b\u001fc'), 'abc');
    const long = normalizeBotDisplayName('X'.repeat(80));
    assert.equal(long.length, BOT_DISPLAY_NAME_MAX_LENGTH);
    assert.equal(normalizeBotDisplayName(null), '');
    assert.equal(normalizeBotDisplayName('<>'), '');
    assert.equal(formatPlayerDisplayLabel({ isBot: true, index: 4, botDisplayName: '<>' }), 'Bot 5');
});

test('humans ignore the bot display name field', () => {
    assert.equal(formatPlayerDisplayLabel({ isBot: false, index: 0, botDisplayName: 'Nemesis' }), 'P1');
});
