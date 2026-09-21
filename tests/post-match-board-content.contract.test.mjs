// P3: the round-end coordinator must hand over the v2 post-match board (raw numbers plus a type)
// instead of the old v1 summary of finished strings, and the overlay DOM must render that shape.
import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundRecorder } from '../src/state/RoundRecorder.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';
import { POST_MATCH_STATS_CONTRACT_VERSION } from '../src/shared/contracts/PostMatchStatsContract.js';
import { renderMessageStats } from '../src/ui/dom/MessageStatsDom.js';

const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0xffaa00, 0x33ff66, 0x8888ff, 0xff4444];

function createPlayers(count = 6) {
    return Array.from({ length: count }, (_, index) => ({
        index,
        isBot: index > 0,
        score: 0,
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        entitySlotActive: true,
    }));
}

function recordRound(players) {
    const recorder = new RoundRecorder();
    recorder.startMatch?.();
    recorder.startRound(players);
    recorder.logEvent('ITEM_USE', 0, 'mode=use type=SHIELD code=item.use.success ok=1');
    return recorder;
}

function endRound({
    players,
    winner = players[0],
    requiredWins = 3,
    state = 'ROUND_END',
    outcomeReason = 'KILL_LIMIT',
    parcours = null,
    outcomeParcours = null,
    huntScoreboard = null,
    localPlayerIndexes = [0],
} = {}) {
    const recorder = recordRound(players);
    return coordinateRoundEnd({
        recorder,
        winner,
        players,
        roundStateController: {
            deriveOnRoundEndPlan: () => ({
                outcome: { state, requiredWins, parcours: outcomeParcours },
                transition: {},
            }),
        },
        humanPlayerCount: 1,
        totalBots: players.length - 1,
        winsNeeded: requiredWins,
        outcomeReason,
        parcours,
        huntScoreboard,
        localPlayerIndexes,
        logger: { log() {} },
    });
}

function findBlock(summary, id) {
    return summary?.blocks?.find((block) => block.id === id) || null;
}

function findRow(summary, blockId, rowKey) {
    return findBlock(summary, blockId)?.rows?.find((row) => row.key === rowKey) || null;
}

test('the round-end coordinator produces a v2 board with standings first and details last', () => {
    const players = createPlayers();
    const summary = endRound({ players }).statsSummary;

    assert.equal(summary.contractVersion, POST_MATCH_STATS_CONTRACT_VERSION);
    assert.equal(summary.visible, true);
    assert.deepEqual(
        summary.blocks.map((block) => block.id),
        ['scoreboard', 'round', 'round-detail', 'match']
    );
    assert.deepEqual(
        summary.blocks.map((block) => block.tier),
        ['primary', 'primary', 'detail', 'detail']
    );
});

test('the standings list every active participant with colour, owner and match point', () => {
    const players = createPlayers();
    players.push({ index: 6, isBot: true, score: 0, color: 0x123456, entitySlotActive: false });
    players[0].score = 2;
    const summary = endRound({ players, requiredWins: 3 }).statsSummary;

    const standings = findBlock(summary, 'scoreboard');
    assert.equal(standings.kind, 'standings');
    assert.equal(standings.entries.length, 6);
    assert.deepEqual(standings.rows, []);

    const local = standings.entries.find((entry) => entry.playerIndex === 0);
    assert.equal(local.isLocal, true);
    assert.equal(local.isBot, false);
    assert.equal(local.color, '#00ffff');
    assert.equal(local.roundWins, 3);
    assert.equal(local.requiredWins, 3);
    assert.equal(local.isRoundWinner, true);
    assert.equal(local.label, 'Spieler 1');

    const bot = standings.entries.find((entry) => entry.playerIndex === 1);
    assert.equal(bot.isLocal, false);
    assert.equal(bot.isBot, true);
    assert.equal(bot.isRoundWinner, false);
});

test('one win short of the match is flagged as match point', () => {
    const players = createPlayers(2);
    players[0].score = 1;
    const summary = endRound({ players, requiredWins: 3 }).statsSummary;

    const standings = findBlock(summary, 'scoreboard');
    const winner = standings.entries.find((entry) => entry.playerIndex === 0);
    assert.equal(winner.roundWins, 2);
    assert.equal(winner.isMatchPoint, true);
    assert.equal(standings.entries.find((entry) => entry.playerIndex === 1).isMatchPoint, false);
});

test('the round block carries raw numbers with a type instead of finished text', () => {
    const players = createPlayers(2);
    const summary = endRound({ players }).statsSummary;

    const winner = findRow(summary, 'round', 'winner');
    assert.equal(winner.type, 'text');
    assert.equal(winner.value, 'Spieler 1');

    const duration = findRow(summary, 'round', 'duration');
    assert.equal(duration.type, 'duration');
    assert.equal(typeof duration.value, 'number');

    const items = findRow(summary, 'round', 'item-uses');
    assert.equal(items.type, 'count');
    assert.equal(items.value, 1);
});

test('the detail blocks show player-readable counts and totals', () => {
    const players = createPlayers(2);
    const summary = endRound({ players }).statsSummary;

    assert.equal(findBlock(summary, 'round-detail').tier, 'detail');
    assert.equal(findRow(summary, 'round-detail', 'duration').type, 'duration');
    assert.equal(findRow(summary, 'round-detail', 'item-pickups').type, 'count');
    assert.equal(findRow(summary, 'round-detail', 'self-collisions').type, 'count');
    assert.equal(findRow(summary, 'round-detail', 'stuck-rate'), null);

    const match = findBlock(summary, 'match');
    assert.equal(match.tier, 'detail');
    assert.equal(findRow(summary, 'match', 'duration').type, 'duration');
    assert.equal(findRow(summary, 'match', 'item-pickups').type, 'count');
    assert.equal(findRow(summary, 'match', 'bot-win-rate'), null);
    assert.equal(match.rows.find((row) => row.key === 'rounds').value, 1);
});

test('the endless chase shows score, distance and time first and drops zero rows', () => {
    const players = createPlayers(2);
    const summary = endRound({
        players,
        outcomeParcours: {
            endless: true,
            endlessSummary: {
                score: 1240,
                distanceMeters: 860,
                survivalSeconds: 95.5,
                botKills: 4,
                eliteKills: 0,
                checkpointsPassed: 0,
                bestStreak: 3,
                shakeoffs: 0,
                revives: 0,
                bonusScore: 0,
                completedModules: 0,
                lastCompletedWave: 0,
                sideRoutesCompleted: 0,
                flightObjectivesCompleted: 0,
                xp: 120,
                unlocks: [],
                newMilestones: [],
            },
        },
    }).statsSummary;

    const primary = findBlock(summary, 'endless-parcours');
    assert.equal(primary.tier, 'primary');
    assert.deepEqual(primary.rows.map((row) => row.key), ['score', 'distance', 'survival']);
    assert.equal(primary.rows[0].value, 1240);
    assert.equal(primary.rows[1].type, 'distance');
    assert.equal(primary.rows[2].type, 'duration');

    const detail = findBlock(summary, 'endless-parcours-detail');
    assert.equal(detail.tier, 'detail');
    // Zero counters are gone; the persistence note is text and stays, so the desktop smoke keeps
    // finding "Speicherung" on the board.
    assert.deepEqual(detail.rows.map((row) => row.key), ['kills', 'best-streak', 'xp', 'persistence']);
    assert.equal(detail.rows.at(-1).value, 'gespeichert');

    assert.ok(
        summary.blocks.map((block) => block.id).indexOf('endless-parcours')
        < summary.blocks.map((block) => block.id).indexOf('round-detail'),
        'the endless card stands before the detail cards'
    );
});

test('hunt standings carry kills, deaths and assists and sort by kills', () => {
    const players = createPlayers(3);
    const summary = endRound({
        players,
        huntScoreboard: [
            { playerIndex: 2, label: 'Bot 3', kills: 7, deaths: 1, assists: 2 },
            { playerIndex: 0, label: 'Spieler 1', kills: 3, deaths: 4, assists: 1 },
            { playerIndex: 1, label: 'Bot 2', kills: 1, deaths: 6, assists: 0 },
        ],
    }).statsSummary;

    const standings = findBlock(summary, 'scoreboard');
    assert.deepEqual(standings.entries.map((entry) => entry.playerIndex), [2, 0, 1]);
    assert.equal(standings.entries[0].kills, 7);
    assert.equal(standings.entries[0].deaths, 1);
    assert.equal(standings.entries[0].assists, 2);
    assert.equal(standings.entries[1].isLocal, true);
});

test('without a hunt scoreboard the kill counters stay empty instead of zero', () => {
    const players = createPlayers(2);
    const summary = endRound({ players }).statsSummary;
    const standings = findBlock(summary, 'scoreboard');
    assert.equal(standings.entries[0].kills, null);
    assert.equal(standings.entries[0].deaths, null);
});

// ---------------------------------------------------------------------------
// Overlay DOM (node has no browser; the renderer only needs a small subset)
// ---------------------------------------------------------------------------

function createStubClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
    };
}

function createStubElement(tagName = 'div') {
    return {
        tagName,
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        // The standings table paints the player colour as an inline style.
        style: {},
        classList: createStubClassList(),
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children.length = 0; },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; },
    };
}

function installDocumentStub() {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => createStubElement(tagName) };
    return () => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    };
}

function walkElements(node, found = []) {
    for (const child of node.children || []) {
        found.push(child);
        walkElements(child, found);
    }
    return found;
}

function findBlockElement(root, blockId) {
    return walkElements(root).find((node) => node.getAttribute('data-stats-block-id') === blockId) || null;
}

function collectRows(blockElement) {
    const list = blockElement.children.find((child) => child.tagName === 'dl');
    return (list?.children || []).map((row) => ({
        key: row.getAttribute('data-stats-row-key'),
        label: row.children[0]?.textContent || '',
        value: row.children[1]?.textContent || '',
    }));
}

test('the overlay renders the v2 board with german values and keeps its test hooks', () => {
    const players = createPlayers(2);
    const summary = endRound({ players }).statsSummary;
    const restore = installDocumentStub();
    try {
        const container = createStubElement('div');
        renderMessageStats(container, summary);

        assert.equal(container.classList.contains('hidden'), false);
        // P4: the primary blocks stay open, the detail blocks moved into one folded <details>.
        assert.deepEqual(
            container.children
                .filter((block) => block.getAttribute('data-stats-block-id'))
                .map((block) => block.getAttribute('data-stats-block-id')),
            ['scoreboard', 'round']
        );
        assert.deepEqual(
            walkElements(container)
                .filter((node) => node.getAttribute('data-stats-block-id'))
                .map((node) => node.getAttribute('data-stats-block-id')),
            ['scoreboard', 'round', 'round-detail', 'match']
        );

        const standingsRow = walkElements(findBlockElement(container, 'scoreboard'))
            .find((node) => node.getAttribute('data-stats-row-key') === 'player-0');
        assert.ok(standingsRow, 'the standings row keeps its player key');
        assert.equal(
            walkElements(standingsRow).find((node) => node.getAttribute('data-stats-value') === 'progress').textContent,
            '1/3'
        );
        assert.ok(
            walkElements(standingsRow).some((node) => node.textContent === 'Spieler 1'),
            'the player name stays readable in the table'
        );

        const matchRows = collectRows(findBlockElement(container, 'match'));
        assert.match(matchRows.find((row) => row.key === 'duration').value, /s$/);
        assert.equal(matchRows.find((row) => row.key === 'item-pickups').value, '0');
    } finally {
        restore();
    }
});

test('the overlay hides itself for an empty summary', () => {
    const restore = installDocumentStub();
    try {
        const container = createStubElement('div');
        renderMessageStats(container, { contractVersion: POST_MATCH_STATS_CONTRACT_VERSION, visible: true, blocks: [] });
        assert.equal(container.classList.contains('hidden'), true);
    } finally {
        restore();
    }
});
