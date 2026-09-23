import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.className = '';
        this.id = '';
        this.textContent = '';
        this.dataset = {};
        this.style = {};
        this.attributes = {};
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
        this.parentElement = null;
    }

    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
    insertBefore(child) { return this.appendChild(child); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    replaceChildren(...nodes) { this.children = []; nodes.forEach((node) => this.appendChild(node)); }
    addEventListener() {}
    querySelector() { return null; }
}

globalThis.document = { createElement: (tag) => new FakeElement(tag) };
const { buildArcadeSurface } = await import('../src/ui/arcade/ArcadeMenuSurfaceDom.js');

function build() {
    const ui = {};
    const surface = buildArcadeSurface(new FakeElement('div'), ui);
    const body = surface.details.children.find((child) => String(child.className).includes('arcade-surface-body'));
    return { surface, body };
}

const byClass = (parent, name) => parent.children.find((child) => String(child.className).split(' ').includes(name));

test('the five run starts sit together in a "Lauf starten" group at the top', () => {
    const { body } = build();
    const group = body.children[0];
    assert.match(group.className, /\barcade-start-group\b/);
    assert.equal(group.children[0].textContent, 'Lauf starten');
    const options = group.children.filter((child) => child.className === 'arcade-start-option');
    assert.deepEqual(options.map((option) => option.children[0].id), [
        'btn-arcade-start-inline',
        'btn-arcade-endless-start-inline',
        'btn-arcade-five-fronts-start-inline',
        'btn-arcade-five-portals-start-inline',
        'btn-arcade-weapon-race-start-inline',
    ]);
    for (const option of options) {
        const copy = option.children[1];
        assert.equal(copy.className, 'arcade-start-option-copy');
        assert.match(copy.textContent, /\S.{20,}\.$/, `${option.children[0].id} explains itself in one sentence`);
    }
});

test('the arcade statistics include a local parcours leaderboard card', () => {
    const { surface } = build();
    assert.equal(surface.leaderboardLine.id, 'arcade-local-leaderboard-line');
    assert.equal(surface.leaderboardList.id, 'arcade-local-leaderboard-list');
    assert.equal(surface.leaderboardList.attributes['aria-label'], 'Lokale Parcours-Bestenliste');
});

test('the plain arcade run says it is the same run as the main start button', () => {
    const { body } = build();
    const first = body.children[0].children.find((child) => child.className === 'arcade-start-option');
    assert.match(first.children[1].textContent, /„Spiel starten“/);
});

test('current status and standalone leaderboard follow the starts before advanced options', () => {
    const { body, surface } = build();
    const stats = byClass(body, 'arcade-stats-block');
    assert.ok(stats, 'stats block exists');
    assert.ok(body.children.indexOf(stats) > 0, 'below the start group');
    assert.equal(stats.children[0].textContent, 'Dein aktueller Stand');
    assert.ok(stats.children.includes(surface.recordsLine));
    assert.ok(body.children.indexOf(surface.leaderboardLine.parentElement.parentElement) > body.children.indexOf(stats));
    const advanced = byClass(body, 'arcade-advanced-options');
    assert.ok(advanced, 'advanced options exist');
    assert.ok(body.children.indexOf(advanced) > body.children.indexOf(surface.leaderboardLine.parentElement.parentElement));
});

test('leaderboard keeps accessible table and top-ten toggle hooks', () => {
    const { surface } = build();
    assert.equal(surface.leaderboardList.tagName, 'TBODY');
    assert.equal(surface.leaderboardList.attributes['aria-label'], 'Lokale Parcours-Bestenliste');
    assert.equal(surface.leaderboardToggle.id, 'btn-arcade-local-leaderboard-toggle');
    assert.equal(surface.leaderboardToggle.attributes['aria-controls'], 'arcade-local-leaderboard-list');
    assert.equal(surface.leaderboardToggle.attributes['aria-expanded'], 'false');
    assert.equal(surface.leaderboardResult.attributes['aria-live'], 'polite');
});
