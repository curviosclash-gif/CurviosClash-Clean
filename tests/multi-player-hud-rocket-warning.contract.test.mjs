import assert from 'node:assert/strict';
import test from 'node:test';

import { FourPlayerPlanarHudView } from '../src/ui/four-player-planar/FourPlayerPlanarHudView.js';
import { ThreePlayerSplitHudView } from '../src/ui/four-player-planar/ThreePlayerSplitHudView.js';

// ---------------------------------------------------------------------------
// Document stand-in. Node has no DOM, and these views only create elements,
// set text, toggle classes and write two style properties - so the stub covers
// exactly that, plus the createRange path the existing row markup uses.
// ---------------------------------------------------------------------------

function createDocumentStub() {
    const documentRef = {};

    function createElementStub(tagName) {
        const classes = new Set();
        const element = {
            tagName,
            id: '',
            children: [],
            attributes: {},
            ownerDocument: documentRef,
            classList: {
                add(value) { classes.add(value); },
                remove(value) { classes.delete(value); },
                contains(value) { return classes.has(value); },
                toggle(value, force) {
                    const enabled = force === undefined ? !classes.has(value) : !!force;
                    if (enabled) classes.add(value);
                    else classes.delete(value);
                    return enabled;
                },
            },
            style: { setProperty(name, value) { element.style[name] = value; } },
            setAttribute(name, value) { element.attributes[name] = String(value); },
            getAttribute(name) {
                return Object.prototype.hasOwnProperty.call(element.attributes, name)
                    ? element.attributes[name]
                    : null;
            },
            appendChild(child) { element.children.push(child); return child; },
            append(...kids) { for (const kid of kids) element.appendChild(kid); },
            querySelector() { return createElementStub('span'); },
            remove() { element.removed = true; },
        };
        let text = '';
        Object.defineProperty(element, 'textContent', {
            get() { return text; },
            set(value) { text = String(value); },
        });
        Object.defineProperty(element, 'className', {
            get() { return [...classes].join(' '); },
            set(value) {
                classes.clear();
                for (const name of String(value).split(/\s+/)) if (name) classes.add(name);
            },
        });
        return element;
    }

    documentRef.documentElement = createElementStub('html');
    const hud = createElementStub('div');
    documentRef.createElement = createElementStub;
    documentRef.getElementById = (id) => (id === 'hud' ? hud : null);
    // The row markup goes through createContextualFragment; the section it yields
    // is the player's own area and therefore the parent of that player's warning.
    documentRef.createRange = () => ({
        createContextualFragment: () => ({ firstElementChild: createElementStub('section') }),
    });
    return documentRef;
}

function findById(element, id) {
    if (!element) return null;
    if (element.id === id) return element;
    for (const child of element.children || []) {
        const hit = findById(child, id);
        if (hit) return hit;
    }
    return null;
}

function hudRoot(documentRef) {
    return documentRef.getElementById('hud').children[0];
}

function warningOf(documentRef, idPrefix, playerIndex) {
    const found = findById(hudRoot(documentRef), `${idPrefix}-rocket-warning-p${playerIndex + 1}`);
    assert.ok(found, `missing warning banner for player ${playerIndex + 1}`);
    return found;
}

function isVisible(element) {
    return !element.classList.contains('hidden');
}

/** A chased driver: live player fields plus the threat the projectile system reports. */
function chasedPlayer() {
    return { alive: true, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
}

const INBOUND_ROCKET = Object.freeze({
    active: true,
    count: 1,
    nearestDistance: 55,
    direction: { x: 0, y: 0, z: 1 },
});

function scoreRows(interceptsByPlayer) {
    return interceptsByPlayer.map((intercepts, playerIndex) => ({
        playerIndex,
        label: `P${playerIndex + 1}`,
        kills: 0,
        intercepts,
    }));
}

// ---------------------------------------------------------------------------

test('the three player split warns only the driver a rocket is chasing', () => {
    const documentRef = createDocumentStub();
    const view = new ThreePlayerSplitHudView({ documentRef });
    assert.equal(view.ensureRows({ playerCount: 3, playerColors: [1, 2, 3] }), true);

    // Every player area owns a banner, and each says in plain words who it is for.
    for (let index = 0; index < 3; index += 1) {
        const banner = warningOf(documentRef, 'three-player-split', index);
        assert.equal(isVisible(banner), false, 'a fresh HUD shows no warning');
        const srText = banner.children.map((child) => child.textContent).join(' ');
        assert.match(srText, new RegExp(`Rakete im Anflug, Spieler ${index + 1}`));
    }

    // Player 2 is being chased, nobody else is.
    for (let index = 0; index < 3; index += 1) {
        view.updateRocketWarning(index, chasedPlayer(), index === 1 ? INBOUND_ROCKET : null, true, true);
    }
    assert.equal(isVisible(warningOf(documentRef, 'three-player-split', 0)), false);
    assert.equal(isVisible(warningOf(documentRef, 'three-player-split', 1)), true);
    assert.equal(isVisible(warningOf(documentRef, 'three-player-split', 2)), false);

    const banner = warningOf(documentRef, 'three-player-split', 1);
    const arrow = banner.children[0];
    assert.equal(typeof arrow.style.transform, 'string', 'the arrow gets an angle');
    assert.match(banner.children[1].textContent, /^RAKETE/);

    // The rocket is gone again.
    view.updateRocketWarning(1, chasedPlayer(), null, true, true);
    assert.equal(isVisible(banner), false);

    // Outside Hunt there are no rockets at all, so nothing may light up.
    view.updateRocketWarning(1, chasedPlayer(), INBOUND_ROCKET, false, true);
    assert.equal(isVisible(banner), false);
});

test('the four player planar HUD warns its third quadrant', () => {
    const documentRef = createDocumentStub();
    const view = new FourPlayerPlanarHudView({ documentRef });
    assert.equal(view.ensureRows({ playerCount: 4, playerColors: [1, 2, 3, 4] }), true);

    view.updateRocketWarning(2, chasedPlayer(), INBOUND_ROCKET, true, true);
    assert.equal(isVisible(warningOf(documentRef, 'four-player-planar', 2)), true);
    for (const index of [0, 1, 3]) {
        assert.equal(isVisible(warningOf(documentRef, 'four-player-planar', index)), false);
    }

    // The end of a round clears the screen for everybody.
    view.resetScoreEvent();
    assert.equal(isVisible(warningOf(documentRef, 'four-player-planar', 2)), false);
});

test('an intercept is announced on the shared split screen', () => {
    const documentRef = createDocumentStub();
    const view = new ThreePlayerSplitHudView({ documentRef });
    view.ensureRows({ playerCount: 3, playerColors: [1, 2, 3] });

    // The first frame only records the counters: joining a running match is quiet.
    view.observeScores(scoreRows([0, 0, 0]), { scoreKey: 'kills' });
    const announcementOf = () => hudRoot(documentRef).children
        .find((child) => child.classList.contains('match-hud-announcement'));
    assert.equal(announcementOf(), undefined, 'nothing announced yet');

    view.observeScores(scoreRows([0, 1, 0]), { scoreKey: 'kills' });
    const announcement = announcementOf();
    assert.ok(announcement, 'the intercept has to reach the announcement area');
    assert.match(announcement.textContent, /^Abgefangen!/);

    view.resetScoreEvent();
});
