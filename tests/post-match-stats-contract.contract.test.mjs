import assert from 'node:assert/strict';
import test from 'node:test';

import {
    POST_MATCH_STATS_CONTRACT_VERSION,
    POST_MATCH_STATS_LEGACY_CONTRACT_VERSION,
    POST_MATCH_STATS_LIMITS,
    POST_MATCH_STATS_VALUE_TYPES,
    classifyPostMatchStatsVersion,
    createPostMatchBlock,
    createPostMatchStandingsEntry,
    createPostMatchValueRow,
    normalizePostMatchStats,
    upgradePostMatchStatsV1,
} from '../src/shared/contracts/PostMatchStatsContract.js';
import { RoundRecorder } from '../src/state/RoundRecorder.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';

function findBlock(stats, blockId) {
    return stats.blocks.find((block) => block.id === blockId) || null;
}

function findRow(stats, blockId, rowKey) {
    return findBlock(stats, blockId)?.rows.find((row) => row.key === rowKey) || null;
}

function valuesBlock(rows) {
    return { id: 'values', title: 'Werte', kind: 'values', tier: 'primary', rows };
}

function statsWith(blocks) {
    return normalizePostMatchStats({
        contractVersion: POST_MATCH_STATS_CONTRACT_VERSION,
        visible: true,
        blocks,
    });
}

test('version classification separates current, missing and unknown payloads', () => {
    const current = classifyPostMatchStatsVersion({ contractVersion: POST_MATCH_STATS_CONTRACT_VERSION });
    assert.equal(current.decision, 'current');
    assert.equal(current.accepted, true);

    const missing = classifyPostMatchStatsVersion({ visible: true, blocks: [] });
    assert.equal(missing.decision, 'fallback');
    assert.equal(missing.reason, 'missing_version');

    const legacy = classifyPostMatchStatsVersion({ contractVersion: POST_MATCH_STATS_LEGACY_CONTRACT_VERSION });
    assert.equal(legacy.decision, 'fallback');
    assert.equal(legacy.reason, 'legacy_version');

    const unknown = classifyPostMatchStatsVersion({ contractVersion: 'post-match-stats.v99' });
    assert.equal(unknown.decision, 'reject');
    assert.equal(unknown.shouldReject, true);
});

test('garbage input always yields a complete, empty and stamped summary', () => {
    for (const payload of [null, undefined, [], 'abc', 42, { blocks: 'nope' }]) {
        const stats = normalizePostMatchStats(payload);
        assert.equal(stats.contractVersion, POST_MATCH_STATS_CONTRACT_VERSION);
        assert.equal(stats.visible, false);
        assert.deepEqual(stats.blocks, []);
    }
});

test('an unknown contract version is rejected into an empty summary', () => {
    const stats = normalizePostMatchStats({
        contractVersion: 'post-match-stats.v99',
        visible: true,
        blocks: [valuesBlock([{ key: 'a', label: 'A', value: 1, type: 'count' }])],
    });
    assert.equal(stats.visible, false);
    assert.deepEqual(stats.blocks, []);
});

test('a payload without a version field is still read as v2', () => {
    const stats = normalizePostMatchStats({
        visible: true,
        blocks: [valuesBlock([{ key: 'duration', label: 'Dauer', value: 12.5, type: 'duration' }])],
    });
    assert.equal(stats.visible, true);
    assert.equal(findRow(stats, 'values', 'duration')?.value, 12.5);
});

test('value rows keep raw numbers and carry the type instead of formatted text', () => {
    const stats = statsWith([valuesBlock([
        { key: 'duration', label: 'Dauer', value: 12.5, type: 'duration' },
        { key: 'rate', label: 'Siegrate', value: 0.25, type: 'percent' },
        { key: 'items', label: 'Items', value: 3.7, type: 'count' },
        { key: 'distance', label: 'Distanz', value: 1234.6, type: 'distance' },
        { key: 'combo', label: 'Kombo', value: -1.5, type: 'ratio' },
        { key: 'winner', label: 'Sieger', value: '  Spieler 1  ', type: 'text' },
    ])]);

    assert.equal(findRow(stats, 'values', 'duration')?.value, 12.5);
    assert.equal(findRow(stats, 'values', 'rate')?.value, 0.25);
    assert.equal(findRow(stats, 'values', 'items')?.value, 3, 'count rows are whole numbers');
    assert.equal(findRow(stats, 'values', 'distance')?.value, 1234.6);
    assert.equal(findRow(stats, 'values', 'combo')?.value, -1.5, 'ratios may be negative');
    assert.equal(findRow(stats, 'values', 'winner')?.value, 'Spieler 1');
    assert.equal(findRow(stats, 'values', 'winner')?.type, 'text');
});

test('broken numbers, negative counters and unknown types fall back safely', () => {
    const stats = statsWith([valuesBlock([
        { key: 'nan', label: 'NaN', value: Number.NaN, type: 'duration' },
        { key: 'infinite', label: 'Unendlich', value: Number.POSITIVE_INFINITY, type: 'count' },
        { key: 'negative', label: 'Negativ', value: -7, type: 'duration' },
        { key: 'missing-value', label: 'Leer', type: 'count' },
        { key: 'strange', label: 'Fremd', value: 5, type: 'nonsense' },
        { key: 'object', label: 'Objekt', value: { a: 1 }, type: 'text' },
    ])]);

    assert.equal(findRow(stats, 'values', 'nan')?.value, 0);
    assert.equal(findRow(stats, 'values', 'infinite')?.value, 0);
    assert.equal(findRow(stats, 'values', 'negative')?.value, 0);
    assert.equal(findRow(stats, 'values', 'missing-value')?.value, 0);
    assert.equal(findRow(stats, 'values', 'strange')?.type, 'text');
    assert.equal(findRow(stats, 'values', 'strange')?.value, '5');
    assert.equal(findRow(stats, 'values', 'object')?.value, '');
});

test('every declared value type is accepted and carries a default precision', () => {
    const rows = POST_MATCH_STATS_VALUE_TYPES.map((type, index) => ({
        key: `row-${index}`,
        label: type,
        value: type === 'text' ? 'x' : 1,
        type,
    }));
    const stats = statsWith([valuesBlock(rows)]);
    assert.equal(stats.blocks[0].rows.length, POST_MATCH_STATS_VALUE_TYPES.length);
    for (const row of stats.blocks[0].rows) {
        assert.equal(typeof row.precision, 'number');
        assert.ok(row.precision >= POST_MATCH_STATS_LIMITS.precision.min);
        assert.ok(row.precision <= POST_MATCH_STATS_LIMITS.precision.max);
    }
});

test('an explicit precision is clamped and garbage precision falls back to the type default', () => {
    const stats = statsWith([valuesBlock([
        { key: 'high', label: 'Hoch', value: 1, type: 'duration', precision: 99 },
        { key: 'low', label: 'Tief', value: 1, type: 'duration', precision: -4 },
        { key: 'fractional', label: 'Krumm', value: 1, type: 'duration', precision: 2.7 },
        { key: 'garbage', label: 'Müll', value: 1, type: 'duration', precision: 'zwei' },
    ])]);

    assert.equal(findRow(stats, 'values', 'high')?.precision, POST_MATCH_STATS_LIMITS.precision.max);
    assert.equal(findRow(stats, 'values', 'low')?.precision, POST_MATCH_STATS_LIMITS.precision.min);
    assert.equal(findRow(stats, 'values', 'fractional')?.precision, 2);
    assert.equal(findRow(stats, 'values', 'garbage')?.precision, 1);
});

test('rows without a usable key are dropped and duplicate keys keep the first row', () => {
    const stats = statsWith([valuesBlock([
        { key: '   ', label: 'Ohne', value: 1, type: 'count' },
        { key: 'score', label: 'Erster', value: 1, type: 'count' },
        { key: 'score', label: 'Zweiter', value: 2, type: 'count' },
        null,
        'nope',
    ])]);

    assert.equal(stats.blocks[0].rows.length, 1);
    assert.equal(stats.blocks[0].rows[0].label, 'Erster');
});

test('standings entries normalize identity, progress and flags', () => {
    const stats = statsWith([{
        id: 'standings',
        title: 'Stand',
        kind: 'standings',
        tier: 'primary',
        entries: [
            {
                playerIndex: 2,
                label: 'Spieler 3',
                isBot: false,
                isLocal: true,
                color: 0x33aaff,
                roundWins: 2,
                requiredWins: 3,
                isRoundWinner: true,
                isMatchPoint: true,
                kills: 4,
                deaths: 1,
                assists: 2,
            },
            {},
        ],
    }]);

    const block = findBlock(stats, 'standings');
    assert.equal(block?.kind, 'standings');
    assert.deepEqual(block?.rows, [], 'standings blocks carry entries, not rows');

    const first = block?.entries[0];
    assert.equal(first?.playerIndex, 2);
    assert.equal(first?.isLocal, true);
    assert.equal(first?.color, '#33aaff', 'numeric three.js colors become css hex');
    assert.equal(first?.roundWins, 2);
    assert.equal(first?.requiredWins, 3);
    assert.equal(first?.isRoundWinner, true);
    assert.equal(first?.isMatchPoint, true);
    assert.equal(first?.kills, 4);
    assert.equal(first?.deaths, 1);
    assert.equal(first?.assists, 2);

    const second = block?.entries[1];
    assert.equal(second?.playerIndex, 0);
    assert.equal(second?.label, '');
    assert.equal(second?.isBot, false);
    assert.equal(second?.isLocal, false);
    assert.equal(second?.color, '');
    assert.equal(second?.roundWins, 0);
    assert.equal(second?.requiredWins, 1, 'a match always needs at least one win');
    assert.equal(second?.kills, null, 'optional kill counters stay absent instead of faking zero');
    assert.equal(second?.deaths, null);
    assert.equal(second?.assists, null);
    assert.deepEqual(second?.extra, {});
});

test('broken standings values are clamped instead of crashing', () => {
    const stats = statsWith([{
        id: 'standings',
        kind: 'standings',
        entries: [{
            playerIndex: -3,
            label: 42,
            color: 'rot',
            roundWins: -5,
            requiredWins: 0,
            kills: Number.NaN,
        }],
    }]);

    const entry = findBlock(stats, 'standings')?.entries[0];
    assert.equal(entry?.playerIndex, 0);
    assert.equal(entry?.label, '');
    assert.equal(entry?.color, '');
    assert.equal(entry?.roundWins, 0);
    assert.equal(entry?.requiredWins, 1);
    assert.equal(entry?.kills, null);
});

test('css hex colors are accepted and lowercased', () => {
    const stats = statsWith([{
        id: 'standings',
        kind: 'standings',
        entries: [{ color: '#AABBCC' }, { color: '#0F0' }],
    }]);
    const entries = findBlock(stats, 'standings')?.entries;
    assert.equal(entries?.[0].color, '#aabbcc');
    assert.equal(entries?.[1].color, '#0f0');
});

test('the open extra field keeps unknown counters and drops everything that is not a number', () => {
    const stats = statsWith([{
        id: 'standings',
        kind: 'standings',
        entries: [{
            playerIndex: 0,
            extra: {
                intercepts: 3,
                unitsDestroyed: 0,
                trailMetersBurned: 12.5,
                futureCounter: -2,
                broken: Number.NaN,
                text: 'nope',
                nested: { a: 1 },
                '   ': 5,
            },
        }],
    }]);

    const extra = findBlock(stats, 'standings')?.entries[0].extra;
    assert.deepEqual(extra, {
        intercepts: 3,
        unitsDestroyed: 0,
        trailMetersBurned: 12.5,
        futureCounter: -2,
    });
});

test('the extra field ignores a non-object and respects its key limit', () => {
    const many = {};
    for (let i = 0; i < POST_MATCH_STATS_LIMITS.maxExtraKeys + 10; i++) {
        many[`counter${i}`] = i;
    }
    const stats = statsWith([{
        id: 'standings',
        kind: 'standings',
        entries: [{ extra: 'nope' }, { extra: many }],
    }]);

    const entries = findBlock(stats, 'standings')?.entries;
    assert.deepEqual(entries?.[0].extra, {});
    assert.equal(Object.keys(entries?.[1].extra ?? {}).length, POST_MATCH_STATS_LIMITS.maxExtraKeys);
});

test('unknown block kinds and tiers fall back to values and primary', () => {
    const stats = statsWith([
        { id: 'a', title: 'A', kind: 'nonsense', tier: 'nonsense', rows: [{ key: 'k', label: 'L', value: 1, type: 'count' }] },
        { id: 'b', title: 'B', kind: 'values', tier: 'detail', rows: [{ key: 'k', label: 'L', value: 1, type: 'count' }] },
    ]);

    assert.equal(findBlock(stats, 'a')?.kind, 'values');
    assert.equal(findBlock(stats, 'a')?.tier, 'primary');
    assert.deepEqual(findBlock(stats, 'a')?.entries, []);
    assert.equal(findBlock(stats, 'b')?.tier, 'detail');
});

test('blocks without an id, without content or with a duplicate id are dropped', () => {
    const stats = statsWith([
        { id: '', title: 'Ohne Id', rows: [{ key: 'k', label: 'L', value: 1, type: 'count' }] },
        { id: 'empty', title: 'Leer', rows: [] },
        { id: 'keep', title: 'Erster', rows: [{ key: 'k', label: 'L', value: 1, type: 'count' }] },
        { id: 'keep', title: 'Zweiter', rows: [{ key: 'k', label: 'L', value: 2, type: 'count' }] },
        null,
    ]);

    assert.equal(stats.blocks.length, 1);
    assert.equal(stats.blocks[0].id, 'keep');
    assert.equal(stats.blocks[0].title, 'Erster');
});

test('block, row and entry counts are capped', () => {
    const rows = [];
    for (let i = 0; i < POST_MATCH_STATS_LIMITS.maxRowsPerBlock + 5; i++) {
        rows.push({ key: `row-${i}`, label: `L${i}`, value: i, type: 'count' });
    }
    const entries = [];
    for (let i = 0; i < POST_MATCH_STATS_LIMITS.maxEntriesPerBlock + 5; i++) {
        entries.push({ playerIndex: i });
    }
    const blocks = [{ id: 'rows', rows }, { id: 'standings', kind: 'standings', entries }];
    for (let i = 0; i < POST_MATCH_STATS_LIMITS.maxBlocks + 5; i++) {
        blocks.push({ id: `extra-${i}`, rows: [{ key: 'k', label: 'L', value: 1, type: 'count' }] });
    }
    const stats = statsWith(blocks);

    assert.equal(stats.blocks.length, POST_MATCH_STATS_LIMITS.maxBlocks);
    assert.equal(findBlock(stats, 'rows')?.rows.length, POST_MATCH_STATS_LIMITS.maxRowsPerBlock);
    assert.equal(findBlock(stats, 'standings')?.entries.length, POST_MATCH_STATS_LIMITS.maxEntriesPerBlock);
});

test('long identifiers and labels are trimmed to the documented limits', () => {
    const stats = statsWith([{
        id: 'x'.repeat(POST_MATCH_STATS_LIMITS.maxIdLength + 20),
        title: 't'.repeat(POST_MATCH_STATS_LIMITS.maxLabelLength + 20),
        rows: [{
            key: 'k'.repeat(POST_MATCH_STATS_LIMITS.maxIdLength + 20),
            label: 'l'.repeat(POST_MATCH_STATS_LIMITS.maxLabelLength + 20),
            value: 'v'.repeat(POST_MATCH_STATS_LIMITS.maxTextLength + 20),
            type: 'text',
        }],
    }]);

    assert.equal(stats.blocks[0].id.length, POST_MATCH_STATS_LIMITS.maxIdLength);
    assert.equal(stats.blocks[0].title.length, POST_MATCH_STATS_LIMITS.maxLabelLength);
    assert.equal(stats.blocks[0].rows[0].key.length, POST_MATCH_STATS_LIMITS.maxIdLength);
    assert.equal(stats.blocks[0].rows[0].label.length, POST_MATCH_STATS_LIMITS.maxLabelLength);
    assert.equal(stats.blocks[0].rows[0].value.length, POST_MATCH_STATS_LIMITS.maxTextLength);
});

test('the creator helpers produce already normalized parts', () => {
    const row = createPostMatchValueRow({ key: ' duration ', label: ' Dauer ', value: '12.5', type: 'duration' });
    assert.deepEqual(row, { key: 'duration', label: 'Dauer', value: 12.5, type: 'duration', precision: 1 });

    const entry = createPostMatchStandingsEntry({ playerIndex: 1, label: 'Bot 2', isBot: true, roundWins: 1, requiredWins: 3 });
    assert.equal(entry.playerIndex, 1);
    assert.equal(entry.isBot, true);
    assert.equal(entry.requiredWins, 3);
    assert.deepEqual(entry.extra, {});

    const block = createPostMatchBlock({ id: 'round', title: 'Diese Runde', kind: 'values', tier: 'detail', rows: [row] });
    assert.equal(block?.kind, 'values');
    assert.equal(block?.tier, 'detail');
    assert.equal(block?.rows.length, 1);

    const standings = createPostMatchBlock({ id: 'standings', kind: 'standings', entries: [entry] });
    assert.equal(standings?.entries.length, 1);
    assert.deepEqual(standings?.rows, []);

    assert.equal(createPostMatchBlock({ id: '', rows: [row] }), null);
    assert.equal(createPostMatchBlock(null), null);
});

test('the round trip through the normalizer keeps an already normalized summary unchanged', () => {
    const first = statsWith([
        valuesBlock([{ key: 'duration', label: 'Dauer', value: 12.5, type: 'duration' }]),
        { id: 'standings', kind: 'standings', tier: 'primary', entries: [{ playerIndex: 0, roundWins: 1, requiredWins: 2, extra: { intercepts: 2 } }] },
    ]);
    const second = normalizePostMatchStats(first);
    assert.deepEqual(second, first);
});

// The overlay summary that the live round-end coordinator produces today is v1: every value is an
// already formatted string. The upgrade has to carry all of it across without losing a single row.
function buildLiveV1Summary() {
    const players = [
        { index: 0, isBot: false, score: 0 },
        { index: 1, isBot: true, score: 0 },
    ];
    const recorder = new RoundRecorder();
    recorder.startMatch?.();
    recorder.startRound(players);
    recorder.logEvent('ITEM_USE', 0, 'mode=use type=SHIELD code=item.use.success ok=1');
    const result = coordinateRoundEnd({
        recorder,
        winner: players[0],
        players: players.map((player) => ({ ...player })),
        roundStateController: {
            deriveOnRoundEndPlan: () => ({ outcome: { state: 'ROUND_END', requiredWins: 2 }, transition: {} }),
        },
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 2,
        outcomeReason: 'KILL_LIMIT',
        logger: { log() {} },
    });
    return result.statsSummary;
}

test('a real v1 summary from the round-end coordinator upgrades into v2 text rows', () => {
    const legacy = buildLiveV1Summary();
    assert.equal(legacy.contractVersion, POST_MATCH_STATS_LEGACY_CONTRACT_VERSION);

    const upgraded = upgradePostMatchStatsV1(legacy);
    assert.equal(upgraded.contractVersion, POST_MATCH_STATS_CONTRACT_VERSION);
    assert.equal(upgraded.visible, true);
    assert.equal(upgraded.blocks.length, legacy.blocks.length);

    for (const block of upgraded.blocks) {
        assert.equal(block.kind, 'values');
        assert.equal(block.tier, 'primary');
        assert.deepEqual(block.entries, []);
        for (const row of block.rows) {
            assert.equal(row.type, 'text');
            assert.equal(typeof row.value, 'string');
        }
    }

    const legacyDuration = legacy.blocks
        .find((block) => block.id === 'round').rows
        .find((row) => row.key === 'duration').value;
    assert.equal(findRow(upgraded, 'round', 'duration')?.value, legacyDuration);
    assert.equal(findRow(upgraded, 'round', 'duration')?.label, 'Dauer');
    assert.ok(findBlock(upgraded, 'scoreboard'), 'the legacy scoreboard block survives as a values block');
});

test('normalizing a v1 payload upgrades it instead of throwing it away', () => {
    const legacy = buildLiveV1Summary();
    const stats = normalizePostMatchStats(legacy);
    assert.equal(stats.contractVersion, POST_MATCH_STATS_CONTRACT_VERSION);
    assert.deepEqual(stats, upgradePostMatchStatsV1(legacy));
});

test('upgrading garbage yields an empty v2 summary', () => {
    for (const payload of [null, 'abc', { blocks: null }]) {
        const upgraded = upgradePostMatchStatsV1(payload);
        assert.equal(upgraded.contractVersion, POST_MATCH_STATS_CONTRACT_VERSION);
        assert.equal(upgraded.visible, false);
        assert.deepEqual(upgraded.blocks, []);
    }
});

test('a summary stays invisible when every block was dropped', () => {
    const stats = statsWith([{ id: 'empty', rows: [] }]);
    assert.equal(stats.visible, false);
    assert.deepEqual(stats.blocks, []);
});
