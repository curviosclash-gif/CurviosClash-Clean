import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, bind, fakeDocument } from './helpers/fake-hangar-dom.mjs';
import { createArcadeJourneyMenuView } from '../src/ui/arcade/ArcadeJourneyMenuView.js';
import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';
import { ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_STAGES } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_JOURNEY_MAP_NODES } from '../src/shared/contracts/ArcadeJourneyMapContract.js';

function setup(overrides = {}) {
    const view = createArcadeJourneyMenuView((tag, className, text = '') => {
        const element = new FakeElement(tag); element.className = className; element.textContent = text; return element;
    });
    const starts = [];
    view.bind(bind, stage => starts.push(stage.id));
    const state = { progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {} }, profileId: 'profile-a',
        profileName: 'Anna', playerCount: 2, available: true, legacyAccess: false, ...overrides };
    view.render(state);
    const find = selector => view.element.querySelectorAll(selector)[0];
    return { view, starts, state, find };
}

test('world zoom focuses a map node; controller back returns one level and restores world focus', () => {
    const { view, starts, find } = setup();
    const flightSchool = find('[data-journey-world="flight_school"]');
    flightSchool.click();
    const node = find('[data-journey-node="first_route"]');
    assert.equal(fakeDocument.activeElement, node);
    assert.equal(find('[data-journey-start="first_run"]').disabled, false);
    node.click();
    node.click();
    assert.deepEqual(starts, [], 'mouse selection never starts a run');
    assert.equal(view.activateFocused(node), true);
    assert.deepEqual(starts, ['first_run']);

    const drawer = new FakeElement('div'); drawer.classList.add('hidden');
    const navigation = new MenuNavigationRuntime({ ui: { mainMenu: view.element, arcadeJourneyBackButton: view.back, level4Drawer: drawer } });
    navigation._getVisiblePanelElement = () => view.element;
    let leftHub = 0;
    navigation.showMainNav = () => { leftHub++; };
    assert.equal(navigation._goBackFromCurrent('controller_back'), true);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.equal(fakeDocument.activeElement, flightSchool);
    assert.equal(leftHub, 0);
});

test('all legacy stage IDs remain reachable, while planned map nodes stay unstartable even with legacy access', () => {
    const { view, state, find, starts } = setup({ playerCount: 1, legacyAccess: true });
    assert.deepEqual(Object.keys(view.startButtons).sort(), ARCADE_JOURNEY_STAGES.map(stage => stage.id).sort());
    for (const stage of ARCADE_JOURNEY_STAGES) {
        view.openStage(stage.id);
        const button = view.startButtons[stage.id];
        assert.equal(button.disabled, false, stage.id);
        button.click();
    }
    assert.deepEqual(starts.sort(), ARCADE_JOURNEY_STAGES.map(stage => stage.id).sort());

    view.render(state);
    const planned = ARCADE_JOURNEY_MAP_NODES.find(node => node.id === 'weapon_mastery');
    assert.equal(planned.stageId, '');
    find('[data-journey-world="exclusion_zone"]').click();
    find(`[data-journey-node="${planned.id}"]`).click();
    find(`[data-journey-node="${planned.id}"]`).click();
    assert.equal(find(`[data-journey-start="${planned.id}"]`).disabled, true);
    assert.deepEqual(starts.sort(), ARCADE_JOURNEY_STAGES.map(stage => stage.id).sort());
});

test('a profile switch clears another profile’s unlocked journey access', () => {
    const { view, state, find } = setup();
    view.render({ ...state, profileId: 'profile-b', progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {
        flight_school: { medals: { normal: { medal: 1, runId: 'a-flight' } } },
        first_run: { medals: { normal: { medal: 1, runId: 'a-run' } } },
    } } });
    find('[data-journey-world="tower_city"]').click();
    const fiveFronts = find('[data-journey-start="five_fronts"]');
    assert.equal(fiveFronts.disabled, false);
    view.render(state);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.equal(fiveFronts.disabled, true);
    fiveFronts.click();
});

test('unreadable journey data disables every start without pretending saved progression was reset', () => {
    const { view, state } = setup({ legacyAccess: true });
    view.render({ ...state, available: false });
    for (const button of view.element.querySelectorAll('[data-journey-start]')) assert.equal(button.disabled, true);
    assert.match(view.element.children[1].textContent, /nicht sicher gelesen/);
});

test('rank tabs display ten stored rows and preserve independent human-party boards', () => {
    const { view, state, find } = setup();
    const rows = count => Array.from({ length: 10 }, (_, index) => ({
        runId: `run-${count}-${index}`, value: 10000 - index * 100, medal: 1, playerCount: count,
    }));
    view.render({ ...state, progress: { ...state.progress, boards: {
        'first_run:normal:1': rows(1), 'first_run:normal:2': rows(2),
    } } });
    view.openStage('first_run');
    const card = find('[data-journey-stage="first_run"]');
    const board = card.querySelectorAll('ol')[0];
    assert.equal(board.children.length, 10);
    assert.equal(find('[data-journey-players="2"]').getAttribute('aria-pressed'), 'true');
    find('[data-journey-players="1"]').click();
    assert.equal(board.children.length, 10);
    assert.equal(find('[data-journey-players="1"]').getAttribute('aria-pressed'), 'true');
    find('[data-journey-players="3"]').click();
    assert.equal(board.children.length, 1); assert.equal(board.children[0].textContent, 'Noch kein Ergebnis');
});

test('single player exposes only its own board and no two- or three-player controls', () => {
    const { view, state, find } = setup({ playerCount: 1 });
    const tabs = find('.arcade-journey-rank-tabs');
    assert.equal(tabs.classList.contains('hidden'), true);
    for (const button of tabs.children) assert.equal(button.disabled, true);
    view.openStage('first_run');
    const card = find('[data-journey-stage="first_run"]');
    assert.match(card.querySelectorAll('p').at(-1).textContent, /Allein/);
    view.render({ ...state, playerCount: 2 });
    assert.equal(tabs.classList.contains('hidden'), false);
    assert.equal(find('[data-journey-players="2"]').disabled, false);
    view.render(state);
    assert.equal(tabs.classList.contains('hidden'), true);
    assert.match(card.querySelectorAll('p').at(-1).textContent, /Allein/);
});

test('overview contains the whole reference route and selection updates details without zooming or starting', () => {
    const { view, find, starts } = setup({ playerCount: 1 });
    assert.equal(view.element.querySelectorAll('[data-journey-node]').filter(button => !button.classList.contains('hidden')).length, 22);
    const hydra = find('[data-journey-node="hydra"]');
    hydra.click();
    assert.equal(find('[data-journey-stage="hydra"]').classList.contains('hidden'), false);
    assert.equal(find('[data-journey-start="hydra"]').disabled, true);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.deepEqual(starts, []);
});

test('boss previews stay readable and planned nodes do not earn premature world rewards', () => {
    const { view, state, find } = setup();
    view.render({ ...state, briefings: { first_run: { label: 'Hydra', text: 'Besiege die Hydra.', silhouette: 'H' } } });
    view.openStage('first_run');
    assert.match(find('[data-journey-stage="first_run"]').querySelectorAll('.arcade-journey-briefing')[0].children[1].textContent, /Hydra/);

    const stages = Object.fromEntries(['flight_school', 'first_run', 'endless_hunt'].map(id => [id,
        { medals: { normal: { medal: 1, runId: id } } }]));
    view.render({ ...state, progress: { ...state.progress, stages } });
    const world = find('[data-journey-world="flight_school"]');
    assert.match(world.querySelectorAll('.journey-map-reward')[0].textContent, /weitere Etappen offen/);

    const earnedLegacyStages = Object.fromEntries(['flight_school', 'first_run', 'weapon_race'].map(id => [id,
        { medals: { normal: { medal: 1, runId: `legacy-${id}` } } }]));
    view.render({ ...state, progress: { ...state.progress, stages: earnedLegacyStages } });
    assert.match(find('.journey-legacy-rewards').textContent, /Aufbruch-Abzeichen/);
});

test('world and detail counts include only reachable stars and distinguish unimplemented stages', () => {
    const { view, state, find } = setup({ playerCount: 1 });
    const world = find('[data-journey-world="flight_school"]');
    assert.equal(world.querySelectorAll('.journey-map-progress')[0].textContent, '0/7 ★');
    assert.match(world.getAttribute('aria-label'), /0 von 7 Sternen, weitere Etappen offen/);
    const emptyWorld = find('[data-journey-world="storm_coast"]');
    assert.equal(emptyWorld.querySelectorAll('.journey-map-progress')[0].textContent, 'Etappen folgen');
    assert.match(emptyWorld.getAttribute('aria-label'), /Noch keine spielbaren Etappen/);
    view.openStage('flight_school');
    assert.equal(find('[data-journey-stage="flight_school"]').querySelectorAll('.arcade-journey-medal')[0].textContent, '☆ 0/1 Sterne');
    find('[data-journey-node="gaps_lesson"]').click();
    assert.equal(find('[data-journey-stage="gaps_lesson"]').querySelectorAll('.arcade-journey-medal')[0].textContent, 'Noch offen');
    const progress = { ...state.progress, stages: {
        flight_school: { medals: { normal: { medal: 1 } } },
        first_run: { medals: { normal: { medal: 3 } } },
        endless_hunt: { medals: { normal: { medal: 3 } } },
    } };
    view.render({ ...state, progress });
    assert.equal(world.querySelectorAll('.journey-map-progress')[0].textContent, '7/7 ★');
    assert.match(world.querySelectorAll('.journey-map-reward')[0].textContent, /weitere Etappen offen/);
    assert.doesNotMatch(world.querySelectorAll('.journey-map-reward')[0].textContent, /verdient/);
});

test('historical medals remain visible without impossible fractions or changes to saved progress', () => {
    const progress = { schema: ARCADE_JOURNEY_SCHEMA, stages: {
        flight_school: { medals: { normal: { medal: 3, runId: 'historical' } } },
    } };
    const before = structuredClone(progress);
    const { view, find } = setup({ playerCount: 1, progress });
    view.openStage('flight_school');
    assert.equal(find('[data-journey-stage="flight_school"]').querySelectorAll('.arcade-journey-medal')[0].textContent, '★★★ 3/3 Sterne');
    assert.equal(find('[data-journey-world="flight_school"]').querySelectorAll('.journey-map-progress')[0].textContent, '3/9 ★');
    assert.deepEqual(progress, before);
});
