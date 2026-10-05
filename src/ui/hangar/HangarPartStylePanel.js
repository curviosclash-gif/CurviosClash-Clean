import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { normalizeVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { resolveHangarPartSource } from './HangarPartSource.js';
import { ARCADE_COLOR_IDS, ARCADE_COLOR_PALETTE, ARCADE_COLOR_REQUIREMENTS, listUnlockedArcadeColors, filterArcadePartColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { ARCADE_TRAIL_STYLE_LABELS } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { armConfirmButton } from '../ConfirmButtonArming.js';

const ROLE_LABELS = Object.freeze({
    core: 'Rumpf', nose: 'Nase', wing_left: 'Flügel L', wing_right: 'Flügel R',
    engine_left: 'Antrieb L', engine_right: 'Antrieb R', utility: 'Utility',
});

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

/**
 * Hangar tab "Form": pick a part of a part-built ship and change its color. Size lives in the
 * size workshop (HangarSizePanel); every ship keeps its factory shape, so stored scale and
 * shape entries are ignored (Paket 2a).
 * @param {{bind: Function, onStyleChange: (style: object) => void, onSelectPart: (name: string) => void, getColors?: (() => any)}} options
 */
export function createHangarPartStylePanel({ bind, onStyleChange, onSelectPart, getColors }) {
    const root = el('div', 'hangar-part-style');
    const hint = el('p', 'field-hint', 'Teil wählen, dann die Farbe ändern. Gilt im Arcade-Modus.');
    const empty = el('p', 'field-hint hidden', 'Dieses Fahrzeug besteht nicht aus Einzelteilen.');
    const list = el('div', 'hangar-part-style-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Bauteile');
    const editor = el('div', 'hangar-part-style-editor');
    const title = el('h4', 'arcade-vehicle-subtitle', '');
    const colorInput = getColors ? document.createElement('select') : document.createElement('input');
    if (!getColors) /** @type {HTMLInputElement} */(colorInput).type = 'color';
    colorInput.className = 'hangar-part-style-color';
    colorInput.setAttribute('aria-label', 'Farbe des Teils');
    const resetPart = button('secondary-btn hangar-part-style-reset', 'Teil zurücksetzen');
    const resetAll = button('secondary-btn hangar-part-style-reset-all', 'Alles zurücksetzen');
    const field = (label, ...nodes) => {
        const node = el('label', 'hangar-cosmetic-field');
        node.append(el('span', 'hangar-cosmetic-field-label', label), ...nodes);
        return node;
    };
    editor.append(title, field('Farbe', colorInput), resetPart);
    root.append(hint, empty, list, editor, resetAll);

    let factory = null;
    let vehicleId = '';
    let style = {};
    let selected = '';

    function colorsOnly(source) {
        return Object.fromEntries(Object.entries(normalizeVehiclePartStyle(source))
            .filter(([, entry]) => entry.color !== undefined)
            .map(([name, entry]) => [name, { color: entry.color }]));
    }

    function emit(nextStyle) {
        style = colorsOnly(nextStyle);
        onStyleChange(style);
    }

    function patchSelected(patch) {
        if (!selected) return;
        const entry = { ...(style[selected] || {}), ...patch };
        Object.keys(patch).forEach((key) => { if (patch[key] === null) delete entry[key]; });
        emit({ ...style, [selected]: entry });
    }

    function renderList() {
        list.replaceChildren(...(factory?.parts || []).map((part) => {
            const item = button('secondary-btn hangar-part-style-item', part.name);
            item.dataset.partName = part.name;
            item.setAttribute('role', 'option');
            if (part.role) item.appendChild(el('span', 'hangar-part-style-role', ROLE_LABELS[part.role] || part.role));
            return item;
        }));
    }

    function renderEditor() {
        const part = factory?.parts?.find((entry) => entry.name === selected) || null;
        editor.classList.toggle('hidden', !part);
        list.querySelectorAll('[data-part-name]').forEach((node) => {
            const active = node.dataset.partName === selected;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-selected', String(active));
            node.classList.toggle('is-styled', !!style[node.dataset.partName]);
        });
        resetAll.disabled = Object.keys(style).length === 0;
        if (!part) return;
        const entry = style[selected] || {};
        title.textContent = part.role ? `${part.name} · ${ROLE_LABELS[part.role] || part.role}` : part.name;
        if (!getColors) { colorInput.value = `#${(Number(entry.color ?? part.color ?? 0x8aa4c8) >>> 0).toString(16).padStart(6,'0').slice(-6)}`; resetPart.disabled = !style[selected]; return; }
        const unlocked = listUnlockedArcadeColors(getColors());
        colorInput.replaceChildren(...ARCADE_COLOR_IDS.map(id => {
            const option = document.createElement('option'); option.value = id;
            option.disabled = !unlocked.includes(id);
            option.textContent = id === 'standard' ? 'Werkfarbe' : `${ARCADE_TRAIL_STYLE_LABELS[id]}${option.disabled ? ' · ' + ARCADE_COLOR_REQUIREMENTS[id] : ''}`;
            return option;
        }));
        colorInput.value = ARCADE_COLOR_IDS.find(id => ARCADE_COLOR_PALETTE[id] === entry.color) || 'standard';
        resetPart.disabled = !style[selected];
    }

    bind(list, 'click', (event) => {
        const name = event.target?.closest?.('[data-part-name]')?.dataset.partName;
        if (!name) return;
        selected = name;
        renderEditor();
        onSelectPart(name);
    });
    bind(colorInput, 'change', () => {
        if (getColors && listUnlockedArcadeColors(getColors()).includes(colorInput.value)) patchSelected({ color: ARCADE_COLOR_PALETTE[colorInput.value] ?? null });
    });
    if (!getColors) bind(colorInput, 'input', () => patchSelected({ color: colorInput.value }));
    bind(resetPart, 'click', () => {
        const next = { ...style };
        delete next[selected];
        emit(next);
    });
    // Wipes every part colour at once: same two-step button as the other destructive actions.
    const resetAllConfirmation = armConfirmButton(resetAll, { label: 'Alles zurücksetzen', onConfirm: () => emit({}) });

    return Object.freeze({
        root,
        getSelectedPart: () => selected,
        render(next = {}) {
            const nextVehicleId = String(next.vehicleId || '');
            if (nextVehicleId !== vehicleId) {
                vehicleId = nextVehicleId;
                resetAllConfirmation.disarm();
                factory = resolveHangarPartSource(vehicleId);
                selected = factory?.parts?.[0]?.name || '';
                empty.classList.toggle('hidden', !!factory);
                renderList();
            }
            style = colorsOnly(getColors ? filterArcadePartColors(next.style, getColors()) : next.style);
            renderEditor();
        },
    });
}
