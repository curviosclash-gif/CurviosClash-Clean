import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import {
    VEHICLE_PART_STYLE_SCALE_RANGE,
    listVehiclePartVariants,
    normalizeVehiclePartStyle,
} from '../../shared/contracts/VehiclePartStyleContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';

const ROLE_LABELS = Object.freeze({
    core: 'Rumpf', nose: 'Nase', wing_left: 'Flügel L', wing_right: 'Flügel R',
    engine_left: 'Antrieb L', engine_right: 'Antrieb R', utility: 'Utility',
});

function hex(color) {
    return `#${(Number(color) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

/**
 * Hangar tab "Form": pick a part of a part-built ship and change its color, size or shape.
 * @param {{bind: Function, onStyleChange: (style: object) => void, onSelectPart: (name: string) => void}} options
 */
export function createHangarPartStylePanel({ bind, onStyleChange, onSelectPart }) {
    const root = el('div', 'hangar-part-style');
    const hint = el('p', 'field-hint', 'Teil wählen, dann Farbe, Größe oder Form ändern. Gilt im Arcade-Modus; die Hitbox bleibt unverändert.');
    const empty = el('p', 'field-hint hidden', 'Dieses Fahrzeug besteht nicht aus Einzelteilen.');
    const list = el('div', 'hangar-part-style-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Bauteile');
    const editor = el('div', 'hangar-part-style-editor');
    const title = el('h4', 'arcade-vehicle-subtitle', '');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'hangar-part-style-color';
    colorInput.setAttribute('aria-label', 'Farbe des Teils');
    const scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.className = 'hangar-part-style-scale';
    scaleInput.min = String(VEHICLE_PART_STYLE_SCALE_RANGE.min);
    scaleInput.max = String(VEHICLE_PART_STYLE_SCALE_RANGE.max);
    scaleInput.step = '0.05';
    scaleInput.setAttribute('aria-label', 'Größe des Teils');
    const scaleValue = el('span', 'hangar-part-style-scale-value', '100 %');
    const variantSelect = document.createElement('select');
    variantSelect.className = 'hangar-cosmetic-select hangar-part-style-variant';
    variantSelect.setAttribute('aria-label', 'Form des Teils');
    const resetPart = button('secondary-btn hangar-part-style-reset', 'Teil zurücksetzen');
    const resetAll = button('secondary-btn hangar-part-style-reset-all', 'Alles zurücksetzen');
    const field = (label, ...nodes) => {
        const node = el('label', 'hangar-cosmetic-field');
        node.append(el('span', 'hangar-cosmetic-field-label', label), ...nodes);
        return node;
    };
    editor.append(title, field('Farbe', colorInput), field('Größe', scaleInput, scaleValue), field('Form', variantSelect), resetPart);
    root.append(hint, empty, list, editor, resetAll);

    const donors = listPlayerShipPartDonors();
    let factory = null;
    let vehicleId = '';
    let style = {};
    let selected = '';

    function emit(nextStyle) {
        style = normalizeVehiclePartStyle(nextStyle);
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
        colorInput.value = hex(entry.color ?? part.color ?? 0x8aa4c8);
        scaleInput.value = String(entry.scale ?? 1);
        scaleValue.textContent = `${Math.round((entry.scale ?? 1) * 100)} %`;
        const variants = listVehiclePartVariants(factory, selected, donors);
        variantSelect.replaceChildren(el('option', '', 'Original'), ...variants.map((variant) => {
            const option = el('option', '', `Form von ${variant.label}`);
            option.value = variant.id;
            return option;
        }));
        variantSelect.firstChild.value = '';
        variantSelect.value = variants.some((variant) => variant.id === entry.variant) ? entry.variant : '';
        variantSelect.disabled = variants.length === 0;
        resetPart.disabled = !style[selected];
    }

    bind(list, 'click', (event) => {
        const name = event.target?.closest?.('[data-part-name]')?.dataset.partName;
        if (!name) return;
        selected = name;
        renderEditor();
        onSelectPart(name);
    });
    bind(colorInput, 'input', () => patchSelected({ color: colorInput.value }));
    bind(scaleInput, 'input', () => patchSelected({ scale: Number(scaleInput.value) }));
    bind(variantSelect, 'change', () => patchSelected({ variant: variantSelect.value || null }));
    bind(resetPart, 'click', () => {
        const next = { ...style };
        delete next[selected];
        emit(next);
    });
    bind(resetAll, 'click', () => emit({}));

    return Object.freeze({
        root,
        getSelectedPart: () => selected,
        render(next = {}) {
            const nextVehicleId = String(next.vehicleId || '');
            if (nextVehicleId !== vehicleId) {
                vehicleId = nextVehicleId;
                factory = donors.find((donor) => donor.id === vehicleId) || null;
                selected = factory?.parts?.[0]?.name || '';
                empty.classList.toggle('hidden', !!factory);
                renderList();
            }
            style = normalizeVehiclePartStyle(next.style);
            renderEditor();
        },
    });
}
