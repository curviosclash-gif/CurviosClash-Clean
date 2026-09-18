import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { createHuntHudDomRefs } from '../src/ui/dom/HuntHudDomRefs.js';
import {
    ROCKET_WARNING_NEAR_DISTANCE,
    ROCKET_WARNING_NEAR_SECONDS,
    createRocketWarningCache,
    hideRocketWarning,
    resolveRocketWarningBearing,
    updateRocketWarning,
} from '../src/ui/HuntHudRocketWarning.js';

const INDEX_HTML = fileURLToPath(new URL('../index.html', import.meta.url));

// ---------------------------------------------------------------------------
// DOM stand-ins: node has no DOM, and the warning only touches text, one class
// list and one transform. Every write is counted so the test can prove that
// unchanged values never reach the document again.
// ---------------------------------------------------------------------------

function createStubElement() {
    const classes = new Set();
    const element = {
        writes: 0,
        attributes: {},
        classes,
        classList: {
            add(value) { classes.add(value); },
            remove(value) { classes.delete(value); },
            contains(value) { return classes.has(value); },
            toggle(value, force) {
                const enabled = force === undefined ? !classes.has(value) : !!force;
                if (enabled) classes.add(value);
                else classes.delete(value);
                element.writes += 1;
                return enabled;
            },
        },
        setAttribute(name, value) { element.attributes[name] = value; },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(element.attributes, name)
                ? element.attributes[name]
                : null;
        },
    };
    let text = '';
    Object.defineProperty(element, 'textContent', {
        get() { return text; },
        set(value) { text = value; element.writes += 1; },
    });
    element.style = new Proxy({}, {
        set(target, key, value) {
            target[key] = value;
            element.writes += 1;
            return true;
        },
    });
    return element;
}

function createRefs() {
    return { root: createStubElement(), arrow: createStubElement(), text: createStubElement() };
}

function totalWrites(refs) {
    return refs.root.writes + refs.arrow.writes + refs.text.writes;
}

/** Player projection with a rocket threat, normalized through the real contract. */
function projectPlayer(threat, overrides = {}) {
    return createMatchRuntimePlayerProjection({
        playerIndex: 0,
        alive: true,
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        ...overrides,
        rocketThreat: threat,
    });
}

/** Yaw of `degrees` around the world up axis, the only rotation a car really has. */
function yawQuaternion(degrees) {
    const half = (degrees * Math.PI) / 360;
    return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

const DEFAULT_OPTIONS = { huntActive: true, reduceMotion: true };

// ---------------------------------------------------------------------------
// Bearing: pure math, no DOM
// ---------------------------------------------------------------------------

test('the bearing is read in the screen plane of a rotated player', () => {
    // The player looks along world -X: a car with 90 degrees of yaw. Forward is
    // (0,0,-1) rotated by the quaternion, so nothing here works by accident on an
    // identity rotation.
    const yaw90 = yawQuaternion(90);
    const bearingOf = (direction) => {
        const bearing = resolveRocketWarningBearing(direction, yaw90);
        return { angleDeg: Math.round(bearing.angleDeg), axis: bearing.axis };
    };

    assert.deepEqual(bearingOf({ x: 0, y: 0, z: -1 }), { angleDeg: 90, axis: 'side' }, 'right');
    assert.deepEqual(bearingOf({ x: 0, y: 0, z: 1 }), { angleDeg: -90, axis: 'side' }, 'left');
    assert.deepEqual(bearingOf({ x: 0, y: 1, z: 0 }), { angleDeg: 0, axis: 'side' }, 'above');
    assert.deepEqual(bearingOf({ x: 0, y: -1, z: 0 }), { angleDeg: 180, axis: 'side' }, 'below');

    // Almost exactly behind and almost exactly ahead: the screen-plane angle would
    // jitter with every frame, so the bearing names the axis instead.
    assert.deepEqual(bearingOf({ x: 1, y: 0.01, z: 0.01 }), { angleDeg: 180, axis: 'behind' });
    assert.deepEqual(bearingOf({ x: -1, y: 0.01, z: -0.01 }), { angleDeg: 0, axis: 'ahead' });

    // Unusable input never throws and never invents a direction.
    assert.deepEqual(resolveRocketWarningBearing(null, yaw90).axis, 'unknown');
    assert.deepEqual(resolveRocketWarningBearing({ x: 0, y: 0, z: 0 }, null).axis, 'unknown');
});

// ---------------------------------------------------------------------------
// Element update
// ---------------------------------------------------------------------------

test('no threat keeps the warning out of the way', () => {
    const refs = createRefs();
    const cache = createRocketWarningCache();

    updateRocketWarning(refs, cache, projectPlayer(null), DEFAULT_OPTIONS);
    assert.equal(refs.root.classList.contains('hidden'), true);
    assert.equal(refs.root.getAttribute('aria-hidden'), 'true');
    assert.equal(refs.text.textContent, '');

    // A live threat, but the Hunt HUD is not on screen at all.
    updateRocketWarning(refs, cache, projectPlayer({ count: 1, nearestDistance: 20 }), {
        huntActive: false, reduceMotion: true,
    });
    assert.equal(refs.root.classList.contains('hidden'), true);

    // A dead player sees no warning either - the rocket is no longer his problem.
    updateRocketWarning(
        refs,
        cache,
        projectPlayer({ count: 1, nearestDistance: 20 }, { alive: false }),
        DEFAULT_OPTIONS,
    );
    assert.equal(refs.root.classList.contains('hidden'), true);

    updateRocketWarning(refs, cache, null, DEFAULT_OPTIONS);
    assert.equal(refs.root.classList.contains('hidden'), true);
});

test('an inbound rocket is spelled out with distance, count and arrow', () => {
    const refs = createRefs();
    const cache = createRocketWarningCache();

    updateRocketWarning(refs, cache, projectPlayer({
        count: 1,
        nearestDistance: 87.4,
        direction: { x: 0, y: 0, z: -1 },
        source: 'player',
    }, { quaternion: yawQuaternion(90) }), DEFAULT_OPTIONS);

    assert.equal(refs.root.classList.contains('hidden'), false);
    assert.equal(refs.root.getAttribute('aria-hidden'), 'false');
    assert.equal(refs.root.getAttribute('role'), 'status');
    // Whole units, no decimals, and no count while a single rocket is chasing.
    assert.equal(refs.text.textContent, 'RAKETE · 87');
    assert.equal(refs.arrow.style.transform, 'rotate(90.0deg)');

    // Two rockets get a count, and the nearest one still sets distance and arrow.
    updateRocketWarning(refs, cache, projectPlayer({
        count: 2,
        nearestDistance: 60.6,
        direction: { x: 1, y: 0, z: 0 },
    }, { quaternion: yawQuaternion(90) }), DEFAULT_OPTIONS);
    assert.equal(refs.text.textContent, 'RAKETE ×2 · 61 · HINTEN');
    assert.equal(refs.arrow.style.transform, 'rotate(180.0deg)');
});

test('urgency comes from distance or time to impact, never from time zero', () => {
    const refs = createRefs();
    const cache = createRocketWarningCache();
    const update = (threat) => updateRocketWarning(
        refs,
        cache,
        projectPlayer({ direction: { x: 0, y: 0, z: -1 }, ...threat }),
        DEFAULT_OPTIONS,
    );

    update({ count: 1, nearestDistance: ROCKET_WARNING_NEAR_DISTANCE + 20 });
    assert.equal(refs.root.classList.contains('near'), false);

    update({ count: 1, nearestDistance: ROCKET_WARNING_NEAR_DISTANCE - 1 });
    assert.equal(refs.root.classList.contains('near'), true);

    // Far away, but closing in fast.
    update({
        count: 1,
        nearestDistance: ROCKET_WARNING_NEAR_DISTANCE + 60,
        timeToImpactSeconds: ROCKET_WARNING_NEAR_SECONDS - 0.5,
    });
    assert.equal(refs.root.classList.contains('near'), true);

    // Zero seconds means "unknown", not "impact now": a locked rocket that is not
    // actually closing in must not light up the panic state.
    update({
        count: 1,
        nearestDistance: ROCKET_WARNING_NEAR_DISTANCE + 60,
        timeToImpactSeconds: 0,
    });
    assert.equal(refs.root.classList.contains('near'), false);
});

test('reduce motion drops the pulse and leaves text, arrow and colour', () => {
    const calm = createRefs();
    const lively = createRefs();
    const threat = projectPlayer({ count: 1, nearestDistance: 10, direction: { x: 0, y: 0, z: -1 } });

    updateRocketWarning(calm, createRocketWarningCache(), threat, { huntActive: true, reduceMotion: true });
    assert.equal(calm.root.classList.contains('pulse'), false);
    assert.equal(calm.root.classList.contains('near'), true, 'urgency stays readable without motion');
    // Unrotated player, rocket dead ahead: the word replaces a spinning arrow.
    assert.equal(calm.text.textContent, 'RAKETE · 10 · VORN');

    updateRocketWarning(lively, createRocketWarningCache(), threat, { huntActive: true, reduceMotion: false });
    assert.equal(lively.root.classList.contains('pulse'), true);
});

test('unchanged values never touch the document twice', () => {
    const refs = createRefs();
    const cache = createRocketWarningCache();
    const threat = projectPlayer({ count: 1, nearestDistance: 30.2, direction: { x: 0, y: 0, z: -1 } });

    updateRocketWarning(refs, cache, threat, DEFAULT_OPTIONS);
    const afterFirst = totalWrites(refs);
    assert.ok(afterFirst > 0, 'the first frame has to write something');

    for (let i = 0; i < 30; i += 1) {
        updateRocketWarning(refs, cache, threat, DEFAULT_OPTIONS);
    }
    assert.equal(totalWrites(refs), afterFirst, 'a steady threat writes nothing again');

    // 30.2 and 30.4 round to the same whole unit, so the text stays as it is.
    updateRocketWarning(
        refs,
        cache,
        projectPlayer({ count: 1, nearestDistance: 30.4, direction: { x: 0, y: 0, z: -1 } }),
        DEFAULT_OPTIONS,
    );
    assert.equal(totalWrites(refs), afterFirst, 'rounding hides the noise of a moving rocket');

    hideRocketWarning(refs, cache);
    assert.equal(refs.root.classList.contains('hidden'), true);
    assert.equal(refs.text.textContent, '');
});

// ---------------------------------------------------------------------------
// Markup and refs
// ---------------------------------------------------------------------------

test('both warnings exist in the markup and reach the Hunt HUD refs', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');
    for (const id of [
        'hunt-rocket-warning', 'hunt-rocket-warning-arrow', 'hunt-rocket-warning-text',
        'hunt-rocket-warning-p2', 'hunt-rocket-warning-arrow-p2', 'hunt-rocket-warning-text-p2',
    ]) {
        assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
    }
    // Screen readers announce the warning; it must not be colour alone.
    assert.match(html, /id="hunt-rocket-warning"[^>]*role="status"/);
    assert.match(html, /id="hunt-rocket-warning"[^>]*aria-live="polite"/);
    assert.match(html, /id="hunt-rocket-warning-p2"[^>]*role="status"/);

    const seen = [];
    const refs = createHuntHudDomRefs({
        getElementById(id) { seen.push(id); return { id }; },
        createElement() { return {}; },
    });
    assert.deepEqual(refs.rocketWarningP1, { id: 'hunt-rocket-warning' });
    assert.deepEqual(refs.rocketWarningArrowP1, { id: 'hunt-rocket-warning-arrow' });
    assert.deepEqual(refs.rocketWarningTextP1, { id: 'hunt-rocket-warning-text' });
    assert.deepEqual(refs.rocketWarningP2, { id: 'hunt-rocket-warning-p2' });
    assert.deepEqual(refs.rocketWarningArrowP2, { id: 'hunt-rocket-warning-arrow-p2' });
    assert.deepEqual(refs.rocketWarningTextP2, { id: 'hunt-rocket-warning-text-p2' });
});
