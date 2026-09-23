import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.id = '';
        this.attributes = {};
        this.parentElement = null;
        this.classList = {
            add: (...names) => { this.className = [...new Set(`${this.className} ${names.join(' ')}`.trim().split(/\s+/))].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
            toggle: (name, enabled) => {
                const active = enabled ?? !this.classList.contains(name);
                if (active) this.classList.add(name); else this.classList.remove(name);
                return active;
            },
            contains: (name) => this.className.split(/\s+/).includes(name),
        };
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    replaceChildren(...nodes) { this.children = []; nodes.forEach((node) => this.appendChild(node)); }
}

globalThis.document = { createElement: (tag) => new FakeElement(tag) };
const {
    createArcadeLeaderboardMenuCard,
    formatLeaderboardTime,
    renderArcadeLeaderboardMenu,
} = await import('../src/ui/arcade/ArcadeLeaderboardMenuView.js');

function createElement(tag, className = '', text = '') {
    const element = new FakeElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

const entries = Array.from({ length: 6 }, (_, index) => ({
    totalTimeMs: 60_000 + index * 1_250,
    penaltyTimeMs: index === 1 ? 500 : 0,
    vehicleId: `ship${index + 1}`,
    date: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
}));

test('leaderboard defaults to top three and expands to all available top-ten rows', () => {
    const refs = createArcadeLeaderboardMenuCard(createElement);
    renderArcadeLeaderboardMenu(refs, { entries, routeId: 'route', routeLabel: 'Parcours Rift' });

    assert.equal(refs.list.children.length, 3);
    assert.equal(refs.toggle.textContent, 'Alle 6 Zeiten anzeigen');
    assert.equal(refs.toggle.attributes['aria-expanded'], 'false');
    assert.equal(refs.list.children[0].children[2].textContent, 'Bestzeit');
    assert.equal(refs.list.children[1].children[4].textContent, '0.500 s');

    renderArcadeLeaderboardMenu(refs, { entries, routeId: 'route', routeLabel: 'Parcours Rift', expanded: true });
    assert.equal(refs.list.children.length, 6);
    assert.equal(refs.toggle.textContent, 'Weniger anzeigen');
    assert.equal(refs.toggle.attributes['aria-expanded'], 'true');
});

test('last result announces a new best and marks its matching row', () => {
    const refs = createArcadeLeaderboardMenuCard(createElement);
    renderArcadeLeaderboardMenu(refs, {
        entries,
        routeId: 'route',
        routeLabel: 'Parcours Rift',
        lastResult: {
            routeId: 'route', status: 'new_best', totalTimeMs: 60_000,
            improvementMs: 1_500, recordedAtIso: entries[0].date,
        },
    });

    assert.equal(refs.resultTitle.textContent, 'Neue persönliche Bestzeit');
    assert.match(refs.resultDetail.textContent, /1\.500 s schneller/);
    assert.equal(refs.list.children[0].classList.contains('is-latest'), true);
    assert.equal(refs.list.children[0].children[0].children[0].textContent, 'NEU');
});

test('leaderboard time formatting remains aligned beyond one hour', () => {
    assert.equal(formatLeaderboardTime(62_345), '1:02.345');
    assert.equal(formatLeaderboardTime(3_662_345), '1:01:02.345');
});

test('equal total times share a rank and explain the tie', () => {
    const refs = createArcadeLeaderboardMenuCard(createElement);
    const tiedEntries = [
        { ...entries[0], totalTimeMs: 60_000 },
        { ...entries[1], totalTimeMs: 60_000 },
        { ...entries[2], totalTimeMs: 62_500 },
    ];
    renderArcadeLeaderboardMenu(refs, { entries: tiedEntries, routeId: 'route', routeLabel: 'Parcours Rift' });

    assert.equal(refs.list.children[0].children[0].textContent, '1');
    assert.equal(refs.list.children[1].children[0].textContent, '1');
    assert.equal(refs.list.children[1].children[2].textContent, 'Gleichauf');
    assert.equal(refs.list.children[2].children[0].textContent, '3');
});
