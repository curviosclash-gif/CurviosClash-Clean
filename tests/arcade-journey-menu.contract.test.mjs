import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, bind, fakeDocument, createEvent } from './helpers/fake-hangar-dom.mjs';
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

test('adding Notre-Dame keeps the previously earned departure badge visible', () => {
    const stages = Object.fromEntries(['flight_school', 'first_run', 'weapon_race'].map(id =>
        [id, { medals: { normal: { medal: 1 } } }]));
    const { find } = setup({ progress: { schema: ARCADE_JOURNEY_SCHEMA, stages } });
    const rewards = find('.journey-legacy-rewards');
    assert.match(rewards.textContent, /Aufbruch-Abzeichen/);
    assert.equal(rewards.classList.contains('hidden'), false);
    assert.equal(stages.notre_dame, undefined);
});

test('locked journey keeps its explicit free start, and recommendation restores the Journey valuation', () => {
    const { view, find, starts } = setup({ playerCount: 1 });
    const free = []; view.setFreeStarts({ fivePortals: () => free.push('five_portals') });
    find('[data-journey-node="five_portals"]').click();
    const card = find('[data-journey-stage="five_portals"]'), mode = card.querySelectorAll('select')[0], start = view.startButtons.five_portals;
    assert.equal(start.disabled, true); assert.match(card.querySelectorAll('.menu-hint').find(p => /insgesamt/.test(p.textContent)).textContent, /1 Reisestern/);
    mode.value = 'free'; mode.dispatchEvent(createEvent('change')); assert.equal(start.disabled, false); start.click();
    assert.deepEqual(starts, []); assert.deepEqual(free, ['five_portals']);
    find('[data-journey-world="orbit"]').click();
    const filter = find('[aria-label="Kartenziele anzeigen"]'); filter.value = 'tour'; filter.dispatchEvent(createEvent('change'));
    find('.journey-next').click();
    assert.equal(filter.value, 'all'); assert.equal(find('[data-journey-node="first_route"]').getAttribute('aria-pressed'), 'true');
    assert.equal(view.back.classList.contains('hidden'), true); assert.deepEqual(starts, []);
});

test('unreadable progress never renders zero medals or recommendations; free tours remain available', () => {
    const { view, state, find } = setup({ playerCount: 1 });
    view.render({ ...state, available: false });
    assert.equal(find('.journey-next').disabled, true);
    view.openStage('five_portals'); const card = find('[data-journey-stage="five_portals"]');
    assert.match(card.querySelectorAll('.arcade-journey-medal')[0].textContent, /nicht lesbar/);
    assert.equal(card.querySelectorAll('.journey-medal-target')[0].textContent, '');
    const mode = card.querySelectorAll('select')[0]; mode.value = 'free'; mode.dispatchEvent(createEvent('change'));
    assert.equal(view.startButtons.five_portals.disabled, false);
    assert.equal(find('[data-journey-start="portal_chain_k19"]').disabled, false);
});

test('empty world filters show an explanation and returning to overview restores a valid selection', () => {
    const { view, find } = setup({playerCount:1});
    find('[data-journey-world="storm_coast"]').click();
    const filter=find('[aria-label="Kartenziele anzeigen"]'); filter.value='tour'; filter.dispatchEvent(createEvent('change'));
    assert.equal(find('[role="status"]').classList.contains('hidden'),false);
    assert.equal(view.element.querySelectorAll('.arcade-journey-stage').some(card=>!card.classList.contains('hidden')),false);
    view.back.click(); assert.equal(find('[role="status"]').classList.contains('hidden'),true);
    assert.equal(find('[data-journey-node="sky_ladder"]').classList.contains('hidden'),false);
});

test('medal gap uses the current party board and not the browsed leaderboard or earlier rules', () => {
    const { view, state, find } = setup({ playerCount: 1 });
    const progress = { ...state.progress, stages: { notre_dame: { medals: { normal: { medal: 2 } } } }, boards: {
        'notre_dame:normal:1': [{ value: 198000, playerCount: 1, medal: 2, runId: 'nd' }],
    } };
    view.render({ ...state, progress }); view.openStage('notre_dame');
    const target = find('[data-journey-stage="notre_dame"]').querySelectorAll('.journey-medal-target')[0];
    assert.match(target.textContent, /18\.00 s schneller/);
    view.render({ ...state, progress, playerCount: 2 });
    assert.doesNotMatch(target.textContent, /18\.00/);
    find('[data-journey-players="1"]').click(); assert.doesNotMatch(target.textContent, /18\.00/);
});

test('current Rift times and historical v1/v2 scores are displayed separately', () => {
    const old = { runId: 'old', value: 99999, medal: 3, playerCount: 2 };
    const current = { runId: 'new', value: 94000, medal: 2, playerCount: 2 };
    const { view, state, find } = setup({ progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {}, boards: {
        'first_run:normal:2': [old], 'first_run:normal:2:v2': [old], 'first_run:normal:2:v3': [current],
    } } });
    view.openStage('first_run');
    const card = find('[data-journey-stage="first_run"]');
    const board = card.querySelectorAll('.arcade-journey-board')[0];
    const history = card.querySelectorAll('.arcade-journey-board-history')[0];
    assert.deepEqual(board.children.map(row => row.textContent), ['94.00 s']);
    assert.equal(history.classList.contains('hidden'), false);
    assert.deepEqual(card.querySelectorAll('.arcade-journey-legacy-board')[0].children.map(row => row.textContent),
        ['Regeln v1: 99.999 Punkte', 'Regeln v2: 99.999 Punkte']);
    find('[data-journey-players="1"]').click();
    assert.equal(history.classList.contains('hidden'), true);
    view.render({ ...state, tiers: { first_run: 'hard' } });
    assert.equal(history.classList.contains('hidden'), true);
    assert.equal(state.progress.boards['first_run:normal:2'][0], old);
});

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
    assert.deepEqual(starts, [], 'controller A opens details, never launches the selected map node');
    assert.equal(fakeDocument.activeElement, find('[data-journey-start="first_run"]'));
    find('[data-journey-start="first_run"]').click();
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

test('all authored stage IDs remain reachable for grandfathered profiles without placeholder starts', () => {
    const { view, find, starts } = setup({ playerCount: 1, legacyAccess: true,
        progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {}, allStagesUnlocked: true } });
    assert.deepEqual(Object.keys(view.startButtons).sort(), ARCADE_JOURNEY_STAGES.map(stage => stage.id).sort());
    for (const stage of ARCADE_JOURNEY_STAGES) {
        view.openStage(stage.id);
        const button = view.startButtons[stage.id];
        assert.equal(button.disabled, false, stage.id);
        button.click();
    }
    assert.deepEqual(starts.sort(), ARCADE_JOURNEY_STAGES.map(stage => stage.id).sort());

    assert.equal(ARCADE_JOURNEY_MAP_NODES.some(node => node.development), false);
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
    for (const [stageId, button] of Object.entries(view.startButtons)) assert.equal(button.disabled, true, stageId);
    assert.match(view.element.children[1].textContent, /nicht sicher gelesen/);
});

test('rank tabs display ten stored rows and preserve independent human-party boards', () => {
    const { view, state, find } = setup();
    const rows = count => Array.from({ length: 10 }, (_, index) => ({
        runId: `run-${count}-${index}`, value: 10000 - index * 100, medal: 1, playerCount: count,
    }));
    view.render({ ...state, progress: { ...state.progress, boards: {
        'first_run:normal:1:v3': rows(1), 'first_run:normal:2:v3': rows(2),
    } } });
    view.openStage('first_run');
    const card = find('[data-journey-stage="first_run"]');
    const board = card.querySelectorAll('.arcade-journey-board')[0];
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

test('overview contains every playable node and selection updates details without starting', () => {
    const { view, find, starts } = setup({ playerCount: 1 });
    assert.equal(view.element.querySelectorAll('[data-journey-node]').filter(button => !button.classList.contains('hidden')).length, ARCADE_JOURNEY_MAP_NODES.length);
    const convoy = find('[data-journey-node="bridge_convoy"]');
    convoy.click();
    assert.equal(find('[data-journey-stage="bridge_convoy"]').classList.contains('hidden'), false);
    assert.equal(find('[data-journey-start="bridge_convoy"]').disabled, true);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.deepEqual(starts, []);
});

test('story briefing and prior medals stay visible', () => {
    const { view, state, find } = setup();
    view.render({ ...state, briefings: { first_run: { label: 'Hydra', text: 'Besiege die Hydra.', silhouette: 'H' } } });
    view.openStage('first_run');
    assert.match(find('[data-journey-stage="first_run"]').querySelectorAll('.arcade-journey-briefing')[0].children[0].textContent, /Portalnetz/);

    const stages = Object.fromEntries(['flight_school', 'first_run', 'endless_hunt'].map(id => [id,
        { medals: { normal: { medal: 1, runId: id } } }]));
    view.render({ ...state, progress: { ...state.progress, stages } });
    const world = find('[data-journey-world="flight_school"]');
    assert.ok(world.querySelectorAll('.journey-map-reward')[0].textContent);

    const earnedLegacyStages = Object.fromEntries(['flight_school', 'first_run', 'weapon_race'].map(id => [id,
        { medals: { normal: { medal: 1, runId: `legacy-${id}` } } }]));
    view.render({ ...state, progress: { ...state.progress, stages: earnedLegacyStages } });
    assert.match(find('.journey-legacy-rewards').textContent, /Aufbruch-Abzeichen/);
});

test('world and detail counts include authored stars only', () => {
    const { view, state, find } = setup({ playerCount: 1 });
    const world = find('[data-journey-world="flight_school"]');
    assert.equal(world.querySelectorAll('.journey-map-progress')[0].textContent, '0/13 ★');
    assert.match(world.getAttribute('aria-label'), /0 von 13 Sternen/);
    const emptyWorld = find('[data-journey-world="storm_coast"]');
    assert.equal(emptyWorld.querySelectorAll('.journey-map-progress')[0].textContent, '0/3 ★');
    view.openStage('flight_school');
    assert.equal(find('[data-journey-stage="flight_school"]').querySelectorAll('.arcade-journey-medal')[0].textContent, '☆ 0/1 Sterne');
    const progress = { ...state.progress, stages: {
        flight_school: { medals: { normal: { medal: 1 } } },
        first_run: { medals: { normal: { medal: 3 } } },
        endless_hunt: { medals: { normal: { medal: 3 } } },
    } };
    view.render({ ...state, progress });
    assert.equal(world.querySelectorAll('.journey-map-progress')[0].textContent, '7/13 ★');
    assert.ok(world.querySelectorAll('.journey-map-reward')[0].textContent);
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
    assert.equal(find('[data-journey-world="flight_school"]').querySelectorAll('.journey-map-progress')[0].textContent, '3/15 ★');
    assert.deepEqual(progress, before);
});


test('Endlos offers free seeds by default, explicit fixed training, and clears another profile choice', () => {
    const {view,find,state}=setup({playerCount:1});
    assert.equal(view.getEndlessStartOptions().seedMode,'free');
    const card=find('[data-journey-stage="endless_hunt"]');
    const choice=card.querySelectorAll('select').find(el=>el.getAttribute('aria-label')==='Endlosjagd: Strecke');
    const seed=card.querySelectorAll('input')[0];
    choice.value='training';choice.dispatchEvent(createEvent('change'));seed.value='130202';
    assert.deepEqual(view.getEndlessStartOptions(),{seedMode:'training',trainingSeed:130202});
    assert.equal(seed.disabled,false);
    view.render({...state,profileId:'profile-b'});
    assert.equal(view.getEndlessStartOptions().seedMode,'free');assert.equal(seed.disabled,true);
});
