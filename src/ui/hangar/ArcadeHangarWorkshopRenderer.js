import {
    HITBOX_LABELS,
    LEVEL_LABELS,
    createUiNode as el,
    resolvePlayerColor,
    toVehicleLevelBand,
} from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { resolveFightPartTradeoff } from '../../shared/contracts/FightHangarBalanceContract.js';
import { resolveFightMachineGunModel } from '../../shared/contracts/FightMachineGunContract.js';
import { HANGAR_SLOT_DEFINITIONS, listHangarParts, resolveHangarPart, resolvePartLockReason } from './HangarPartCatalog.js';
import { resolveHangarStoneAvailability } from './HangarStoneInventory.js';
import { validateHangarBuild } from './HangarBuildValidation.js';
import { compareHangarStats, projectHangarStats } from './HangarStatProjection.js';

const VEHICLE_CATEGORY_LABELS = Object.freeze({
    jaeger: 'Jäger',
    kreuzer: 'Kreuzer',
    spezial: 'Spezial',
    custom: 'Custom',
});

const STAT_VALUE_HINTS = Object.freeze({
    speed: 'Abstrakter Geschwindigkeitswert',
    agility: 'Abstrakter Wendigheitswert',
    maxHp: 'Lebenspunkte',
    mass: 'Verbrauchtes Massebudget',
    energy: 'Verbrauchtes Energiebudget',
    heat: 'Erzeugte Hitze',
    partCount: 'Eingesetzte Steine',
    budget: 'Verbrauchtes Editorbudget',
});

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

function deltaText(value) {
    const number = Number(value) || 0;
    if (number > 0) return `↑ +${number}`;
    if (number < 0) return `↓ ${number}`;
    return '→ ±0';
}

function partStatsText(part) {
    return [
        Number(part.stats.speed) ? `Tempo +${part.stats.speed}` : '',
        Number(part.stats.agility) ? `Wende +${part.stats.agility}` : '',
        Number(part.stats.maxHp) ? `HP +${part.stats.maxHp}` : '',
    ].filter(Boolean).join(' · ');
}

function signed(value, suffix = '') {
    const number = Number(value) || 0;
    return `${number > 0 ? '+' : ''}${number}${suffix}`;
}

function partRunBonusesText(part, multiplier = 1, mode = 'arcade') {
    const bonuses = mode === 'fight' ? resolveFightPartTradeoff(part) : (part.bonuses || {});
    return [
        Number(bonuses.speedBonusPct) ? `Tempo ${signed(bonuses.speedBonusPct * multiplier, '%')}` : '',
        Number(bonuses.turningBonusPct) ? `Wende ${signed(bonuses.turningBonusPct * multiplier, '%')}` : '',
        Number(bonuses.maxHpBonus) ? `HP ${signed(bonuses.maxHpBonus * multiplier)}` : '',
    ].filter(Boolean).join(' · ') || 'keine direkten Run-Boni';
}

function partCostsText(part, paired) {
    const multiplier = paired ? 2 : 1;
    const costs = part.costs;
    return `${paired ? 'Paarpreis' : 'Kosten'}: B ${costs.budget * multiplier} · M ${costs.mass * multiplier} · E ${costs.energy * multiplier} · H ${costs.heat * multiplier}`;
}

export function createArcadeHangarWorkshopRenderer(options) {
    const {
        shell, settings, catalogEntries, selection, persistence, viewport, catalogPreview,
        getState, entryFor, profileFor, evaluateInstall, describeFailure,
        onSelectSlot, isDirty,
    } = options;
    const validateBuild = typeof options.validateBuild === 'function' ? options.validateBuild : validateHangarBuild;
    const mode = options.mode === 'fight' ? 'fight' : 'arcade';
    const {
        container, saveState, vehiclesViewButton, partsViewButton, search, onlyFavBtn,
        categoryTabs, hitboxChips, levelChips, partFilters, partFilterReset, quickRows, favRow, recentRow,
        resultLine, catalogList, detailTitle, detailMeta, detailDescription, favoriteBtn, levelLine, xpFill,
        vehiclePreviousButton, vehicleNextButton,
        machineGunSelect, machineGunDetails, compareSelect, buildCompareSelect, statRows, budgetRows, partPreviewBox, slotGrid, validationBox, undoButton, redoButton,
        revertButton, activateButton, presetSelect, presetLoad, presetRename, presetDuplicate,
        presetDelete, presetSort, presetTags, presetFavorite, presetExport, activeBuildLabel,
        workshopViewButton, statsViewButton, presetsViewButton,
        workshopViewPanel, statsViewPanel, presetsViewPanel,
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

    function renderVehicles(state) { catalogPreview?.clearTargets?.();
        const visible = selection.getVisibleEntries(state.profiles);
        const favorites = new Set(selection.getFavorites());
        const focusVehicleId = visible.some((entry) => entry.vehicleId === state.draft.vehicleId)
            ? state.draft.vehicleId
            : visible[0]?.vehicleId;
        catalogList.setAttribute('role', 'listbox');
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
            card.tabIndex = entry.vehicleId === focusVehicleId ? 0 : -1;
            if (catalogPreview?.available) catalogPreview.attachCard(card, entry.vehicleId);
            card.append(
                el('span', 'arcade-vehicle-card-title', entry.label),
                el(
                    'span',
                    'arcade-vehicle-card-meta',
                    `${VEHICLE_CATEGORY_LABELS[entry.kategorie] || entry.kategorie} · ${HITBOX_LABELS[entry.hitboxKlasse] || entry.hitboxKlasse} · Lv ${profile.level}`
                )
            );
            catalogList.appendChild(card);
        });
        const favoriteIds = selection.getFavorites();
        const recentIds = selection.getRecents();
        renderQuickRow(favRow, 'Favoriten', favoriteIds);
        renderQuickRow(recentRow, 'Zuletzt', recentIds);
        quickRows.classList.toggle('hidden', !favoriteIds.length && !recentIds.length);
    }

    function renderParts(state) { catalogPreview?.clearTargets?.();
        const profile = profileFor(state.draft.vehicleId);
        catalogList.setAttribute('role', 'list');
        const records = listHangarParts({ search: search.value, color: state.partFamily, tier: state.partTier, trait: state.partTrait })
            .map((part) => {
                const availability = resolveHangarStoneAvailability(part, profile, state.draft);
                const selectedTarget = part.compatibleSlots.includes(state.selectedSlotId) ? state.selectedSlotId : '';
                const target = selectedTarget || part.compatibleSlots.find((slotId) => state.draft.slots[slotId] !== part.id) || part.compatibleSlots[0];
                const projected = target && availability.canInstall ? evaluateInstall(part.id, target) : null;
                const ruleLock = resolvePartLockReason(part, profile.level, projected);
                const pairNeedsAnotherStone = projected?.errors?.some((error) => error.code === 'stone_inventory');
                const purchase = availability.canPurchase && (!availability.canInstall || pairNeedsAnotherStone);
                const inventoryLock = !availability.canInstall && !availability.canPurchase
                    ? { code: 'stone_inventory', message: availability.levelAllowsPurchase
                        ? `Noch ${Math.max(0, availability.priceXrp - availability.xrp)} XRP erforderlich`
                        : `Weitere Exemplare ab Level ${availability.purchaseLevel}` }
                    : null;
                return { part, availability, purchase, lock: purchase ? null : (ruleLock || inventoryLock) };
            })
            .filter(({ lock }) => state.partAvailability === 'available' ? !lock : (state.partAvailability === 'locked' ? Boolean(lock) : true));
        resultLine.textContent = `${records.length} Steine · universell in jede Fassung einsetzbar`;
        catalogList.replaceChildren();
        if (!records.length) catalogList.appendChild(el('p', 'menu-hint hangar-empty-state', 'Keine Steine für diese Filterung gefunden.'));
        records.forEach(({ part, availability, purchase, lock }) => {
            const card = el('article', 'hangar-part-card');
            card.setAttribute('role', 'listitem');
            card.dataset.partId = part.id;
            card.dataset.stoneColor = part.colorId;
            card.dataset.partLabel = part.label;
            card.dataset.partTrait = part.trait;
            card.classList.toggle('is-locked', Boolean(lock));
            card.classList.toggle('is-purchase', purchase);
            card.classList.toggle('is-selected', state.selectedPartId === part.id);
            if (lock && !purchase) {
                card.dataset.locked = 'true';
                const targetXp = lock.unlockLevel ? Number(state.xpForLevel?.(lock.unlockLevel)) || 0 : 0;
                const remainingXp = Math.max(0, targetXp - (Number(profile.xp) || 0));
                card.dataset.lockedReason = `${lock.message}${remainingXp ? ` · noch ${remainingXp} XP` : ''}`;
            }
            const paired = part.symmetric && shell.pairToggle.checked;
            const head = el('div', 'hangar-part-card-head');
            head.append(el('strong', 'hangar-part-name', part.label), el('span', `hangar-tier hangar-tier-${part.tier.toLowerCase()}`, part.tier));
            const colorLine = el('span', 'hangar-part-family');
            const colorSwatch = el('span', 'hangar-stone-swatch');
            colorSwatch.style.backgroundColor = `#${Number(part.appearance?.color || 0).toString(16).padStart(6, '0')}`;
            colorLine.append(colorSwatch, `${part.colorLabel || part.colorId} · ${part.role}`);
            const selectButton = button('hangar-part-select', ''); if (catalogPreview?.available) catalogPreview.attachPartCard(selectButton, part);
            selectButton.dataset.partSelect = part.id;
            selectButton.setAttribute('aria-pressed', String(state.selectedPartId === part.id));
            selectButton.setAttribute('aria-disabled', String(Boolean(lock) && !purchase));
            if (lock && !purchase) selectButton.title = card.dataset.lockedReason;
            selectButton.append(
                head,
                colorLine,
                el('span', 'hangar-part-stats', partStatsText(part)),
                el('span', 'hangar-part-run-bonuses', `Run: ${partRunBonusesText(part, paired ? 2 : 1, mode)}`),
                el('span', 'hangar-part-costs', partCostsText(part, paired)),
                el('span', 'hangar-stone-inventory', `Bestand: ${availability.available} frei · ${availability.equipped}/${availability.owned} eingesetzt`),
                el('span', lock && !purchase ? 'hangar-part-lock-reason' : 'hangar-part-drag-hint', purchase ? 'Vorschau öffnen oder ausdrücklich kaufen' : (lock ? card.dataset.lockedReason : 'Anklicken oder auf eine Fassung ziehen'))
            );
            card.appendChild(selectButton);
            if (purchase) {
                const purchaseButton = button('secondary-btn hangar-part-purchase', `1 Exemplar für ${availability.priceXrp} XRP kaufen`);
                purchaseButton.dataset.purchaseStoneId = part.id;
                card.appendChild(purchaseButton);
            }
            catalogList.appendChild(card);
        });
        favRow.replaceChildren();
        recentRow.replaceChildren();
    }

    function resolvePreview(state) {
        const partId = state.selectedPartId || state.previewPartId;
        const part = resolveHangarPart(partId);
        if (!part) return null;
        const slotId = part.compatibleSlots.includes(state.selectedSlotId) ? state.selectedSlotId : part.compatibleSlots[0];
        return { part, slotId, result: evaluateInstall(part.id, slotId) };
    }

    function renderPartPreview(state) {
        const preview = resolvePreview(state);
        partPreviewBox.replaceChildren();
        partPreviewBox.classList.toggle('hidden', !preview);
        if (!preview) return;
        const slot = HANGAR_SLOT_DEFINITIONS.find((entry) => entry.id === preview.slotId);
        partPreviewBox.appendChild(el('strong', 'hangar-part-preview-title', `${preview.part.label} → ${slot?.label || preview.slotId}`));
        if (!preview.result?.ok) {
            partPreviewBox.appendChild(el('span', 'hangar-part-lock-reason', describeFailure(preview.result)));
            return;
        }
        const current = projectHangarStats(state.draft);
        const projected = projectHangarStats(preview.result.build);
        const deltas = compareHangarStats(projected, current)
            .filter((metric) => metric.delta !== 0)
            .map((metric) => `${metric.label} ${signed(metric.delta)}`);
        partPreviewBox.append(
            el('span', 'hangar-part-preview-deltas', deltas.join(' · ') || 'Keine Wertänderung'),
                el('span', 'hangar-part-preview-help', state.selectedPartId ? 'Fassung anklicken, um den Stein einzusetzen' : 'Anklicken, um den Stein auszuwählen')
        );
    }

    function renderStatistics(state, validation) {
        const current = projectHangarStats(state.draft);
        const saved = projectHangarStats(state.baselineBuild || state.savedBuild || state.draft);
        const savedComparison = persistence.getBuild(buildCompareSelect.value);
        const compareEntry = entryFor(selection.getCompareVehicleId());
        const compareBuild = savedComparison || state.buildFromProfile(compareEntry.vehicleId, compareEntry, profileFor(compareEntry.vehicleId));
        const savedMetrics = compareHangarStats(current, saved);
        const compareMetrics = compareHangarStats(current, projectHangarStats(compareBuild));
        const baselineLabel = state.savedBuild?.name || 'Standard';
        const comparisonLabel = savedComparison?.name || compareEntry.label;
        statRows.replaceChildren();
        savedMetrics.forEach((metric, index) => {
            const versus = compareMetrics[index];
            const row = el('div', 'arcade-vehicle-compare-row hangar-stat-row');
            row.dataset.metric = metric.key;
            const value = el('strong', 'hangar-stat-value', String(metric.value));
            value.title = `${STAT_VALUE_HINTS[metric.key] || metric.label}: ${metric.value}`;
            const comparisons = el('div', 'hangar-stat-comparisons');
            comparisons.append(
                el('span', `hangar-stat-delta is-${metric.tone}`, `Seit ${baselineLabel}: ${deltaText(metric.delta)}`),
                el('span', `hangar-stat-delta is-${versus.tone}`, `Gegen ${comparisonLabel}: ${deltaText(versus.delta)}`)
            );
            row.append(
                el('span', 'arcade-vehicle-compare-label', metric.label),
                value,
                comparisons
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

    function renderSlots(state, validation, activePartId) {
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
            const quick = button('secondary-btn arcade-vehicle-upgrade-btn', part?.tier === 'T3' ? 'MAX' : 'Stufe +');
            quick.dataset.quickUpgrade = slot.id;
            quick.setAttribute('aria-label', `${slot.label}: Steinstufe erhöhen`);
            const nextId = part?.upgradeTo || '';
            const nextValidation = nextId ? evaluateInstall(nextId, slot.id) : null;
            quick.disabled = !nextValidation?.ok;
            quick.title = nextValidation?.ok
                ? 'Nächste Steinstufe als Entwurf einsetzen'
                : (part?.tier === 'T3' ? 'Maximale Steinstufe erreicht' : (part ? describeFailure(nextValidation) : 'Keine Steinstufe eingesetzt'));
            quick.setAttribute('aria-description', quick.title);
            const remove = button('secondary-btn hangar-slot-remove', '×');
            remove.dataset.removeSlot = slot.id;
            remove.disabled = !part || slot.required;
            remove.setAttribute('aria-label', `${slot.label}: Stein entfernen`);
            remove.title = !part
                ? 'Fassung ist leer'
                : (slot.required ? 'Pflichtfassung kann nicht geleert werden' : `Stein aus ${slot.label} entfernen`);
            remove.setAttribute('aria-description', remove.title);
            row.append(label, installed, tier, quick, remove);
            slotGrid.appendChild(row);
            const dragValidation = activePartId ? evaluateInstall(activePartId, slot.id) : null;
            viewportStates.push({
                slotKey: slot.id,
                badge: part?.tier || '+',
                disabled: activePartId ? !dragValidation?.ok : false,
                tooltip: activePartId ? (dragValidation?.ok ? `${slot.label}: kompatibel` : describeFailure(dragValidation)) : `${slot.label}: ${part?.label || 'leer'}`,
                dropState: '',
            });
        });
        viewport.setSlotStates(viewportStates, (slotId) => {
            onSelectSlot(slotId);
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
        const builds = persistence.listBuildsSorted(state.draft.vehicleId, presetSort.value);
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
                const validity = validateBuild(build, profileFor(build.vehicleId).level, profileFor(build.vehicleId));
                option.textContent = `${build.favorite ? '★ ' : ''}${build.name}${validity.ok ? '' : ' ⚠'}`;
                presetSelect.appendChild(option);
            });
            presetSelect.value = builds.some((build) => build.buildId === selectedId) ? selectedId : (state.savedBuild?.buildId || builds[0].buildId);
        }
        const selected = Boolean(presetSelect.value);
        presetLoad.disabled = !selected;
        presetRename.disabled = !selected;
        presetDuplicate.disabled = !selected;
        presetDelete.disabled = !selected;
        presetFavorite.disabled = !selected;
        presetExport.disabled = !selected;
        const selectedBuild = persistence.getBuild(presetSelect.value);
        presetFavorite.textContent = selectedBuild?.favorite ? '★ Favorit' : '☆ Favorit';
        presetTags.value = selectedBuild?.tags?.join(', ') || '';
    }

    function sync(syncOptions = {}) {
        const state = getState();
        if (!state.draft) return;
        const entry = entryFor(state.draft.vehicleId);
        const profile = profileFor(state.draft.vehicleId);
        const validation = validateBuild(state.draft, profile.level, profile);
        const favorites = new Set(selection.getFavorites());
        detailTitle.textContent = entry.label;
        const levelBand = toVehicleLevelBand(profile.level);
        detailMeta.textContent = `${VEHICLE_CATEGORY_LABELS[entry.kategorie] || entry.kategorie} · ${HITBOX_LABELS[entry.hitboxKlasse] || entry.hitboxKlasse} · ${LEVEL_LABELS[levelBand] || levelBand}`;
        detailDescription.textContent = entry.kurzbeschreibung;
        const xp = state.xpToNextLevel(profile);
        levelLine.textContent = mode === 'fight'
            ? `Fight-Sidegrade · Leistungsbudget ${validation.balanceScore ?? 0}`
            : `Level ${profile.level} · Mastery ${profile.masteryMilestones?.length || 0} · XP ${xp.current}/${xp.required} · XRP ${state.getSpendableUpgradeXp(profile)}`;
        xpFill.style.width = mode === 'fight' ? '100%' : `${(xp.progress * 100).toFixed(1)}%`;
        if (mode === 'fight') {
            const machineGun = resolveFightMachineGunModel(state.draft.machineGunId);
            machineGunSelect.value = machineGun.id;
            machineGunDetails.textContent = machineGun.description;
        }
        favoriteBtn.textContent = favorites.has(state.draft.vehicleId) ? 'Favorit entfernen' : 'Favorit';
        favoriteBtn.classList.toggle('is-active', favorites.has(state.draft.vehicleId));
        vehiclesViewButton.classList.toggle('is-active', state.catalogView === 'vehicles');
        partsViewButton.classList.toggle('is-active', state.catalogView === 'parts');
        vehiclesViewButton.setAttribute('aria-selected', String(state.catalogView === 'vehicles'));
        partsViewButton.setAttribute('aria-selected', String(state.catalogView === 'parts'));
        vehiclesViewButton.tabIndex = state.catalogView === 'vehicles' ? 0 : -1;
        partsViewButton.tabIndex = state.catalogView === 'parts' ? 0 : -1;
        [categoryTabs, hitboxChips, levelChips].forEach((node) => node.classList.toggle('hidden', state.catalogView !== 'vehicles'));
        quickRows.classList.toggle(
            'hidden',
            state.catalogView !== 'vehicles' || (!selection.getFavorites().length && !selection.getRecents().length)
        );
        partFilters.classList.toggle('hidden', state.catalogView !== 'parts');
        onlyFavBtn.classList.toggle('hidden', state.catalogView !== 'vehicles');
        search.placeholder = state.catalogView === 'vehicles' ? 'Fahrzeuge durchsuchen …' : 'Steine durchsuchen …';
        if (!syncOptions.preserveCatalog) {
            if (state.catalogView === 'vehicles') renderVehicles(state);
            else renderParts(state);
        }
        categoryTabs.querySelectorAll('button').forEach((node) => {
            const active = node.dataset.category === selection.getCategory();
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-pressed', String(active));
        });
        hitboxChips.querySelectorAll('button').forEach((node) => {
            const active = node.dataset.filterValue === selection.getHitboxFilter();
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-pressed', String(active));
        });
        levelChips.querySelectorAll('button').forEach((node) => {
            const active = node.dataset.filterValue === selection.getLevelFilter();
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-pressed', String(active));
        });
        onlyFavBtn.classList.toggle('is-active', selection.isFavoritesOnly());
        onlyFavBtn.setAttribute('aria-pressed', String(selection.isFavoritesOnly()));
        partFilterReset.disabled = state.partFamily === 'all'
            && state.partTier === 'ALL'
            && state.partTrait === 'all'
            && state.partAvailability === 'all'
            && !search.value.trim();
        [
            [workshopViewButton, workshopViewPanel, 'workshop'],
            [statsViewButton, statsViewPanel, 'stats'],
            [presetsViewButton, presetsViewPanel, 'presets'],
        ].forEach(([buttonNode, panelNode, viewId]) => {
            const active = state.buildView === viewId;
            buttonNode.classList.toggle('is-active', active);
            buttonNode.setAttribute('aria-selected', String(active));
            buttonNode.tabIndex = active ? 0 : -1;
            panelNode.classList.toggle('hidden', !active);
        });
        const visibleVehicles = selection.getVisibleEntries(state.profiles);
        const canCycleVehicles = visibleVehicles.length > 1
            || (visibleVehicles.length === 1 && visibleVehicles[0].vehicleId !== state.draft.vehicleId);
        vehiclePreviousButton.disabled = !canCycleVehicles;
        vehicleNextButton.disabled = !canCycleVehicles;
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
        const previousBuildComparison = buildCompareSelect.value;
        buildCompareSelect.replaceChildren();
        const noBuild = document.createElement('option');
        noBuild.value = '';
        noBuild.textContent = 'Mit Fahrzeug vergleichen';
        buildCompareSelect.appendChild(noBuild);
        persistence.listBuilds(state.draft.vehicleId).forEach((build) => {
            const option = document.createElement('option');
            option.value = build.buildId;
            option.textContent = `Preset: ${build.name}`;
            buildCompareSelect.appendChild(option);
        });
        buildCompareSelect.value = Array.from(buildCompareSelect.options).some((option) => option.value === previousBuildComparison) ? previousBuildComparison : '';
        const activePartId = syncOptions.dragPartId || state.selectedPartId || state.previewPartId;
        renderStatistics(state, validation);
        renderPartPreview(state);
        renderSlots(state, validation, activePartId);
        renderPresets(state);
        viewport.setBuild(state.draft, { color: resolvePlayerColor(settings), changedSlots: syncOptions.changedSlots || [] });
        viewport.setComparison(persistence.getBuild(buildCompareSelect.value));
        viewport.setDragActive(Boolean(activePartId));
        if (!syncOptions.dragPartId) {
            const preview = resolvePreview(state);
            if (preview) viewport.setDragPreview(preview.part.id, preview.slotId, preview.result?.ok === true);
            else viewport.clearDragPreview();
        }
        container.dataset.previewStatus = viewport.getStatus();
        const dirty = isDirty();
        saveState.textContent = dirty ? 'Entwurf · automatische Sicherung aktiv' : (state.savedBuild ? 'Preset gespeichert' : 'Standard · kein Preset');
        saveState.classList.toggle('is-dirty', dirty);
        container.dataset.buildValid = String(validation.ok);
        container.dataset.buildDirty = String(dirty);
        undoButton.disabled = !state.history?.canUndo();
        redoButton.disabled = !state.history?.canRedo();
        revertButton.disabled = !state.baselineBuild || !dirty;
        activateButton.disabled = !validation.ok;
        activeBuildLabel.textContent = `Aktiver Run-Build: ${persistence.getActiveBuild(state.draft.vehicleId)?.name || 'Standard'}`;
    }

    return Object.freeze({ sync });
}
