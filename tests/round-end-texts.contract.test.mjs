// Guards the German wording of every round-end and match-end message.
//
// The board is the last thing a player reads after a match, so it has to be proper German:
// real umlauts instead of "ae/oe/ue", full sentences instead of "Sieg: Spieler 1 (Score: 3)"
// and German words instead of English placeholders like "Rewards" or "Peak-Multi".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deriveRoundEndOutcome } from '../src/state/RoundStateOps.js';
import { deriveRoundEndTickStep } from '../src/state/RoundStateControllerOps.js';
import { deriveRoundEndCountdownUiState } from '../src/shared/contracts/MatchUiStateContract.js';

const GAME_STATE_MATCH_END = 'MATCH_END';
const GAME_STATE_ROUND_END = 'ROUND_END';

function makePlayer(index, score, isBot = false) {
    return { index, score, isBot };
}

test('match end names the winner in a full sentence', () => {
    const players = [makePlayer(0, 3), makePlayer(1, 1, true)];
    const outcome = deriveRoundEndOutcome(players, {
        winner: players[0],
        reason: 'ELIMINATION',
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 3,
    });

    assert.equal(outcome.state, GAME_STATE_MATCH_END);
    assert.equal(outcome.messageText, 'Spieler 1 gewinnt das Match');
    assert.match(outcome.messageSub, /^3 : 1 Runden/);
});

test('match end works for a bot winner and leaves the key hints to the board', () => {
    const players = [makePlayer(0, 0), makePlayer(1, 2, true), makePlayer(2, 1, true)];
    const outcome = deriveRoundEndOutcome(players, {
        winner: players[1],
        reason: 'ELIMINATION',
        humanPlayerCount: 1,
        totalBots: 2,
        winsNeeded: 2,
    });

    assert.equal(outcome.messageText, 'Bot 2 gewinnt das Match');
    assert.equal(outcome.messageSub, '2 : 1 Runden');
    // The continue prompt on the board shows the keys (P7c); the subtitle must not repeat them.
    assert.ok(!outcome.messageSub.includes('ENTER'), 'no key hint in the subtitle');
});

test('round end and draw keep short german sentences', () => {
    const players = [makePlayer(0, 1), makePlayer(1, 0, true)];
    const roundEnd = deriveRoundEndOutcome(players, {
        winner: players[0],
        reason: 'ELIMINATION',
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 3,
    });
    assert.equal(roundEnd.state, GAME_STATE_ROUND_END);
    assert.equal(roundEnd.messageText, 'Spieler 1 gewinnt die Runde');
    assert.equal(roundEnd.messageSub, 'Nächste Runde in 3...');

    const draw = deriveRoundEndOutcome(players, {
        winner: null,
        reason: 'ELIMINATION',
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 3,
    });
    assert.equal(draw.messageText, 'Unentschieden');
    assert.equal(draw.messageSub, 'Nächste Runde in 3...');
});

test('team objective results name the team and ignore departed match winners', () => {
    const players = [
        { ...makePlayer(0, 3), teamId: 'ALPHA', entitySlotActive: false },
        { ...makePlayer(1, 3), teamId: 'ALPHA', entitySlotActive: true },
        { ...makePlayer(2, 1), teamId: 'BRAVO', entitySlotActive: true },
    ];
    const outcome = deriveRoundEndOutcome(players, {
        winner: players[1],
        winnerTeamId: 'ALPHA',
        reason: 'FLAG_DOMINATION',
        humanPlayerCount: 2,
        winsNeeded: 3,
    });
    assert.equal(outcome.matchWinner, players[1]);
    assert.equal(outcome.messageText, 'Team Blau gewinnt das Match');
    assert.equal(outcome.messageSub, '3 : 1 Runden');
});

test('endless chase result says Punkte instead of Score', () => {
    const finished = deriveRoundEndOutcome([], {
        reason: 'ENDLESS_TIMEOUT',
        parcours: { endlessSummary: { score: 1240, isNewRecord: false } },
    });
    assert.equal(finished.messageText, 'Endlosjagd beendet – 1.240 Punkte');

    const record = deriveRoundEndOutcome([], {
        reason: 'ENDLESS_TIMEOUT',
        parcours: { endlessSummary: { score: 1560, isNewRecord: true } },
    });
    assert.equal(record.messageText, 'Neuer Rekord – 1.560 Punkte');
});

test('countdown texts use a real umlaut', () => {
    const step = deriveRoundEndTickStep({ roundPause: 3, dt: 0, escapePressed: false, enterPressed: false });
    assert.equal(step.countdownMessageSub, 'Nächste Runde in 3...');

    const uiState = deriveRoundEndCountdownUiState(3);
    assert.equal(uiState?.messageSub, 'Nächste Runde in 3...');
});

const DISPLAY_TEXT_SOURCES = [
    '../src/state/RoundStateOps.js',
    '../src/state/RoundStateControllerOps.js',
    '../src/shared/contracts/MatchUiStateContract.js',
    '../src/ui/MatchFlowArcadeOverlayController.js',
    '../src/ui/arcade/ArcadeResultTexts.js',
    '../src/ui/arcade/postrun/ArcadePostRunBlocks.js',
    '../src/ui/arcade/postrun/ArcadeRunTypeBlocks.js',
    '../src/ui/arcade/postrun/ArcadePostRunCards.js',
    '../src/ui/postmatch/PostMatchLabels.js',
];

const TRANSLITERATED_WORDS = [
    'Naechst', 'naechst', 'Zurueck', 'zurueck', 'Menue', 'menue', 'Anfuehrer',
    'verfuegbar', 'bestaetig', 'zusaetzlich', 'Groesse', 'ungueltig',
];

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

test('round end sources spell display texts with real umlauts', () => {
    const offenders = [];
    for (const relPath of DISPLAY_TEXT_SOURCES) {
        const absPath = fileURLToPath(new URL(relPath, import.meta.url));
        const source = readFileSync(absPath, 'utf8');
        for (const literal of source.match(STRING_LITERAL) || []) {
            for (const word of TRANSLITERATED_WORDS) {
                if (literal.includes(word)) offenders.push(`${relPath}: ${literal}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `transliterated umlauts left in display texts:\n${offenders.join('\n')}`);
});

test('arcade result texts use the german word list', async () => {
    const texts = await import('../src/ui/arcade/ArcadeResultTexts.js');

    assert.equal(texts.formatIntermissionTitle(3), 'Zwischenstopp Sektor 3');
    assert.equal(texts.ARCADE_RESULT_TEXTS.sectorScoreHeading, 'Punkte pro Sektor');
    assert.equal(texts.ARCADE_RESULT_TEXTS.nextSectorHeading, 'Nächster Sektor');
    assert.equal(texts.ARCADE_RESULT_TEXTS.emptyRewards, 'Keine Belohnungen verfügbar.');
    assert.equal(texts.ARCADE_RESULT_TEXTS.confirmSelection, 'Auswahl bestätigen');

    // P8 moved the post-run values into card blocks, so their labels are checked where they live now.
    const blocks = await import('../src/ui/arcade/postrun/ArcadePostRunBlocks.js');
    const runLabels = blocks.createArcadeRunBlocks({ score: 1200, bestCombo: 7, peakMultiplier: 2.5 })
        .flatMap((block) => block.rows.map((row) => row.label));
    assert.deepEqual(runLabels, ['Gesamtpunkte', 'Beste Kombo', 'Missions-Rate', 'Höchster Multiplikator']);

    const rendered = [...Object.values(texts.ARCADE_RESULT_TEXTS), ...runLabels].join('\n');
    for (const english of ['Score', 'Items', 'Combo', 'Peak-Multi', 'Rewards', 'Intermission']) {
        assert.ok(!rendered.includes(english), `"${english}" must not be shown to the player: ${rendered}`);
    }
});
