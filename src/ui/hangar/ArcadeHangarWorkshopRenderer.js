import { createUiNode as el, resolvePlayerColor, toVehicleLevelBand } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { HANGAR_SLOT_DEFINITIONS, listHangarParts, resolveHangarPart, resolvePartLockReason } from './HangarPartCatalog.js';
import { validateHangarBuild } from './HangarBuildValidation.js';
import { compareHangarStats, projectHangarStats } from './HangarStatProjection.js';

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

function deltaText(value) {
    const number = Number(value) || 0;
    return number > 0 ? `+${number}` : String(number);
}

export function createArcadeHangarWorkshopRenderer(options) {
    const {
        shell, settings, catalogEntries, selection, persistence, viewport,
        getState, entryFor, profileFor, evaluateInstall, describeFailure,
        onQuickUpgrade, onSelectSlot, isDirty,
    } = options;
    const {
        container, saveState, vehiclesViewButton, partsViewButton, search, onlyFavBtn,
        categoryTabs, hitboxChips, levelChips, partFilters, quickRows, favRow, recentRow,
        resultLine, catalogList, detailTitle, detailMeta, favoriteBtn, levelLine, xpFill,
        compareSelect, statRows, budgetRows, slotGrid, validationBox, undoButton, redoButton,
        revertButton, activateButton, presetSelect, presetLoad, presetRename, presetDuplicate,
        presetDelete, activeBuildLabel,
    } = shell;

    function renderQuickRow(node, label, ids) {
        node.replaceChildren(el('span', 'arcade-vehicle-quick-row-label', label));
        if (!ids.length) {
            node.appendChild(el('span', 'menu-hint', 'keine'));
            return;
        }
        ids.forEach((vehicleId) => {
            const item = button('secondary-btn quick-pill arcade-vehicle-quick-pill', entryFor(vehicleId).label);
            item.dataset.quickVehicleId = vehicleId;
            node.appendChild(item);
        });
    }

    function renderVehicles(state) {
        const visible = selection.getVisibleEntries(state.profiles);
        const favorites = new Set(selection.getFavorites());
        resultLine.textContent = `${visible.length} Fahrzeuge sichtbar`;
        catalogList.replaceChildren();
        if (!visible.length) catalogList.appendChild(el('p', 'menu-hint hangar-empty-state', 'Keine Fahrzeuge für diese Filterung gefunden.'));
        visible.forEach((entry) => {
            const profile = profileFor(entry.vehicleId);
            const card = button('arcade-vehicle-card hangar-vehicle-card', '');
            card.dataset.vehicleId = entry.vehicleId;
            card.dataset.vehicleCategory = entry.kategorie;
            card.dataset.vehicleHitbox = entry.hitboxKlasse;
            card.dataset.vehiclePreviewToken = entry.previewToken;
            card.classList.toggle('selected', entry.vehicleId === state.draft.vehicleId);
            card.classList.toggle('is-favorite', favorites.has(entry.vehicleId));
            card.setAttribute('role', 'option');
            card.setAttribute('aria-selected', String(entry.vehicleId === state.draft.vehicleId));
            card.append(
                el('span', 'arcade-vehicle-card-title', entry.label),
                el('span', 'arcade-vehicle-card-meta', `${entry.kategorie} · ${entry.hitboxKlasse} · Lv ${profile.level}`)
            );
            catalogList.appendChild(card);
        });
        renderQuickRow(favRow, 'Favoriten', selection.getFavorites());
        renderQuickRow(recentRow, 'Zuletzt', selection.getRecents());
    }

    function renderParts(state) {
        const profile = profileFor(state.draft.vehicleId);
        const parts = listHangarParts({ search: search.value, family: state.partFamily, tier: state.partTier });
        resultLine.textContent = `${parts.length} Bauteile · gesperrte Teile bleiben sichtbar`;
        catalogList.replaceChildren();
        if (!parts.length) catalogList.appendChild(el('p', 'menu-hint hangar-empty-state', 'Keine Bauteile für diese Filterung gefunden.'));
        parts.forEach((part) => {
            const target = part.compatibleSlots.find((slotId) => state.draft.slots[slotId] !== part.id) || part.compatibleSlots[0];
            const projected = target ? evaluateInstall(part.id, target) : null;
            const lock = resolvePartLockReason(part, profile.level, projected);
            const card = el('article', 'hangar-part-card');
            card.dataset.partId = part.id;
            card.dataset.partLabel = part.label;
            card.tabIndex = lock ? -1 : 0;
            card.classList.toggle('is-locked', Boolean(lock));
            if (lock) {
                card.dataset.locked = 'true';
                card.dataset.lockedReason = lock.message;
            }
            const head = el('div', 'hangar-part-card-head');
            head.append(el('strong', 'hangar-part-name', part.label), el('span', `hangar-tier hangar-tier-${part.tier.toLowerCase()}`, part.tier));
            card.append(
                head,
                el('span', 'hangar-part-family', part.family),
                el('span', 'hangar-part-costs', `B ${part.costs.budget} · M ${part.costs.mass} · E ${part.costs.energy} · H ${part.costs.heat}`),
                el('span', lock ? 'hangar-part-lock-reason' : 'hangar-part-drag-hint', lock?.message || 'Auf einen leuchtenden Hardpoint ziehen')
            );
            catalogList.appendChild(card);
        });
        favRow.replaceChildren();
        recentRow.replaceChildren();
    }

    function renderStatistics(state, validation) {
        const current = projectHangarStats(state.draft);
        const saved = projectHangarStats(state.savedBuild || state.draft);
        const compareEntry = entryFor(selection.getCompareVehicleId());
        const compareBuild = state.buildFromProfile(compareEntry.vehicleId, compareEntry, profileFor(compareEntry.vehicleId));
        const savedMetrics = compareHangarStats(current, saved);
        const compareMetrics = compareHangarStats(current, projectHangarStats(compareBuild));
        statRows.replaceChildren();
        savedMetrics.forEach((metric, index) => {
            const versus = compareMetrics[index];
            const row = el('div', 'arcade-vehicle-compare-row hangar-stat-row');
            row.dataset.metric = metric.key;
            row.append(
                el('span', 'arcade-vehicle-compare-label', metric.label),
                el('strong', 'hangar-stat-value', String(metric.value)),
                el('span', `hangar-stat-delta is-${metric.tone}`, `Build ${deltaText(metric.delta)}`),
                el('span', `hangar-stat-delta is-${versus.tone}`, `Vergleich ${deltaText(versus.delta)}`)
            );
            statRows.appendChild(row);
        });
        budgetRows.replaceChildren();
        [
            ['Editorbudget', validation.stats.budgetUsed, validation.limits.editorBudget],
            ['Massebudget', validation.stats.massUsed, validation.limits.massBudget],
            ['Energiebudget', validation.stats.powerUsed, validation.limits.powerBudget],
            ['Hitzebudget', validation.stats.heatUsed, validation.limits.heatBudget],
        ].forEach(([label, used, limit]) => {
            const row = el('div', 'hangar-budget-row');
            const track = el('span', 'hangar-budget-track');
            const fill = el('span', 'hangar-budget-fill');
            const ratio = Math.max(0, Math.min(1, Number(used) / Math.max(1, Number(limit))));
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            fill.classList.toggle('is-warning', ratio > 0.85);
            track.appendChild(fill);
            row.append(el('span', 'hangar-budget-label', `${label} ${used}/${limit}`), track);
            budgetRows.appendChild(row);
        });
    }

    function renderSlots(state, validation, dragPartId) {
        slotGrid.replaceChildren();
        const viewportStates = [];
        HANGAR_SLOT_DEFINITIONS.forEach((slot) => {
            const part = resolveHangarPart(state.draft.slots[slot.id]);
            const row = el('div', 'arcade-vehicle-slot-row hangar-slot-row');
            row.dataset.hangarSlotRow = slot.id;
            row.classList.toggle('is-selected', state.selectedSlotId === slot.id);
            const label = button('hangar-slot-select arcade-vehicle-slot-label', slot.label);
            label.dataset.selectSlot = slot.id;
            const installed = button('hangar-installed-part', part?.label || 'Leer');
            installed.dataset.installedSlot = slot.id;
            if (part) {
                installed.dataset.partId = part.id;
                installed.dataset.partLabel = part.label;
            } else installed.disabled = true;
            const tier = el('span', 'arcade-vehicle-slot-tier', part?.tier || '—');
            const quick = button('secondary-btn arcade-vehicle-upgrade-btn', part?.tier === 'T3' ? 'MAX' : 'Tier +');
            quick.dataset.quickUpgrade = slot.id;
            const nextId = part && part.tier !== 'T3' ? `${part.family}_${part.tier === 'T1' ? 't2' : 't3'}` : '';
            const nextValidation = nextId ? evaluateInstall(nextId, slot.id) : null;
            quick.disabled = !nextValidation?.ok;
            quick.title = nextValidation?.ok ? 'Nächstes Tier als Entwurf montieren' : describeFailure(nextValidation);
            const remove = button('secondary-btn hangar-slot-remove', '×');
            remove.dataset.removeSlot = slot.id;
            remove.disabled = !part || slot.required;
            row.append(label, installed, tier, quick, remove);
            slotGrid.appendChild(row);
            const dragValidation = dragPartId ? evaluateInstall(dragPartId, slot.id) : null;
            viewportStates.push({
                slotKey: slot.id,
                badge: part?.tier || '+',
                disabled: dragPartId ? !dragValidation?.ok : false,
                tooltip: dragPartId ? (dragValidation?.ok ? `${slot.label}: kompatibel` : describeFailure(dragValidation)) : `${slot.label}: ${part?.label || 'leer'}`,
                dropState: '',
            });
        });
        viewport.setSlotStates(viewportStates, (slotId) => {
            onSelectSlot(slotId);
            onQuickUpgrade(slotId);
        });
        viewport.setSelectedSlot(state.selectedSlotId);
        validationBox.replaceChildren();
        validationBox.className = `hangar-validation-box ${validation.ok ? 'is-valid' : 'is-invalid'}`;
        if (validation.ok) validationBox.appendChild(el('strong', '', 'Build gültig'));
        else {
            validationBox.appendChild(el('strong', '', `${validation.errors.length} Build-Probleme`));
            const list = el('ul', 'hangar-validation-list');
            validation.errors.slice(0, 5).forEach((error) => list.appendChild(el('li', '', error.message)));
            validationBox.appendChild(list);
        }
    }

    function renderPresets(state) {
        const builds = persistence.listBuilds(state.draft.vehicleId);
        const selectedId = presetSelect.value;
        presetSelect.replaceChildren();
        if (!builds.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = state.hydrated ? 'Keine gespeicherten Builds' : 'Builds werden geladen …';
            presetSelect.appendChild(option);
        } else {
            builds.forEach((build) => {
                const option = document.createElement('option');
                option.value = build.buildId;
                option.textContent = build.name;
                presetSelect.appendChild(option);
            });
            presetSelect.value = builds.some((build) => build.buildId === selectedId) ? selectedId : (state.savedBuild?.buildId || builds[0].buildId);
        }
        const selected = Boolean(presetSelect.value);
        presetLoad.disabled = !selected;
        presetRename.disabled = !selected;
        presetDuplicate.disabled = !selected;
        presetDelete.disabled = !selected;
    }

    function sync(syncOptions = {}) {
        const state = getState();
        if (!state.draft) return;
        const entry = entryFor(state.draft.vehicleId);
        const profile = profileFor(state.draft.vehicleId);
        const validation = validateHangarBuild(state.draft, profile.level);
        const favorites = new Set(selection.getFavorites());
        detailTitle.textContent = entry.label;
        detailMeta.textContent = `${entry.kategorie} · ${entry.hitboxKlasse} · ${toVehicleLevelBand(profile.level)}`;
        const xp = state.xpToNextLevel(profile);
        levelLine.textContent = `Level ${profile.level} · Mastery ${profile.masteryMilestones?.length || 0} · XP ${xp.current}/${xp.required} · Upgrade-XP ${state.getSpendableUpgradeXp(profile)}`;
        xpFill.style.width = `${(xp.progress * 100).toFixed(1)}%`;
        favoriteBtn.textContent = favorites.has(state.draft.vehicleId) ? 'Favorit entfernen' : 'Favorit';
        favoriteBtn.classList.toggle('is-active', favorites.has(state.draft.vehicleId));
        vehiclesViewButton.classList.toggle('is-active', state.catalogView === 'vehicles');
        partsViewButton.classList.toggle('is-active', state.catalogView === 'parts');
        [categoryTabs, hitboxChips, levelChips, quickRows].forEach((node) => node.classList.toggle('hidden', state.catalogView !== 'vehicles'));
        partFilters.classList.toggle('hidden', state.catalogView !== 'parts');
        onlyFavBtn.classList.toggle('hidden', state.catalogView !== 'vehicles');
        search.placeholder = state.catalogView === 'vehicles' ? 'Fahrzeuge durchsuchen …' : 'Bauteile durchsuchen …';
        if (!syncOptions.preserveCatalog) {
            if (state.catalogView === 'vehicles') renderVehicles(state);
            else renderParts(state);
        }
        categoryTabs.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node.dataset.category === selection.getCategory()));
        hitboxChips.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node.dataset.filterValue === selection.getHitboxFilter()));
        levelChips.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node.dataset.filterValue === selection.getLevelFilter()));
        onlyFavBtn.classList.toggle('is-active', selection.isFavoritesOnly());
        compareSelect.replaceChildren();
        catalogEntries.filter((item) => item.vehicleId !== state.draft.vehicleId).forEach((item) => {
            const option = document.createElement('option');
            option.value = item.vehicleId;
            option.textContent = item.label;
            compareSelect.appendChild(option);
        });
        if (!Array.from(compareSelect.options).some((option) => option.value === selection.getCompareVehicleId())) {
            selection.setCompareVehicleId(compareSelect.options[0]?.value || state.draft.vehicleId);
        }
        compareSelect.value = selection.getCompareVehicleId();
        renderStatistics(state, validation);
        renderSlots(state, validation, syncOptions.dragPartId || '');
        renderPresets(state);
        viewport.setBuild(state.draft, { color: resolvePlayerColor(settings) });
        container.dataset.previewStatus = viewport.getStatus();
        const dirty = isDirty();
        saveState.textContent = dirty ? 'Ungespeicherte Änderungen' : (state.savedBuild ? 'Gespeichert' : 'Standard · noch nicht als Preset gespeichert');
        saveState.classList.toggle('is-dirty', dirty);
        container.dataset.buildValid = String(validation.ok);
        container.dataset.buildDirty = String(dirty);
        undoButton.disabled = !state.history?.canUndo();
        redoButton.disabled = !state.history?.canRedo();
        revertButton.disabled = !state.savedBuild || !dirty;
        activateButton.disabled = !validation.ok;
        activeBuildLabel.textContent = `Aktiver Run-Build: ${persistence.getActiveBuild(state.draft.vehicleId)?.name || 'Standard'}`;
    }

    return Object.freeze({ sync });
}
