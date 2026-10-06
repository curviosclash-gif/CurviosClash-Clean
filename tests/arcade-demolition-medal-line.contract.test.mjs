import test from 'node:test';
import assert from 'node:assert/strict';

import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';
import { DEMOLITION_MEDAL_RECORD_STORAGE_KEY } from '../src/shared/contracts/DemolitionMedalRecordContract.js';

function createFakeDocument() {
    const doc = {
        createElement(tagName) {
            const classes = new Set();
            const element = {
                tagName: String(tagName).toUpperCase(),
                ownerDocument: doc,
                parentElement: null,
                children: [],
                textContent: '',
                classList: {
                    add: (name) => classes.add(name),
                    contains: (name) => classes.has(name),
                    toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name), classes.has(name)),
                },
                set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
                get className() { return [...classes].join(' '); },
                appendChild(child) { child.parentElement = element; element.children.push(child); return child; },
            };
            return element;
        },
    };
    return doc;
}

function createStore(record) {
    const data = new Map(record === undefined ? [] : [[DEMOLITION_MEDAL_RECORD_STORAGE_KEY, record]]);
    return {
        data,
        loadJsonRecord: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
    };
}

function mountMenu(stores) {
    const doc = createFakeDocument();
    const details = doc.createElement('details');
    const option = details.appendChild(doc.createElement('div'));
    const button = option.appendChild(doc.createElement('button'));
    option.appendChild(doc.createElement('p')).className = 'arcade-start-option-copy';
    const listeners = [];
    const bind = (target, type, handler) => { if (target) listeners.push({ target, type, handler }); };
    let activeProfile = 'a';
    const runtimeAccess = { getSettingsStore: () => stores[activeProfile] || null };
    bindArcadeSpecialStartButtons({ startDemolitionButton: button }, bind, () => {}, () => 1, [], runtimeAccess);
    const line = () => option.children.find((child) => child.classList.contains('arcade-demolition-medals-line'));
    const fire = (target, type) => listeners.filter((entry) => entry.target === target && entry.type === type).forEach((entry) => entry.handler());
    return { details, option, button, line, fire, setProfile: (id) => { activeProfile = id; } };
}

test('the demolition start option lists the active profile best medals and hides the line without any', () => {
    const stores = {
        a: createStore({ version: 1, maps: {
            eiffel_tower_siege: { medal: 'gold', bestScore: 900 },
            skyline_siege: { medal: 'silver', bestScore: 500 },
            reactor_site: { medal: '', bestScore: 40 },
        } }),
        b: createStore(),
        broken: createStore('nonsense'),
    };
    const menu = mountMenu(stores);
    assert.equal(menu.line().textContent, 'Beste Medaillen: Eiffelturm Gold · Skyline Silber');
    assert.equal(menu.line().classList.contains('hidden'), false);
    assert.equal(menu.option.children.length, 3);

    menu.setProfile('b');
    menu.fire(menu.details, 'toggle');
    assert.equal(menu.line().textContent, '');
    assert.equal(menu.line().classList.contains('hidden'), true);

    menu.setProfile('broken');
    menu.fire(menu.option, 'pointerenter');
    assert.equal(menu.line().textContent, '');

    stores.b.data.set(DEMOLITION_MEDAL_RECORD_STORAGE_KEY, { version: 1, maps: { storm_dam_siege: { medal: 'bronze', bestScore: 10 } } });
    menu.setProfile('b');
    menu.fire(menu.option, 'focusin');
    assert.equal(menu.line().textContent, 'Beste Medaillen: Sturmdamm Bronze');
    assert.equal(menu.option.children.length, 3);
});
