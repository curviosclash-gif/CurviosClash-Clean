// P4: the post-match board must render the standings as a real table (rank, colour dot plus name,
// progress pips, in HUNT also kills/deaths/assists) and fold every developer block into one closed
// <details>. Node has no browser, so a small document stub records what the renderer builds.
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMessageStats } from '../src/ui/dom/MessageStatsDom.js';
import { POST_MATCH_STATS_CONTRACT_VERSION } from '../src/shared/contracts/PostMatchStatsContract.js';

// ---------------------------------------------------------------------------
// Document stub
// ---------------------------------------------------------------------------

function createStubClassList(element) {
    const values = new Set();
    return {
        add(...names) { for (const name of names) values.add(name); element.className = [...values].join(' '); },
        remove(...names) { for (const name of names) values.delete(name); element.className = [...values].join(' '); },
        contains(name) { return values.has(name); },
    };
}

function createStubElement(tagName = 'div') {
    const element = {
        tagName,
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        style: {},
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children.length = 0; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    };
    element.classList = createStubClassList(element);
    return element;
}

function installDocumentStub() {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => createStubElement(tagName) };
    return () => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    };
}

// ---------------------------------------------------------------------------
// Tiny query helpers (the stub has no querySelector)
// ---------------------------------------------------------------------------

function walk(node, visit) {
    for (const child of node.children || []) {
        visit(child);
        walk(child, visit);
    }
}

function findAll(root, predicate) {
    const found = [];
    walk(root, (node) => { if (predicate(node)) found.push(node); });
    return found;
}

function findFirst(root, predicate) {
    return findAll(root, predicate)[0] || null;
}

function byTag(root, tagName) {
    return findAll(root, (node) => node.tagName === tagName);
}

function hasClass(node, name) {
    return String(node.className || '').split(/\s+/).includes(name);
}

function textOf(node) {
    if (!node) return '';
    let text = node.textContent || '';
    for (const child of node.children || []) text += textOf(child);
    return text;
}

function blockElement(container, blockId) {
    return findFirst(container, (node) => node.getAttribute('data-stats-block-id') === blockId);
}

function rowElement(container, rowKey) {
    return findFirst(container, (node) => node.getAttribute('data-stats-row-key') === rowKey);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function standingsEntry(overrides = {}) {
    return {
        playerIndex: 0,
        label: 'Spieler 1',
        isBot: false,
        isLocal: false,
        color: '#00ffff',
        roundWins: 2,
        requiredWins: 3,
        isRoundWinner: false,
        isMatchPoint: false,
        kills: null,
        deaths: null,
        assists: null,
        ...overrides,
    };
}

function summaryWith(blocks) {
    return { contractVersion: POST_MATCH_STATS_CONTRACT_VERSION, visible: true, blocks };
}

function standingsBlock(entries, overrides = {}) {
    return { id: 'scoreboard', title: 'Zwischenstand', kind: 'standings', tier: 'primary', entries, ...overrides };
}

function valuesBlock(id, tier, rows, title = id) {
    return { id, title, kind: 'values', tier, rows };
}

function render(summary) {
    const container = createStubElement('div');
    renderMessageStats(container, summary);
    return container;
}

function withDocument(run) {
    const restore = installDocumentStub();
    try {
        return run();
    } finally {
        restore();
    }
}

// ---------------------------------------------------------------------------
// Standings table
// ---------------------------------------------------------------------------

test('the standings block becomes a table with caption, head and one row per entry', () => {
    withDocument(() => {
        const container = render(summaryWith([standingsBlock([
            standingsEntry({ playerIndex: 2, label: 'Bot 3' }),
            standingsEntry({ playerIndex: 0, label: 'Spieler 1', isLocal: true }),
            standingsEntry({ playerIndex: 1, label: 'Bot 2', isBot: true }),
        ])]));

        const block = blockElement(container, 'scoreboard');
        assert.ok(block, 'the standings block keeps its data-stats-block-id');
        assert.equal(block.getAttribute('data-stats-block-tier'), 'primary');

        const table = byTag(block, 'table')[0];
        assert.ok(table, 'the standings are rendered as a real table');

        const caption = byTag(table, 'caption')[0];
        assert.equal(caption.textContent, 'Zwischenstand');
        assert.ok(hasClass(caption, 'message-stats-title'), 'the caption keeps the title hook');

        const head = byTag(table, 'thead')[0];
        const headers = byTag(head, 'th');
        assert.deepEqual(headers.map((cell) => cell.textContent), ['#', 'Spieler', 'Runden']);
        assert.deepEqual(headers.map((cell) => cell.getAttribute('scope')), ['col', 'col', 'col']);

        const body = byTag(table, 'tbody')[0];
        const rows = byTag(body, 'tr');
        assert.deepEqual(
            rows.map((row) => row.getAttribute('data-stats-row-key')),
            ['player-2', 'player-0', 'player-1']
        );
        assert.deepEqual(byTag(rows[0], 'td')[0].textContent, '1');
        assert.deepEqual(byTag(rows[2], 'td')[0].textContent, '3');
    });
});

test('the hunt columns only appear when the mode counts kills', () => {
    withDocument(() => {
        const plain = render(summaryWith([standingsBlock([standingsEntry()])]));
        assert.equal(byTag(blockElement(plain, 'scoreboard'), 'th').length, 3);

        const hunt = render(summaryWith([standingsBlock([
            standingsEntry({ playerIndex: 0, kills: 7, deaths: 1, assists: 2 }),
            standingsEntry({ playerIndex: 1, label: 'Bot 2', isBot: true }),
        ])]));
        const block = blockElement(hunt, 'scoreboard');
        const headers = byTag(block, 'th');
        assert.deepEqual(headers.map((cell) => cell.textContent), ['#', 'Spieler', 'Runden', 'A', 'T', 'As']);
        assert.equal(headers[3].getAttribute('abbr'), 'Abschüsse');
        assert.equal(headers[3].getAttribute('title'), 'Abschüsse');
        assert.equal(headers[4].getAttribute('abbr'), 'Tode');
        assert.equal(headers[5].getAttribute('abbr'), 'Assists');

        const first = rowElement(block, 'player-0');
        assert.equal(findFirst(first, (node) => node.getAttribute('data-stats-value') === 'kills').textContent, '7');
        assert.equal(findFirst(first, (node) => node.getAttribute('data-stats-value') === 'deaths').textContent, '1');
        assert.equal(findFirst(first, (node) => node.getAttribute('data-stats-value') === 'assists').textContent, '2');

        // A participant without kill tracking keeps the column shape but shows the placeholder.
        const second = rowElement(block, 'player-1');
        assert.equal(findFirst(second, (node) => node.getAttribute('data-stats-value') === 'kills').textContent, '–');
    });
});

test('owner, round winner and match point are readable without colour', () => {
    withDocument(() => {
        const container = render(summaryWith([standingsBlock([
            standingsEntry({ playerIndex: 0, isLocal: true, isRoundWinner: true, isMatchPoint: true }),
            standingsEntry({ playerIndex: 1, label: 'Bot 2', isBot: true }),
        ])]));
        const block = blockElement(container, 'scoreboard');

        const local = rowElement(block, 'player-0');
        assert.ok(hasClass(local, 'is-local'));
        assert.ok(hasClass(local, 'is-round-winner'));
        assert.ok(hasClass(local, 'is-match-point'));
        assert.equal(hasClass(local, 'is-bot'), false);

        const text = textOf(local);
        assert.match(text, /\(du\)/);
        assert.match(text, /Matchball/);

        const winnerMark = findFirst(local, (node) => hasClass(node, 'message-stats-winner'));
        assert.ok(winnerMark, 'the round winner carries a visible mark');
        assert.equal(winnerMark.getAttribute('aria-label'), 'Rundensieger');
        assert.notEqual(winnerMark.textContent, '');

        const bot = rowElement(block, 'player-1');
        assert.ok(hasClass(bot, 'is-bot'));
        assert.equal(hasClass(bot, 'is-local'), false);
        assert.doesNotMatch(textOf(bot), /\(du\)|Matchball/);
    });
});

test('the round progress is shown as pips and keeps the plain "2/3" hook', () => {
    withDocument(() => {
        const container = render(summaryWith([standingsBlock([
            standingsEntry({ playerIndex: 0, roundWins: 2, requiredWins: 3 }),
            standingsEntry({ playerIndex: 1, label: 'Bot 2', roundWins: 7, requiredWins: 12 }),
        ])]));
        const block = blockElement(container, 'scoreboard');

        const first = rowElement(block, 'player-0');
        const pips = findFirst(first, (node) => hasClass(node, 'message-stats-pips'));
        assert.equal(pips.textContent, '●●○');
        assert.equal(pips.getAttribute('aria-hidden'), 'true');

        const value = findFirst(first, (node) => node.getAttribute('data-stats-value') === 'progress');
        assert.equal(value.textContent, '2/3');
        assert.ok(hasClass(value, 'message-stats-value'), 'the desktop tests read .message-stats-value');

        const cell = findFirst(first, (node) => hasClass(node, 'message-stats-progress'));
        assert.equal(cell.getAttribute('aria-label'), '2 von 3');

        // Long matches would drown in pips, so they fall back to the bare fraction.
        const second = rowElement(block, 'player-1');
        assert.equal(findFirst(second, (node) => hasClass(node, 'message-stats-pips')), null);
        assert.equal(
            findFirst(second, (node) => node.getAttribute('data-stats-value') === 'progress').textContent,
            '7/12'
        );
    });
});

test('the colour dot falls back gracefully and an empty name becomes a numbered player', () => {
    withDocument(() => {
        const container = render(summaryWith([standingsBlock([
            standingsEntry({ playerIndex: 0, color: '#00ffff' }),
            standingsEntry({ playerIndex: 2, label: '', color: 'nonsense' }),
        ])]));
        const block = blockElement(container, 'scoreboard');

        const dot = findFirst(rowElement(block, 'player-0'), (node) => hasClass(node, 'message-stats-dot'));
        assert.equal(dot.style.backgroundColor, '#00ffff');
        assert.equal(dot.getAttribute('aria-hidden'), 'true');
        assert.equal(hasClass(dot, 'no-color'), false);

        const second = rowElement(block, 'player-2');
        const plainDot = findFirst(second, (node) => hasClass(node, 'message-stats-dot'));
        assert.ok(hasClass(plainDot, 'no-color'));
        assert.ok(!plainDot.style.backgroundColor);
        assert.match(textOf(second), /Spieler 3/);
    });
});

// ---------------------------------------------------------------------------
// Cards and the folded detail section
// ---------------------------------------------------------------------------

test('primary cards stay open while every detail block sits in one closed details', () => {
    withDocument(() => {
        const container = render(summaryWith([
            standingsBlock([standingsEntry()]),
            valuesBlock('round', 'primary', [{ key: 'winner', label: 'Sieger', value: 'Spieler 1', type: 'text' }]),
            valuesBlock('round-detail', 'detail', [{ key: 'stuck-rate', label: 'Stuck/min', value: 1.5, type: 'ratio' }]),
            valuesBlock('match', 'detail', [{ key: 'rounds', label: 'Runden', value: 3, type: 'count' }]),
        ]));

        assert.equal(container.classList.contains('hidden'), false);

        const detailsList = byTag(container, 'details');
        assert.equal(detailsList.length, 1, 'all detail blocks share one disclosure');
        const details = detailsList[0];
        assert.equal(details.hasAttribute('open'), false, 'the details start folded');
        assert.ok(hasClass(details, 'message-stats-details'));

        const summary = byTag(details, 'summary')[0];
        assert.equal(summary.textContent, 'Details');

        // Primary blocks are direct children of the container, detail blocks live inside the details.
        assert.deepEqual(
            container.children.filter((child) => child.getAttribute('data-stats-block-id'))
                .map((child) => child.getAttribute('data-stats-block-id')),
            ['scoreboard', 'round']
        );
        assert.deepEqual(
            findAll(details, (node) => node.getAttribute('data-stats-block-id'))
                .map((node) => node.getAttribute('data-stats-block-id')),
            ['round-detail', 'match']
        );
        assert.equal(details.children.at(-1).getAttribute('data-stats-block-tier'), 'detail');

        // The card rows keep the hooks the desktop tests query.
        const row = rowElement(blockElement(container, 'round-detail'), 'stuck-rate');
        assert.ok(row, 'detail rows keep their data-stats-row-key');
        assert.equal(findFirst(row, (node) => hasClass(node, 'message-stats-value')).textContent, '1,5');
    });
});

test('without detail blocks the board shows no disclosure at all', () => {
    withDocument(() => {
        const container = render(summaryWith([
            standingsBlock([standingsEntry()]),
            valuesBlock('round', 'primary', [{ key: 'winner', label: 'Sieger', value: 'Spieler 1', type: 'text' }]),
        ]));
        assert.equal(byTag(container, 'details').length, 0);
        assert.equal(byTag(container, 'summary').length, 0);
    });
});

test('a legacy v1 summary still reaches the board as plain cards', () => {
    withDocument(() => {
        const container = render({
            contractVersion: 'post-match-stats.v1',
            visible: true,
            blocks: [{ id: 'round', title: 'Runde', rows: [{ key: 'winner', label: 'Sieger', value: 'Spieler 1' }] }],
        });
        const block = blockElement(container, 'round');
        assert.ok(block);
        assert.equal(block.getAttribute('data-stats-block-tier'), 'primary');
        const row = rowElement(block, 'winner');
        assert.equal(findFirst(row, (node) => hasClass(node, 'message-stats-value')).textContent, 'Spieler 1');
    });
});

test('an empty summary clears and hides the board', () => {
    withDocument(() => {
        const container = createStubElement('div');
        renderMessageStats(container, summaryWith([standingsBlock([standingsEntry()])]));
        renderMessageStats(container, null);
        assert.equal(container.children.length, 0);
        assert.equal(container.classList.contains('hidden'), true);
    });
});
