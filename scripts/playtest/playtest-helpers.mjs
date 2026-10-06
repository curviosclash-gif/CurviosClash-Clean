/* global window, document, requestAnimationFrame */
// Test helpers the agent may choose to use (menu bypass, items, teleport, invulnerability,
// a direct setting, the tuning console without focus). Every use is recorded as an
// intervention on the run, so a report always says what was not reached by play. The
// catalog tells the agent what exists before it starts.
import * as D from './playtest-driver.mjs';
import { triggerFocusShortcut } from './playtest-session.mjs';

export const HELPERS = Object.freeze({
    start_match: 'Starts a match directly through the runtime facade (menu bypassed). Args: map, mode, bots, humans, vehicle, difficulty, winsNeeded, seed, modePath, session, paused, arcade, hunt.',
    return_to_menu: 'Ends the match directly (pause menu bypassed).',
    give_item: 'Puts an item into a player inventory. Args: item, player.',
    teleport: 'Moves a ship once. Args: pos [x,y,z], target [x,y,z], player.',
    god_mode: 'Keeps a ship at full health for ms (default 5000). Args: ms, player.',
    set_setting: 'Writes one settings value directly. Args: path (dot path in GAME_INSTANCE.settings), value.',
    open_tuning: 'Opens the tuning console through its F7 hotkey without OS focus.',
});

/** Runs a helper and records it as an intervention on `run`. */
export async function runHelper(run, session, name, args = {}) {
    if (!HELPERS[name]) throw new Error(`unknown helper ${name}; available: ${Object.keys(HELPERS).join(', ')}`);
    const player = Number.isInteger(args.player) ? args.player : 0;
    let result;
    switch (name) {
        case 'start_match': {
            const options = { ...args };
            delete options.player;
            result = await D.startMatch(session, options);
            break;
        }
        case 'return_to_menu':
            result = { state: await D.returnToMenu(session) };
            break;
        case 'give_item':
            result = await session.page.evaluate(({ item, index }) => {
                const target = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === index);
                if (!target) throw new Error(`player ${index} not in match`);
                return { added: target.addToInventory(item), inventory: [...target.inventory] };
            }, { item: String(args.item), index: player });
            break;
        case 'teleport':
            result = await session.page.evaluate(({ pos, target, index }) => {
                const ship = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === index);
                if (!ship) throw new Error(`player ${index} not in match`);
                ship.position.set(pos[0], pos[1], pos[2]);
                if (target) {
                    const Vector = ship.position.constructor;
                    ship.quaternion.setFromUnitVectors(new Vector(0, 0, -1), new Vector(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]).normalize());
                }
                ship.trail?.clear?.();
                ship.markRenderDiscontinuity?.('playtest');
                return { pos: [ship.position.x, ship.position.y, ship.position.z].map(Math.round) };
            }, { pos: args.pos, target: args.target || null, index: player });
            break;
        case 'god_mode':
            result = await session.page.evaluate(({ ms, index }) => {
                const until = performance.now() + ms;
                const keep = () => {
                    const ship = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === index);
                    if (ship) ship.hp = ship.maxHp;
                    if (performance.now() < until) requestAnimationFrame(keep);
                };
                keep();
                return { untilMs: ms };
            }, { ms: Number(args.ms) || 5000, index: player });
            break;
        case 'set_setting':
            result = await session.page.evaluate(async ({ path, value }) => {
                const game = window.GAME_INSTANCE;
                const keys = String(path).split('.');
                let node = game.settings;
                for (const key of keys.slice(0, -1)) node = node[key] = node[key] ?? {};
                node[keys.at(-1)] = value;
                await Promise.resolve(game._onSettingsChanged?.());
                return { path, value };
            }, { path: args.path, value: args.value });
            break;
        case 'open_tuning': {
            const fired = await triggerFocusShortcut(session, 'F7');
            const page = await D.findWindowPage(session, 'tuning', 8000);
            result = { fired, opened: Boolean(page) };
            break;
        }
        default:
            break;
    }
    run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: name, args });
    return { helper: name, intervention: true, result };
}

/** What exists: maps (with parcours flag), vehicles, modes, pilot modes, actions, helpers, scenarios. */
export async function buildCatalog(session, { scenarios = {}, pilotModes = [], maneuverFields = [], uiActions = [] } = {}) {
    const staticPart = {
        modes: ['CLASSIC', 'HUNT', 'ARCADE', 'ESCORT'],
        modePaths: { normal: 'CLASSIC', fight: 'HUNT', arcade: 'ARCADE' },
        pilotModes,
        maneuverFields,
        uiActions,
        helpers: HELPERS,
        scenarios,
        windows: ['main', 'hangar', 'editor', 'vehicle-lab', 'editor-playtest', 'tuning', 'settings-studio'],
        limits: { bots: [0, 8], winsNeeded: [1, 15] },
    };
    if (!session || session.closed || session.entry !== 'game') return { ...staticPart, maps: null, vehicles: null, note: 'open a session to list maps and vehicles' };
    const dynamic = await session.page.evaluate(() => {
        const maps = window.GAME_INSTANCE?.config?.MAPS || {};
        const mapList = Object.entries(maps).map(([key, map]) => ({
            key, name: map?.name || key, parcours: map?.parcours?.enabled === true,
            excludedModes: Array.isArray(map?.excludedModes) ? map.excludedModes : [],
        }));
        const vehicleSelect = document.querySelector('#vehicle-select-p1');
        const vehicles = vehicleSelect ? [...vehicleSelect.options].map((option) => ({ id: option.value, name: option.textContent.trim() })) : [];
        return { maps: mapList, vehicles };
    });
    return { ...staticPart, ...dynamic };
}
