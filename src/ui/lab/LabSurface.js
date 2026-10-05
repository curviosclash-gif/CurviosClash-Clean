import { armConfirmButton } from '../ConfirmButtonArming.js';
import { createArcadeLabStarterConfig, createArcadeLabFactoryCopy, validateArcadeLabShip, ARCADE_LAB_BUDGET, ARCADE_LAB_REFERENCE_VOLUMES, measureArcadeLabHullVolume } from '../../shared/contracts/ArcadeLabContract.js';
import { ARCADE_FACTORY_VEHICLE_IDS } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { createArcadeLabShip, deleteArcadeLabShip, loadArcadeLabShips, renameArcadeLabShip,
    saveArcadeLabDraft, saveArcadeLabShips, commitArcadeLabDraft, registerArcadeLabShipsFromStore } from '../../shared/contracts/ArcadeLabStoreContract.js';
import { evaluateArcadeLabUnlock, syncArcadeLabUnlock } from '../../shared/contracts/ArcadeLabUnlockContract.js';
import { createArcadeLabPreview } from './LabPreview3d.js';
import { clearArcadeLabShipState } from './ArcadeLabRules.js';

const GEOS = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pylon', 'engine', 'forcefield', 'flame'];
const MATERIALS = ['primary', 'secondary', 'glass', 'glow'];
const ROLES = ['', 'core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
const button = (text, action) => { const node = el('button', 'secondary-btn', text); node.type = 'button'; node.addEventListener('click', action); return node; };
function translateLabReason(reason) {
    return String(reason || '')
        .replace(/\bcost überschritten\./g, 'Baukosten überschritten.')
        .replace(/\bmass überschritten\./g, 'Masse überschritten.')
        .replace(/\benergy überschritten\./g, 'Energie überschritten.')
        .replace(/\bheat überschritten\./g, 'Hitze überschritten.');
}

export function createArcadeLabSurface({ store, profilePort, onReturn, onDirtyChange } = {}) {
    let record = loadArcadeLabShips(store);
    let profiles = profilePort?.load?.() || {};
    let unlocked = syncArcadeLabUnlock(store, profiles).record?.unlocked === true;
    if (record && unlocked && !record.unlocked) {
        const next = { ...record, unlocked: true };
        if (saveArcadeLabShips(store, next)) record = next;
        else unlocked = false;
    }
    let selectedId = record?.ships?.[0]?.id || '';
    let config = null;
    let history = [];
    let historyIndex = -1;
    let selectedPath = [0];
    let dirty = false;
    let showing = false;
    const root = el('section', 'arcade-lab-surface hidden');
    const header = el('header', 'arcade-lab-header');
    const back = button('← Hangar', () => { if (flushDraft()) onReturn?.(); });
    const title = el('h2', '', 'Arcade-Lab');
    const status = el('p', 'arcade-lab-status');
    header.append(back, title, status);
    const body = el('div', 'arcade-lab-layout');
    const fleet = el('aside', 'arcade-lab-fleet');
    const center = el('div', 'arcade-lab-center');
    const previewMount = el('div', 'arcade-lab-preview');
    const preview = createArcadeLabPreview(previewMount);
    const metrics = el('div', 'arcade-lab-metrics');
    const editor = el('aside', 'arcade-lab-editor');
    center.append(previewMount, metrics);
    body.append(fleet, center, editor);
    root.append(header, body);

    function setDirty(value) { dirty = value; onDirtyChange?.(dirty); }
    function createShip(source) {
        if (!flushDraft()) return;
        const next = createArcadeLabShip(record, source);
        if (!next.ok) { status.textContent = translateLabReason(next.reason); return; }
        if (!persist(next.record)) return;
        const latest = profilePort?.load?.() || {};
        const initial = profilePort?.getOrCreate?.(latest, next.ship.id);
        const saved = initial ? profilePort.save({ ...latest, [next.ship.id]: initial }) : null;
        if (initial && saved !== true && saved?.success !== true && saved?.ok !== true) {
            status.textContent = 'Schiff erstellt. Fortschritt wird beim ersten verdienten XP gespeichert.';
        }
        select(next.ship.id);
        status.textContent = 'Neuer Entwurf geöffnet.';
    }
    function persist(next) {
        if (!next || !saveArcadeLabShips(store, next)) { status.textContent = 'Speichern fehlgeschlagen – Entwurf bleibt geöffnet.'; return false; }
        record = next;
        registerArcadeLabShipsFromStore(store);
        return true;
    }
    function refreshUnlock() {
        profiles = profilePort?.load?.() || {};
        const unlock = syncArcadeLabUnlock(store, profiles);
        unlocked = unlock.record?.unlocked === true;
        if (record && unlocked && !record.unlocked) persist({ ...record, unlocked: true });
        renderFleet();
    }
    function select(id) {
        if (!flushDraft()) return;
        selectedId = id;
        const ship = record?.ships.find((entry) => entry.id === id);
        const source = ship?.draft || ship?.config;
        config = ship ? clone(source && typeof source === 'object' && Array.isArray(source.parts)
            ? source : { ...createArcadeLabStarterConfig('fighter'), label: ship.label || 'Reparierter Entwurf' }) : null;
        history = config ? [clone(config)] : [];
        historyIndex = config ? 0 : -1;
        selectedPath = [0];
        setDirty(Boolean(ship?.draft));
        if (ship) status.textContent = ship.draft ? 'Gesicherter Entwurf geöffnet.' : 'Schiff geladen.';
        render();
    }
    function flushDraft() {
        if (!record || !selectedId || !config || !dirty) return true;
        const next = saveArcadeLabDraft(record, selectedId, clone(config));
        return persist(next);
    }
    function change(next) {
        config = next;
        history = history.slice(0, historyIndex + 1);
        history.push(clone(config));
        historyIndex = history.length - 1;
        setDirty(true);
        saveDraftChange();
        render();
    }
    function saveDraftChange() {
        if (flushDraft()) status.textContent = 'Entwurf geändert; Entwurfsstand gesichert.';
    }
    function selectedPart() {
        let parts = config?.parts;
        let part = null;
        for (const index of selectedPath) { part = parts?.[index]; parts = part?.children; }
        return part;
    }
    function updateSelected(mutator) {
        const next = clone(config);
        let parts = next.parts;
        for (let i = 0; i < selectedPath.length - 1; i++) parts = parts[selectedPath[i]].children;
        mutator(parts[selectedPath.at(-1)], parts, selectedPath.at(-1));
        change(next);
    }
    function addPart(child = false) {
        if (!config) return;
        const next = clone(config);
        const part = { name: `Teil ${Date.now() % 100000}`, geo: 'box', size: [0.3, 0.3, 0.3],
            pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], material: 'secondary' };
        if (child) {
            let target = next.parts;
            for (const index of selectedPath) { const found = target[index]; if (!found) return; target = found.children ||= []; }
            target.push(part);
            selectedPath = [...selectedPath, target.length - 1];
        } else { next.parts.push(part); selectedPath = [next.parts.length - 1]; }
        change(next);
    }
    function renderFleet() {
        fleet.replaceChildren(el('h3', '', 'Eigene Schiffe'));
        if (!record) { fleet.append(el('p', '', 'Lab-Datensatz kann nicht gelesen werden.')); return; }
        const progress = evaluateArcadeLabUnlock(profiles);
        fleet.append(el('p', '', unlocked ? 'Lab dauerhaft freigeschaltet' : `${progress.qualifiedIds.length} von ${progress.required} Werksschiffen vollständig auf 125 %`));
        const createRow = el('div', 'arcade-lab-create');
        for (const role of ['fighter', 'allrounder', 'tank']) {
            const label = { fighter: 'Jäger', allrounder: 'Allrounder', tank: 'Tank' }[role];
            const add = button(`+ ${label}`, () => createShip(createArcadeLabStarterConfig(role)));
            add.disabled = !unlocked;
            createRow.append(add);
        }
        fleet.append(createRow);
        const copies = el('select'); copies.setAttribute('aria-label', 'Werksschiff als vollständige Kopie');
        for (const id of ARCADE_FACTORY_VEHICLE_IDS) {
            const copy = createArcadeLabFactoryCopy(id);
            const option = el('option', '', copy?.label || id); option.value = id; copies.append(option);
        }
        const copyButton = button('Werkskopie erstellen', () => createShip(createArcadeLabFactoryCopy(copies.value)));
        copyButton.disabled = !unlocked;
        fleet.append(copies, copyButton);
        for (const ship of record.ships) {
            const validation = validateArcadeLabShip(ship);
            const row = button(`${ship.id === selectedId ? '▸ ' : ''}${ship.label || ship.id}${validation.ok ? '' : ' ⚠ reparieren'}`, () => select(ship.id));
            row.classList.add('arcade-lab-ship');
            fleet.append(row);
        }
    }
    function renderMetrics() {
        metrics.replaceChildren();
        if (!config) return;
        const result = validateArcadeLabShip({ id: selectedId, config });
        const roleName = { fighter: 'Jäger', allrounder: 'Allrounder', tank: 'Tank' }[result.role] || '?';
        const prior = record?.ships.find((entry) => entry.id === selectedId)?.role;
        metrics.append(el('h3', '', `Rolle: ${roleName}`));
        if (prior && prior !== result.role) metrics.append(el('p', 'arcade-lab-role-change', `Rollenwechsel: ${prior} → ${result.role}. Grundwerte und MG-Besitz werden angepasst; Fortschritt bleibt.`));
        metrics.append(el('p', '', result.dimensionsValid
            ? `Rumpfsubstanz ${measureArcadeLabHullVolume(config.parts).toFixed(2)} · Vergleich Arrow ${ARCADE_LAB_REFERENCE_VOLUMES.arrow.toFixed(2)}, Star-Cruiser ${ARCADE_LAB_REFERENCE_VOLUMES.ship5.toFixed(2)}, Raumschiff ${ARCADE_LAB_REFERENCE_VOLUMES.spaceship.toFixed(2)}`
            : 'Rumpfsubstanz und Budgetwerte werden bei ungültigen Maßen nicht berechnet.'));
        for (const key of ['cost', 'mass', 'energy', 'heat', 'parts']) {
            const used = result.usage?.[key] || 0;
            const name = { cost: 'Baukosten', mass: 'Masse', energy: 'Energie', heat: 'Hitze', parts: 'Bauteile' }[key];
            const line = el('label', 'arcade-lab-meter', result.dimensionsValid
                ? `${name}: ${used.toFixed(1)} / ${ARCADE_LAB_BUDGET[key]}` : `${name}: —`);
            const bar = el('progress'); bar.max = ARCADE_LAB_BUDGET[key]; bar.value = Math.min(used, bar.max);
            bar.hidden = !result.dimensionsValid;
            line.append(bar); metrics.append(line);
        }
        metrics.append(el('p', result.ok ? 'arcade-lab-valid' : 'arcade-lab-invalid',
            result.ok ? 'Bau ist flugbereit.' : translateLabReason(result.errors.join(' · '))));
    }
    function field(label, value, onChange, type = 'text') {
        const row = el('label', 'arcade-lab-field'); row.append(el('span', '', label));
        const input = el('input'); input.type = type; input.value = String(value ?? '');
        input.addEventListener('change', () => onChange(type === 'number' ? Number(input.value) : input.value));
        row.append(input); return row;
    }
    function choice(label, value, options, onChange) {
        const row = el('label', 'arcade-lab-field'); row.append(el('span', '', label));
        const select = el('select');
        for (const id of options) { const opt = el('option', '', id || 'Keine'); opt.value = id; select.append(opt); }
        select.value = value || '';
        select.addEventListener('change', () => onChange(select.value));
        row.append(select); return row;
    }
    function renderEditor() {
        editor.replaceChildren(el('h3', '', 'Bauteile'));
        if (!config) return;
        editor.append(field('Schiffsname', config.label, (value) => change({ ...config, label: value })));
        const actions = el('div', 'arcade-lab-actions');
        const save = button('Schiff speichern', () => {
            if (!flushDraft()) return;
            const result = commitArcadeLabDraft(record, selectedId);
            if (!result.ok) { status.textContent = translateLabReason(result.reason); return; }
            if (persist(result.record)) { setDirty(false); status.textContent = 'Schiff gespeichert. Im Hangar auswählbar.'; render(); }
        });
        save.disabled = !validateArcadeLabShip({ id: selectedId, config }).ok;
        actions.append(save, button('Umbenennen', () => {
            const next = renameArcadeLabShip(record, selectedId, config.label);
            if (next && persist(next)) { status.textContent = 'Name gespeichert; Schiff-ID bleibt gleich.'; render(); }
        }));
        const undo = button('↶', () => { if (historyIndex > 0) { historyIndex--; config = clone(history[historyIndex]); setDirty(true); saveDraftChange(); render(); } });
        const redo = button('↷', () => { if (historyIndex < history.length - 1) { historyIndex++; config = clone(history[historyIndex]); setDirty(true); saveDraftChange(); render(); } });
        undo.disabled = historyIndex <= 0; redo.disabled = historyIndex >= history.length - 1;
        actions.append(undo, redo);
        const remove = button('Schiff löschen', () => {});
        armConfirmButton(remove, { confirmLabel: 'Erneut klicken: endgültig löschen', onConfirm: () => {
            if (!clearArcadeLabShipState(store, selectedId, () => persist(deleteArcadeLabShip(record, selectedId)))) {
                status.textContent = 'Löschen fehlgeschlagen. Schiff und Fortschritt bleiben erhalten.'; return;
            }
            setDirty(false); select(record.ships[0]?.id || '');
        } });
        actions.append(remove); editor.append(actions);
        const tree = el('div', 'arcade-lab-tree');
        const addTree = (parts, path = []) => parts.forEach((part, index) => {
            const full = [...path, index];
            const row = button(`${'· '.repeat(path.length)}${part.name} ${part.role || ''}`, () => { selectedPath = full; renderEditor(); });
            if (full.join('.') === selectedPath.join('.')) row.classList.add('is-active');
            tree.append(row); addTree(part.children || [], full);
        });
        addTree(config.parts); editor.append(tree);
        editor.append(button('+ Bauteil', () => addPart(false)), button('+ Kindteil', () => addPart(true)));
        const part = selectedPart();
        if (!part) return;
        editor.append(field('Name', part.name, (value) => updateSelected((target) => { target.name = value; })));
        editor.append(choice('Geometrie', part.geo, GEOS, (value) => updateSelected((target) => { target.geo = value; })));
        editor.append(choice('Material', part.material, MATERIALS, (value) => updateSelected((target) => { target.material = value; })));
        if (selectedPath.length === 1) editor.append(choice('Rolle', part.role, ROLES, (value) => updateSelected((target) => { if (value) target.role = value; else delete target.role; })));
        editor.append(choice('Spiegelung', part.mirrorAxis, ['', 'x', 'y', 'z'], (value) => updateSelected((target) => { if (value) target.mirrorAxis = value; else delete target.mirrorAxis; })));
        for (const property of ['size', 'pos', 'rot', 'scale']) for (let axis = 0; axis < 3; axis++) {
            const label = { size: 'Größe', pos: 'Position', rot: 'Drehung', scale: 'Skalierung' }[property];
            const fallback = property === 'scale' ? [1, 1, 1] : [0, 0, 0];
            editor.append(field(`${label} ${'XYZ'[axis]}`, part[property]?.[axis] ?? fallback[axis], (value) => updateSelected((target) => {
                target[property] ||= fallback.slice(); target[property][axis] = value;
            }), 'number'));
        }
        const removePart = button('Bauteil entfernen', () => {
            const next = clone(config);
            let parts = next.parts;
            for (let i = 0; i < selectedPath.length - 1; i++) parts = parts[selectedPath[i]].children;
            parts.splice(selectedPath.at(-1), 1);
            selectedPath = [0];
            change(next);
        });
        editor.append(removePart);
    }
    function render() {
        renderFleet(); renderMetrics(); renderEditor();
        const validation = config ? validateArcadeLabShip({ id: selectedId, config }) : null;
        preview.setConfig(validation?.dimensionsValid ? config : null);
    }
    select(selectedId);
    return { root, show(value) { showing = value === true; if (showing) refreshUnlock(); root.classList.toggle('hidden', !showing); preview.show(showing); },
        flushDraft, dispose() { flushDraft(); preview.dispose(); }, getSelectedId: () => selectedId };
}
