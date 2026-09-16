import assert from 'node:assert/strict';
import test from 'node:test';

import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import {
    applyMapDestructibleDamage,
    createMapDestructibleState,
    normalizeMapDestructibles,
    resolveMapDestructibleHudState,
} from '../src/shared/contracts/MapDestructibleContract.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { HUD } from '../src/ui/HUD.js';
import { formatMapDestructibleStatus } from '../src/ui/MapDestructibleStatusText.js';

const DESTRUCTIBLES = {
    segments: [
        { id: 'leg_a', label: 'Bein A', kind: 'leg_lower', hp: 100, meshPrefixes: ['legs_lower'], anchor: [20, 0, 20] },
        { id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 50, meshPrefixes: ['shaft'] },
    ],
};

// The same tower, but with the break scenes that decide what a collapse carries away with it.
const DESTRUCTIBLES_WITH_SCENES = {
    segments: [
        { id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 50, meshPrefixes: ['shaft_iron'] },
        { id: 'summit', label: 'Spitze', kind: 'summit', hp: 50, meshPrefixes: ['summit_iron'] },
    ],
    pieces: ['shaft', 'summit'],
    breakScenes: [
        { id: 'topple_shaft', trigger: { kind: 'shaft' }, modelId: 'topple-shaft', pieces: ['shaft', 'summit'] },
    ],
};

const INACTIVE = { active: false, sealed: false, focusSegment: null, breakingSecondsRemaining: 0 };

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

test('the status line reports a break first and the segment under fire afterwards', () => {
    assert.equal(formatMapDestructibleStatus(null), '');
    assert.equal(formatMapDestructibleStatus(INACTIVE), '');
    assert.equal(formatMapDestructibleStatus({ active: true }), '');

    assert.equal(
        formatMapDestructibleStatus({ active: true, breakingSecondsRemaining: 3 }),
        'TURM BRICHT',
    );
    // A lower leg takes the whole tower with it, which the wording says out loud.
    assert.equal(
        formatMapDestructibleStatus({ active: true, sealed: true, breakingSecondsRemaining: 0.2 }),
        'TURM STÜRZT',
    );
    assert.equal(
        formatMapDestructibleStatus({
            active: true,
            sealed: true,
            breakingSecondsRemaining: 0.2,
            focusSegment: { id: 'reactor_dome', label: 'Reaktor', ratio: 0 },
        }),
        'REAKTOR ZERSTÖRT',
    );

    assert.equal(
        formatMapDestructibleStatus({
            active: true,
            breakingSecondsRemaining: 0,
            focusSegment: { id: 'leg_a', label: 'Bein A', ratio: 0.4 },
        }),
        'STRUKTUR · BEIN A 40 %',
    );
    // Percentages are rounded, never truncated, and a missing label falls back to the id.
    assert.equal(
        formatMapDestructibleStatus({ active: true, focusSegment: { id: 'shaft', label: '  ', ratio: 0.666 } }),
        'STRUKTUR · SHAFT 67 %',
    );
    assert.equal(
        formatMapDestructibleStatus({ active: true, focusSegment: { ratio: 'viel' } }),
        'STRUKTUR · SEGMENT 0 %',
    );
});

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test('the player projection normalizes the tower state and drops it when nothing is going on', () => {
    assert.deepEqual(createMatchRuntimePlayerProjection({ playerIndex: 0 }).mapDestructible, INACTIVE);
    assert.deepEqual(
        createMatchRuntimePlayerProjection({ playerIndex: 0, mapDestructible: 'nope' }).mapDestructible,
        INACTIVE,
    );
    // An inactive tower carries neither a focus nor a countdown, whatever the source says.
    assert.deepEqual(
        createMatchRuntimePlayerProjection({
            playerIndex: 0,
            mapDestructible: {
                active: false,
                focusSegment: { id: 'leg_a', label: 'Bein A', ratio: 0.5 },
                breakingSecondsRemaining: 4,
            },
        }).mapDestructible,
        INACTIVE,
    );

    const projected = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        mapDestructible: {
            active: true,
            sealed: true,
            breakingSecondsRemaining: '2.5',
            focusSegment: { id: 'leg_a', label: 'x'.repeat(80), ratio: 9 },
            segments: [{ id: 'leg_a' }, { id: 'shaft' }],
        },
    }).mapDestructible;
    assert.equal(projected.active, true);
    assert.equal(projected.sealed, true);
    assert.equal(projected.breakingSecondsRemaining, 2.5);
    assert.equal(projected.focusSegment.label.length, 40);
    assert.equal(projected.focusSegment.ratio, 1);
    // The per-segment list stays out of the per-frame projection; the HUD only needs the focus.
    assert.deepEqual(Object.keys(projected).sort(), [
        'active', 'breakingSecondsRemaining', 'focusSegment', 'sealed',
    ]);

    const negative = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        mapDestructible: { active: true, breakingSecondsRemaining: -4, focusSegment: { ratio: -1 } },
    }).mapDestructible;
    assert.equal(negative.breakingSecondsRemaining, 0);
    assert.equal(negative.focusSegment.ratio, 0);
});

test('the runtime projection carries the tower condition to every player HUD', () => {
    const entityManager = {
        arena: { currentMapDefinition: { destructibles: DESTRUCTIBLES }, glbAnimationElapsedSeconds: 0 },
        players: [
            { index: 0, alive: true, position: { x: 0, y: 0, z: 0 } },
            { index: 1, alive: true, position: { x: 0, y: 0, z: 0 } },
        ],
    };
    const destructibles = new MapDestructibleSystem(entityManager);
    destructibles.startRound();
    entityManager._mapDestructibleSystem = destructibles;

    const projectAt = (seconds) => {
        entityManager.arena.glbAnimationElapsedSeconds = seconds;
        return buildMatchRuntimeProjection({ game: { entityManager } })
            .players.map((player) => player.mapDestructible);
    };

    assert.deepEqual(projectAt(1), [INACTIVE, INACTIVE]);

    entityManager.arena.glbAnimationElapsedSeconds = 4;
    destructibles.applyMeshHit('shaft_iron', 20, { hitPoint: [0, 10, 0] });
    const damaged = projectAt(4);
    assert.equal(damaged.length, 2);
    assert.deepEqual(damaged[0], damaged[1], 'every player sees the same tower');
    assert.deepEqual(damaged[0].focusSegment, { id: 'shaft', label: 'Schaft', ratio: 0.6 });
    assert.equal(formatMapDestructibleStatus(damaged[0]), 'STRUKTUR · SCHAFT 60 %');

    entityManager.arena.glbAnimationElapsedSeconds = 6;
    destructibles.applyMeshHit('legs_lower_iron', 100, { hitPoint: [20, 4, 20] });
    const broken = projectAt(6);
    assert.equal(broken[0].sealed, true);
    assert.equal(broken[0].breakingSecondsRemaining, 8);
    assert.equal(formatMapDestructibleStatus(broken[0]), 'BEIN A ZERSTÖRT');

    // Once the announcement has run out the line goes quiet instead of handing the player back a
    // target: a sealed tower is already on its way down, and the damaged shaft is going with it.
    assert.deepEqual(broken[0].focusSegment, { id: 'leg_a', label: 'Bein A', ratio: 0 });
    assert.equal(formatMapDestructibleStatus(projectAt(15)[0]), '');
    assert.deepEqual(projectAt(15)[0], { ...INACTIVE, sealed: true });

    // A map without anything to shoot apart projects the inactive default.
    assert.deepEqual(
        buildMatchRuntimeProjection({ game: { entityManager: { players: entityManager.players } } })
            .players.map((player) => player.mapDestructible),
        [INACTIVE, INACTIVE],
    );
});

// ---------------------------------------------------------------------------
// HUD element (node has no DOM; the HUD only needs a small subset)
// ---------------------------------------------------------------------------

function createStubClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
        toggle(value, force) {
            const enabled = force === undefined ? !values.has(value) : !!force;
            if (enabled) values.add(value);
            else values.delete(value);
            return enabled;
        },
    };
}

function createStubElement(className = '') {
    return {
        className,
        style: {},
        dataset: {},
        attributes: {},
        children: [],
        textContent: '',
        clientWidth: 800,
        clientHeight: 450,
        classList: createStubClassList(),
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children.length = 0; },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; },
        querySelector(selector) {
            if (!this._queryCache) this._queryCache = new Map();
            if (!this._queryCache.has(selector)) this._queryCache.set(selector, createStubElement());
            return this._queryCache.get(selector);
        },
    };
}

function installDocumentStub() {
    const previousDocument = globalThis.document;
    const byId = new Map();
    globalThis.document = {
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, createStubElement());
            return byId.get(id);
        },
        createElement(tagName) { return createStubElement(tagName); },
    };
    return {
        byId,
        restore() {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        },
    };
}

test('the HUD shows the tower line only while there is something to report', () => {
    const documentStub = installDocumentStub();
    try {
        const hud = new HUD('p1-fighter-hud', 0, { getCamera: () => null });
        const element = hud.mapDestructibleStatus;
        const player = {
            alive: true,
            position: { x: 0, y: 10, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        };

        assert.ok(element, 'the HUD must own its own tower line');
        assert.equal(element.getAttribute('role'), 'status');
        assert.equal(element.getAttribute('aria-live'), 'polite');
        // It borrows the look of the exclusion-zone line instead of asking for new styling.
        assert.ok(element.className.includes('exclusion-zone-status'));
        assert.ok(element.className.includes('map-destructible-status'));
        assert.equal(documentStub.byId.get('p1-hud').children.includes(element), true);

        hud.update(player, 0.016);
        assert.equal(element.classList.contains('hidden'), true);
        assert.equal(element.textContent, '');

        hud.update({
            ...player,
            mapDestructible: {
                active: true,
                sealed: false,
                focusSegment: { id: 'leg_a', label: 'Bein A', ratio: 0.42 },
                breakingSecondsRemaining: 0,
            },
        }, 0.016);
        assert.equal(element.classList.contains('hidden'), false);
        assert.equal(element.textContent, 'STRUKTUR · BEIN A 42 %');
        assert.equal(element.classList.contains('breaking'), false);

        hud.update({
            ...player,
            mapDestructible: {
                active: true,
                sealed: false,
                focusSegment: { id: 'leg_a', label: 'Bein A', ratio: 0.42 },
                breakingSecondsRemaining: 5,
            },
        }, 0.016);
        assert.equal(element.textContent, 'BEIN A BRICHT');
        assert.equal(element.classList.contains('breaking'), true);

        // A dead player clears the line instead of leaving the last announcement standing.
        hud.update({ ...player, alive: false }, 0.016);
        assert.equal(element.classList.contains('hidden'), true);
        assert.equal(element.classList.contains('breaking'), false);
        assert.equal(element.textContent, '');
    } finally {
        documentStub.restore();
    }
});

test('a segment that went down with another piece leaves the HUD', () => {
    // The summit is worked down to 40 % and is what the line is showing. Then the shaft below it
    // goes, and the collapse takes the summit along - the HUD must not keep offering it as a
    // target, because there is nothing left up there to shoot at.
    const definition = normalizeMapDestructibles(DESTRUCTIBLES_WITH_SCENES);
    const state = createMapDestructibleState(definition);
    const hudAt = (seconds) => resolveMapDestructibleHudState(state, definition, seconds);

    applyMapDestructibleDamage(state, definition, 'summit', 30, { atSeconds: 2 });
    assert.deepEqual(hudAt(2).focusSegment, { id: 'summit', label: 'Spitze', ratio: 0.4 });
    assert.equal(formatMapDestructibleStatus(hudAt(2)), 'STRUKTUR · SPITZE 40 %');

    applyMapDestructibleDamage(state, definition, 'shaft', 50, { atSeconds: 6, hitDirection: { x: 1, z: 0 } });
    assert.equal(state.segments[1].collapsed, true);
    // The break is announced, and nothing takes the line back once it has run out.
    assert.equal(formatMapDestructibleStatus(hudAt(6)), 'SCHAFT BRICHT');
    assert.deepEqual(hudAt(6).focusSegment, { id: 'shaft', label: 'Schaft', ratio: 0 });
    assert.equal(hudAt(20).active, false);
    assert.equal(formatMapDestructibleStatus(hudAt(20)), '');
    // Both segments still report a ratio of zero, so the full list stays honest about the tower.
    assert.deepEqual(hudAt(20).segments.map((segment) => segment.ratio), [0, 0]);
});

test('host and replica derive the same HUD line from the same state', () => {
    const definition = normalizeMapDestructibles(DESTRUCTIBLES);
    const state = createMapDestructibleState(definition);
    applyMapDestructibleDamage(state, definition, 'shaft', 20, { atSeconds: 4 });

    const line = (seconds) => formatMapDestructibleStatus(
        createMatchRuntimePlayerProjection({
            playerIndex: 0,
            mapDestructible: resolveMapDestructibleHudState(state, definition, seconds),
        }).mapDestructible,
    );

    assert.equal(line(4), 'STRUKTUR · SCHAFT 60 %');
    assert.equal(line(400), 'STRUKTUR · SCHAFT 60 %', 'partial damage is not announced, it just stands');
});
