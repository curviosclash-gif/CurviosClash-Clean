import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, bind, fakeDocument } from './helpers/fake-hangar-dom.mjs';
import { createArcadeJourneyMenuView } from '../src/ui/arcade/ArcadeJourneyMenuView.js';
import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';
import { ARCADE_JOURNEY_SCHEMA } from '../src/shared/contracts/ArcadeJourneyContract.js';

function setup() {
    const view = createArcadeJourneyMenuView((tag, className, text = '') => {
        const element = new FakeElement(tag); element.className = className; element.textContent = text; return element;
    });
    const starts = [];
    view.bind(bind, stage => starts.push(stage.id));
    const state = { progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {} }, profileId: 'profile-a',
        profileName: 'Anna', playerCount: 2, available: true, legacyAccess: false };
    view.render(state);
    const find = selector => view.element.querySelectorAll(selector)[0];
    return { view, starts, state, find };
}

test('world zoom focuses a playable stage; controller back returns one level and restores world focus', () => {
    const { view, starts, find } = setup();
    const departure = find('[data-journey-world="departure"]');
    departure.click();
    const first = find('[data-journey-start="first_run"]');
    assert.equal(fakeDocument.activeElement, first);
    first.click();
    assert.deepEqual(starts, ['first_run']);
    assert.equal(find('[data-journey-start="weapon_race"]').disabled, true);
    const drawer = new FakeElement('div'); drawer.classList.add('hidden');
    const navigation = new MenuNavigationRuntime({ ui: { mainMenu: view.element, arcadeJourneyBackButton: view.back, level4Drawer: drawer } });
    navigation._getVisiblePanelElement = () => view.element;
    let leftHub = 0;
    navigation.showMainNav = () => { leftHub++; };
    assert.equal(navigation._goBackFromCurrent('controller_back'), true);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.equal(fakeDocument.activeElement, departure);
    assert.equal(leftHub, 0);
});

test('a profile switch leaves the world view and cannot launch another profiles unlocked card', () => {
    const { view, state, find, starts } = setup();
    view.render({ ...state, progress: { schema: ARCADE_JOURNEY_SCHEMA, stages: {
        first_run: { medals: { normal: { medal: 3, runId: 'b-run' } } },
    } }, profileId: 'profile-b' });
    find('[data-journey-world="portals"]').click();
    const portalStart = find('[data-journey-start="five_portals"]');
    assert.equal(portalStart.disabled, false);
    view.render(state);
    assert.equal(view.back.classList.contains('hidden'), true);
    assert.equal(portalStart.disabled, true);
    portalStart.click();
    assert.deepEqual(starts, []);
});

test('unreadable journey data disables all journey awards without pretending progression was reset', () => {
    const { view, state } = setup();
    view.render({ ...state, available: false, legacyAccess: true });
    for (const button of view.element.querySelectorAll('[data-journey-start]')) assert.equal(button.disabled, true);
    assert.match(view.element.children[1].textContent, /nicht sicher gelesen/);
});


test('rank tabs display all ten stored rows and preserve the independent human-party boards', () => {
    const { view, state, find } = setup();
    const rows = count => Array.from({ length: 10 }, (_, index) => ({
        runId: `run-${count}-${index}`, value: 10000 - index * 100, medal: 1, playerCount: count,
    }));
    view.render({ ...state, progress: { ...state.progress, boards: {
        'first_run:normal:1': rows(1), 'first_run:normal:2': rows(2),
    } } });
    find('[data-journey-world="departure"]').click();
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


test('new labels and earned world rewards follow the current profile medals and boss preview is readable', () => {
    const { view, state, find } = setup();
    view.render({ ...state, briefings: { first_run: { label: 'Hydra', text: 'Besiege die Hydra.', silhouette: 'H' } } });
    assert.match(find('[data-journey-stage="first_run"]').children[0].textContent, /Neu/);
    assert.match(find('[data-journey-stage="first_run"]').querySelectorAll('.arcade-journey-briefing')[0].children[1].textContent, /Hydra/);
    const stages = Object.fromEntries(['flight_school', 'first_run', 'weapon_race'].map(id => [id,
        { medals: { normal: { medal: 1, runId: id } } }]));
    view.render({ ...state, progress: { ...state.progress, stages } });
    assert.doesNotMatch(find('[data-journey-stage="first_run"]').children[0].textContent, /Neu/);
    assert.match(find('[data-journey-world="departure"]').children.at(-1).textContent, /Aufbruch-Abzeichen · verdient/);
});
