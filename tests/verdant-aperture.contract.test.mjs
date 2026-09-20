import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { VERDANT_APERTURE_MAP } from '../src/core/config/maps/presets/verdant_aperture.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import {
    resolveMapSinglePlayerScenario,
    resolveMapStaticTurretDefinitions,
} from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { normalizeMapAnimationClock } from '../src/shared/contracts/MapAnimationClockContract.js';

const map = VERDANT_APERTURE_MAP.verdant_aperture;
const SETPIECE_PREFIX = 'assets/maps/verdant_aperture/glb/';
const WILDWUCHS_PREFIX = 'assets/models/verdant_wildwuchs/';
const MUSHROOM_PREFIX = 'assets/models/glowing_mushroom/';
const BEAT_SECONDS = 6;
const DECK_CELL = 30;
const DECK_CELLS_PER_AXIS = 10;
const ROOT_DECK_Y = 54;
const CROWN_DECK_Y = 112;

function setpieces() {
    return map.glbModels.filter((model) => model.url.startsWith(SETPIECE_PREFIX));
}

test('the cellar fungus keeps clear of the planting already down there', () => {
    // Decoration has no collider, so two models placed on top of each other produce no error,
    // no warning and no test failure - just a fern growing through a mushroom. The cellar was
    // already the most crowded storey before the fungus arrived, which is what makes this worth
    // asserting rather than eyeballing.
    const mushrooms = map.glbModels.filter((model) => model.url.startsWith(MUSHROOM_PREFIX));
    assert.ok(mushrooms.length >= 10, 'the cellar actually has fungus in it');

    // Everything else standing on the cellar floor. The decks start at y=54, so anything below
    // the first of them shares the cellar with the mushrooms.
    const neighbours = map.glbModels.filter((model) => !model.url.startsWith(MUSHROOM_PREFIX)
        && model.position[1] < ROOT_DECK_Y);
    assert.ok(neighbours.length >= 8, 'the cellar planting is still there to avoid');

    for (const mushroom of mushrooms) {
        assert.equal(mushroom.collision, false, `${mushroom.id} stays decoration`);
        assert.equal(mushroom.position[1], 8, `${mushroom.id} stands on the cellar floor`);
        for (const neighbour of neighbours) {
            const distance = Math.hypot(mushroom.position[0] - neighbour.position[0],
                mushroom.position[2] - neighbour.position[2]);
            // Both radii, from the target sizes the map authored. A mushroom may stand beside a
            // fern; it may not stand in one.
            const clearance = (mushroom.targetSize + (neighbour.targetSize || 0)) / 2;
            assert.ok(distance > clearance,
                `${mushroom.id} clears ${neighbour.id}: ${distance.toFixed(1)} > ${clearance.toFixed(1)}`);
        }
    }
});

function deckCells(y) {
    return map.obstacles.filter((obstacle) => (
        obstacle.pos[1] === y && obstacle.size[0] === DECK_CELL && obstacle.size[2] === DECK_CELL
    ));
}

test('Verdant Aperture is registered everywhere a map has to appear', () => {
    assert.equal(MAP_PRESET_CATALOG.verdant_aperture, map);
    assert.equal(MAP_PRESETS_BASE.verdant_aperture, map);
    assert.deepEqual(map.size, [300, 200, 300]);

    // Without a collection the picker drops the map into the unsorted fallback bucket.
    assert.equal(resolveMapPickerCollection('verdant_aperture').id, 'adventure');
});

test('Verdant Aperture is laid out for hunt rather than for a route', () => {
    // This is the first Blender map that is a fighting space instead of a course, so the absence
    // of a parcours block is the point, not an omission.
    assert.equal(map.parcours, undefined);

    const scenario = resolveMapSinglePlayerScenario(map);
    assert.ok(scenario, 'the map carries a resolvable single player scenario');
    assert.equal(scenario.gameMode, 'HUNT');
    assert.equal(scenario.modePath, 'fight');
    assert.ok(scenario.minBots >= 4, 'a hunt needs enough opponents to stay a hunt');
    assert.deepEqual([...scenario.botRoles], ['guard', 'flanker', 'pursuer', 'interceptor']);

    const turrets = resolveMapStaticTurretDefinitions(map);
    assert.equal(turrets.length, 3);
    assert.ok(turrets.some((turret) => turret.weapon === 'rocket'), 'one turret answers with rockets');

    assert.ok(
        map.missions.some((mission) => mission.type === 'KILL_COUNT'),
        'missions reward fighting, not lap times',
    );
    assert.equal(map.missions.some((mission) => mission.type === 'TIME_TRIAL'), false);
});

test('every setpiece states a clip name and a phase on the shared map beat', () => {
    assert.deepEqual(map.glbAnimationClock, { beatSeconds: BEAT_SECONDS });
    assert.equal(map.glbColliderMode, 'dynamic');

    const animated = setpieces();
    assert.equal(animated.length, 13);
    assert.equal(new Set(map.glbModels.map((model) => model.id)).size, map.glbModels.length);

    for (const model of animated) {
        const clock = normalizeMapAnimationClock(model.animationClock, map.glbAnimationClock);
        assert.equal(clock.beatSeconds, BEAT_SECONDS, `${model.id} inherits the map beat`);
        assert.ok(clock.clipName, `${model.id} names the clip it plays`);
        assert.ok(
            clock.phaseOffsetBeats >= 0 && clock.phaseOffsetBeats < 1,
            `${model.id} offsets within a single beat (got ${clock.phaseOffsetBeats})`,
        );
    }

    for (const model of map.glbModels) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
    }
});

test('Verdant Wildwuchs stays on level edges and clear of spawns and moving joins', () => {
    const decorations = map.glbModels.filter((model) => model.url.startsWith(WILDWUCHS_PREFIX));
    assert.equal(decorations.length, 9);
    for (const family of ['root', 'fern', 'vine']) {
        const variants = decorations.filter((model) => model.url.endsWith(`/${family}_v01.glb`)
            || model.url.endsWith(`/${family}_v02.glb`) || model.url.endsWith(`/${family}_v03.glb`));
        assert.equal(variants.length, 3, `${family} has three distinct variants`);
        assert.deepEqual(variants.map((model) => model.position[1]),
            Array(3).fill({ root: 8, fern: 58, vine: 116 }[family]));
    }
    const tree = map.glbModels.filter((model) => model.url.includes('/ancient_tree/'));
    assert.equal(tree.length, 1, 'one existing tree variant is the only hero');

    const anchors = [map.playerSpawn, ...map.botSpawns,
        ...map.portals.flatMap((portal) => [portal.a, portal.b].map(([x, y, z]) => ({ x, y, z })))];
    const joins = setpieces().filter((model) => model.position[1] === ROOT_DECK_Y
        || model.position[1] === CROWN_DECK_Y);
    for (const model of decorations) {
        assert.equal(model.animationClock, undefined, `${model.id} adds no loop`);
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} has a runtime asset`);
        assert.ok(Math.abs(model.position[0]) >= 75 || Math.abs(model.position[2]) >= 105,
            `${model.id} leaves the central flight lanes open`);
        for (const anchor of anchors) {
            if (Math.abs(anchor.y - model.position[1]) > 25) continue;
            assert.ok(Math.hypot(anchor.x - model.position[0], anchor.z - model.position[2]) > model.targetSize / 2 + 12,
                `${model.id} stays away from a spawn or portal`);
        }
        for (const join of joins) {
            assert.ok(Math.hypot(join.position[0] - model.position[0], join.position[2] - model.position[2])
                > model.targetSize / 2 + 25, `${model.id} stays away from a moving join`);
        }
    }
});

test('paired setpieces run on opposite phases so both ways up are never alike', () => {
    // Two shutters showing the same opening at the same moment would collapse the choice between
    // the two routes up into one route with two doors.
    const phaseOf = (id) => normalizeMapAnimationClock(
        map.glbModels.find((model) => model.id === `verdant-aperture-${id}`).animationClock,
        map.glbAnimationClock,
    ).phaseOffsetBeats;

    assert.notEqual(phaseOf('leaf-shutter-west'), phaseOf('leaf-shutter-east'));
    assert.notEqual(phaseOf('bloom-west'), phaseOf('bloom-east'));
    assert.notEqual(phaseOf('mill-north'), phaseOf('mill-south'));
    assert.notEqual(phaseOf('canopy-west'), phaseOf('canopy-east'));
    assert.notEqual(phaseOf('root-arch-west'), phaseOf('root-arch-east'));
});

test('each storey deck is closed except where a setpiece gates the way through', () => {
    // The whole level structure rests on this. If a deck had a hole with no setpiece in it, that
    // hole would be permanently open and nobody would ever have to read a traveling opening; if a
    // setpiece sat on solid deck, it would gate nothing at all.
    for (const [y, expectedJoins] of [[ROOT_DECK_Y, 2], [CROWN_DECK_Y, 3]]) {
        const cells = deckCells(y);
        assert.equal(
            cells.length,
            DECK_CELLS_PER_AXIS * DECK_CELLS_PER_AXIS - expectedJoins,
            `the deck at y=${y} is closed apart from its ${expectedJoins} joins`,
        );

        const occupied = new Set(cells.map((cell) => `${cell.pos[0]}/${cell.pos[2]}`));
        const gates = setpieces().filter((model) => model.position[1] === y);
        assert.equal(gates.length, expectedJoins, `the deck at y=${y} carries one setpiece per join`);

        for (const gate of gates) {
            const key = `${gate.position[0]}/${gate.position[2]}`;
            assert.equal(occupied.has(key), false, `${gate.id} sits in a hole, not on solid deck`);
            // The cut-out is one cell; a shut shutter has to overlap its rim rather than float
            // inside it, or the ring of open air around it becomes a permanent way through.
            assert.ok(
                gate.targetSize > DECK_CELL,
                `${gate.id} overlaps the rim of its ${DECK_CELL} unit cut-out (got ${gate.targetSize})`,
            );
        }
    }
});

test('players and bots start spread across all three levels', () => {
    // A shared start line would settle the match before anyone had to cross a deck.
    const levelOf = (y) => (y < ROOT_DECK_Y ? 'root' : (y < CROWN_DECK_Y ? 'crown' : 'canopy'));
    const spawns = [map.playerSpawn, ...map.botSpawns];

    assert.ok(map.botSpawns.length >= 4, 'enough spawns for the scenario bot count');
    assert.equal(new Set(spawns.map((spawn) => levelOf(spawn.y))).size, 3, 'all three levels are used');

    const [width, height, depth] = map.size;
    for (const spawn of spawns) {
        assert.ok(Math.abs(spawn.x) < width / 2, 'spawn fits in X');
        assert.ok(spawn.y > 0 && spawn.y < height, 'spawn fits in Y');
        assert.ok(Math.abs(spawn.z) < depth / 2, 'spawn fits in Z');
    }
});

test('rocket pickups sit at the level joins the movement actually gates', () => {
    // Machine gun fire ignores obstacles, so the moving geometry only matters for flight paths
    // and rockets. Putting the rockets anywhere else would leave the animation decorative.
    const rockets = map.items.filter((item) => item.type === 'item_rocket');
    assert.ok(rockets.length >= 3, 'the map hands out rockets as its signature reward');

    const joinColumns = setpieces()
        .filter((model) => model.position[1] === ROOT_DECK_Y || model.position[1] === CROWN_DECK_Y)
        .map((model) => [model.position[0], model.position[2]]);

    // Rewards sit just beyond the join, clear of the crown's static walls.
    const atJoin = rockets.filter((item) => joinColumns.some(([x, z]) => Math.hypot(item.x - x, item.z - z) <= 10));
    assert.ok(
        atJoin.length >= 3,
        `most rockets sit under or above a gated join, got ${atJoin.length} of ${rockets.length}`,
    );
});
