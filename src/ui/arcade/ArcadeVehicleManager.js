/* eslint-disable max-lines */
import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import {
    loadVehicleProfiles,
    saveVehicleProfiles,
    getOrCreateProfile,
    evaluateUpgradePurchase,
    purchaseUpgrade,
    applyLoadoutPreset,
    getSpendableUpgradeXp,
    xpToNextLevel,
} from '../../state/arcade/ArcadeVehicleProfile.js';
import {
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
} from './VehicleManagerCatalog.js';
import { createVehicleManagerSelectionState } from './vehicle-manager/VehicleManagerSelectionState.js';
import { createVehicleManagerLoadoutPresetStore } from './vehicle-manager/VehicleManagerLoadoutPresets.js';
import { createVehicleManagerPreview3d } from './vehicle-manager/VehicleManagerPreview3d.js';
import {
    UPGRADE_SLOT_DISPLAY,
    HITBOX_LABELS,
    LEVEL_LABELS,
    createUiNode as el,
    normalizeVehicleValue as norm,
    nextVehicleTier as nextTier,
    toVehicleLevelBand as toBand,
    resolvePlayerColor as playerColor,
    collectCardBadges as cardBadges,
    buildStatRows as statRows,
    calcBarWidth as barWidth,
    renderVehicleQuickRow,
    refreshVehiclePresetSelect,
} from './vehicle-manager/VehicleManagerUiPrimitives.js';

function t(textId, fallback) {
    return resolveMenuCatalogText(textId, fallback);
}

function describeUpgradeBlockReason(upgradeState) {
    const state = upgradeState && typeof upgradeState === 'object' ? upgradeState : {};
    const requiredLevel = Math.max(1, Number(state.requiredLevel) || 1);
    const spendableXp = Math.max(0, Math.round(Number(state.spendableXp) || 0));
    const cost = Math.max(0, Math.round(Number(state.cost) || 0));
    switch (String(state.code || '')) {
    case 'slot_locked':
        return 'Slot noch nicht freigeschaltet';
    case 'part_family_locked':
        return 'Teilefamilie noch gesperrt';
    case 'tier_locked':
    case 'level_locked':
        return `Tier erst ab Level ${requiredLevel}`;
    case 'insufficient_xp':
        return `Zu wenig Upgrade-XP (${spendableXp}/${cost})`;
    case 'invalid_tier_sequence':
        return 'Nur das naechste Tier ist erlaubt';
    case 'cost_invalid':
        return 'Upgrade-Kosten ungueltig';
    default:
        return 'Upgrade aktuell nicht verfuegbar';
    }
}

function buildUpgradeTooltip(slotLabel, nextTier, upgradeState) {
    const state = upgradeState && typeof upgradeState === 'object' ? upgradeState : {};
    const cost = Math.max(0, Math.round(Number(state.cost) || 0));
    if (state.ok) {
        return `${slotLabel} -> ${nextTier} (${cost} XP)`;
    }
    return `${slotLabel}: ${describeUpgradeBlockReason(state)}`;
}

export function setupArcadeVehicleManager(ctx = {}) {
    const ui = ctx.ui || {};
    const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    const runtimeAccess = ctx.runtimeAccess && typeof ctx.runtimeAccess === 'object'
        ? ctx.runtimeAccess
        : null;
    const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
    const eventTypes = ctx.eventTypes || {};
    const bind = typeof ctx.bind === 'function' ? ctx.bind : null;
    const store = runtimeAccess?.getSettingsStore?.()
        || ctx.settingsManager?.getSettingsRecordStorePort?.()
        || null;
    if (!bind) return null;

    settings.vehicles = settings.vehicles && typeof settings.vehicles === 'object'
        ? settings.vehicles
        : { PLAYER_1: 'ship5', PLAYER_2: 'ship5' };

    const rules = getVehicleManagerInteractionRules();
    const catalogEntries = listVehicleManagerCatalogEntries();
    if (!catalogEntries.length) return null;
    const byVehicleId = new Map(catalogEntries.map((entry) => [entry.vehicleId, entry]));

    const selection = createVehicleManagerSelectionState({ settings, catalogEntries });
    const presetStore = createVehicleManagerLoadoutPresetStore({ store });
    let profiles = loadVehicleProfiles(store);

    const container = el('section', 'arcade-surface-card arcade-vehicle-manager');
    container.id = 'arcade-vehicle-manager';
    container.tabIndex = 0;
    container.dataset.vehiclePreviewMode = String(rules?.preview?.mode || 'interactive-3d');
    container.dataset.vehicleBreakpointStacked = String(rules?.responsiveBreakpoints?.stackedPanelMaxWidth || 1000);
    container.dataset.vehicleBreakpointCompact = String(rules?.responsiveBreakpoints?.compactListMaxWidth || 700);
    container.appendChild(el('h3', 'arcade-surface-card-title', t('menu.arcade.vehicle.title', 'Vehicle Manager')));

    const layout = el('div', 'arcade-vehicle-layout');
    container.appendChild(layout);

    const leftPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-list');
    const controls = el('div', 'arcade-vehicle-controls');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'arcade-vehicle-search';
    search.placeholder = 'Suche nach Name oder Keyword...';
    search.value = selection.getSearchTerm();
    controls.appendChild(search);
    const onlyFavBtn = el('button', 'secondary-btn arcade-vehicle-favorites-only', 'Nur Favoriten');
    onlyFavBtn.type = 'button';
    controls.appendChild(onlyFavBtn);
    leftPanel.appendChild(controls);

    const categoryTabs = el('div', 'arcade-vehicle-category-tabs');
    leftPanel.appendChild(categoryTabs);
    const hitboxChips = el('div', 'arcade-vehicle-chip-row');
    leftPanel.appendChild(hitboxChips);
    const levelChips = el('div', 'arcade-vehicle-chip-row');
    leftPanel.appendChild(levelChips);

    const quickRows = el('div', 'arcade-vehicle-quick-rows');
    const favRow = el('div', 'arcade-vehicle-quick-row');
    const recentRow = el('div', 'arcade-vehicle-quick-row');
    quickRows.appendChild(favRow);
    quickRows.appendChild(recentRow);
    leftPanel.appendChild(quickRows);

    const resultLine = el('p', 'menu-hint arcade-vehicle-results-line');
    leftPanel.appendChild(resultLine);
    const vehicleList = el('div', 'arcade-vehicle-list');
    vehicleList.setAttribute('role', 'listbox');
    leftPanel.appendChild(vehicleList);
    layout.appendChild(leftPanel);

    const centerPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-preview');
    const previewStage = el('div', 'arcade-vehicle-preview-stage');
    previewStage.id = 'arcade-vehicle-preview-stage';
    const previewOverlay = el('div', 'arcade-vehicle-preview-overlay');
    previewOverlay.id = 'arcade-vehicle-preview-overlay';
    previewStage.appendChild(previewOverlay);
    centerPanel.appendChild(previewStage);
    centerPanel.appendChild(el('p', 'menu-hint arcade-vehicle-preview-hint', 'Maus ziehen: drehen | Mausrad: zoom | Slot-Punkte: Upgrade'));
    layout.appendChild(centerPanel);

    const rightPanel = el('section', 'arcade-vehicle-panel arcade-vehicle-panel-detail');
    const detailTitle = el('p', 'arcade-vehicle-detail-title');
    const detailMeta = el('p', 'arcade-vehicle-detail-meta');
    const detailText = el('p', 'arcade-surface-card-value arcade-vehicle-description');
    const detailBadges = el('div', 'arcade-vehicle-badges');
    rightPanel.appendChild(detailTitle);
    rightPanel.appendChild(detailMeta);
    rightPanel.appendChild(detailText);
    rightPanel.appendChild(detailBadges);

    const profileBox = el('div', 'arcade-vehicle-profile');
    const levelLine = el('p', 'arcade-vehicle-level', 'Level 1 | XP 0/100');
    const xpBar = el('div', 'arcade-vehicle-xp-bar');
    const xpFill = el('div', 'arcade-vehicle-xp-fill');
    xpBar.appendChild(xpFill);
    profileBox.appendChild(levelLine);
    profileBox.appendChild(xpBar);
    rightPanel.appendChild(profileBox);

    const favoriteBtn = el('button', 'secondary-btn arcade-vehicle-favorite-toggle', 'Als Favorit markieren');
    favoriteBtn.type = 'button';
    rightPanel.appendChild(favoriteBtn);

    const comparePanel = el('section', 'arcade-vehicle-compare');
    comparePanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Vergleich'));
    const compareSelect = document.createElement('select');
    compareSelect.className = 'arcade-vehicle-compare-select';
    comparePanel.appendChild(compareSelect);
    const compareRows = el('div', 'arcade-vehicle-compare-rows');
    comparePanel.appendChild(compareRows);
    rightPanel.appendChild(comparePanel);

    const slotGrid = el('div', 'arcade-vehicle-slots');
    const slotRefs = {};
    for (let i = 0; i < UPGRADE_SLOT_DISPLAY.length; i += 1) {
        const slot = UPGRADE_SLOT_DISPLAY[i];
        const row = el('div', 'arcade-vehicle-slot-row');
        const label = el('span', 'arcade-vehicle-slot-label', slot.label);
        const tier = el('span', 'arcade-vehicle-slot-tier', 'T1');
        const btn = el('button', 'secondary-btn arcade-vehicle-upgrade-btn', 'Upgrade');
        btn.type = 'button';
        btn.dataset.slot = slot.key;
        row.appendChild(label);
        row.appendChild(tier);
        row.appendChild(btn);
        slotGrid.appendChild(row);
        slotRefs[slot.key] = { tier, btn, label: slot.label };
    }
    rightPanel.appendChild(slotGrid);

    const loadoutPanel = el('section', 'arcade-vehicle-loadout');
    loadoutPanel.appendChild(el('h4', 'arcade-vehicle-subtitle', 'Loadout Presets'));
    const loadoutControls = el('div', 'arcade-vehicle-loadout-controls');
    const presetName = document.createElement('input');
    presetName.type = 'text';
    presetName.className = 'arcade-vehicle-preset-input';
    presetName.placeholder = 'Preset-Name';
    const presetSelect = document.createElement('select');
    presetSelect.className = 'arcade-vehicle-preset-select';
    const presetSave = el('button', 'secondary-btn arcade-vehicle-preset-save', 'Speichern');
    presetSave.type = 'button';
    const presetLoad = el('button', 'secondary-btn arcade-vehicle-preset-load', 'Laden');
    presetLoad.type = 'button';
    const presetDelete = el('button', 'secondary-btn arcade-vehicle-preset-delete', 'Loeschen');
    presetDelete.type = 'button';
    loadoutControls.appendChild(presetName);
    loadoutControls.appendChild(presetSelect);
    loadoutControls.appendChild(presetSave);
    loadoutControls.appendChild(presetLoad);
    loadoutControls.appendChild(presetDelete);
    loadoutPanel.appendChild(loadoutControls);
    rightPanel.appendChild(loadoutPanel);

    rightPanel.appendChild(el('p', 'menu-hint arcade-vehicle-shortcuts', 'Shortcuts: <-/-> Fahrzeug | 1-5 Kategorie | F Favorit'));
    layout.appendChild(rightPanel);

    const preview = createVehicleManagerPreview3d({ mount: previewStage, overlay: previewOverlay });

    const profileFor = (vehicleId) => {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        const profile = getOrCreateProfile(profiles, id);
        profiles[id] = profile;
        return profile;
    };

    const persistProfiles = () => saveVehicleProfiles(store, profiles);

    const entryFor = (vehicleId) => {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        return byVehicleId.get(id) || resolveVehicleManagerCatalogEntry(id);
    };

    const toast = (message, tone = 'info') => {
        if (!emit || !eventTypes.SHOW_STATUS_TOAST) return;
        emit(eventTypes.SHOW_STATUS_TOAST, { message, tone, duration: 1200 });
    };

    const showPresetValidationFeedback = (rejectedEntries = []) => {
        if (!Array.isArray(rejectedEntries) || rejectedEntries.length === 0) return;
        const codes = new Set(rejectedEntries.map((entry) => String(entry?.code || '').trim()).filter(Boolean));
        const blockedByGate = codes.has('slot_locked')
            || codes.has('part_family_locked')
            || codes.has('tier_locked')
            || codes.has('level_locked');
        const reasonLabel = blockedByGate ? 'Gate verletzt' : 'ungueltige Eintraege';
        toast(`Preset bereinigt: ${rejectedEntries.length} ${reasonLabel}`, 'warning');
    };

    const syncVehicleContract = (vehicleId) => {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        settings.vehicles.PLAYER_1 = id;
        if (!ui.vehicleSelectP1) return id;
        const options = Array.from(ui.vehicleSelectP1.options || []);
        if (!options.some((option) => String(option?.value || '') === id)) {
            return norm(ui.vehicleSelectP1.value, id);
        }
        if (ui.vehicleSelectP1.value !== id) ui.vehicleSelectP1.value = id;
        ui.vehicleSelectP1.dispatchEvent(new Event('change', { bubbles: true }));
        settings.vehicles.PLAYER_1 = norm(ui.vehicleSelectP1.value, id);
        return settings.vehicles.PLAYER_1;
    };

    const selectVehicle = (vehicleId, options) => { selection.setSelectedVehicleId(vehicleId, options); syncVehicleContract(vehicleId); syncDisplay(); };
    const syncQuickRow = (containerNode, label, ids) => renderVehicleQuickRow({ containerNode, label, ids, resolveLabel: (vehicleId) => entryFor(vehicleId).label, bind, onSelect: selectVehicle });
    const refreshPresets = (preferredPresetId = '') => {
        const selectedVehicleId = selection.getSelectedVehicleId();
        const presets = presetStore.listPresets(selectedVehicleId);
        refreshVehiclePresetSelect({ presetSelect, presetLoad, presetDelete, presets, preferredPresetId });
    };

    const upgradeSlot = (slotKey) => {
        const selectedVehicleId = selection.getSelectedVehicleId();
        const profile = profileFor(selectedVehicleId);
        const current = profile.upgrades?.[slotKey] || 'T1';
        const next = nextTier(current);
        if (!next) return;
        const upgradeResult = purchaseUpgrade(profile, slotKey, next);
        if (!upgradeResult.ok) {
            toast(describeUpgradeBlockReason(upgradeResult), 'warning');
            syncDisplay();
            return;
        }
        profiles[selectedVehicleId] = upgradeResult.profile;
        persistProfiles();
        toast(`${slotKey} -> ${next} (-${upgradeResult.cost} XP)`);
        syncDisplay();
    };

    function syncDisplay() {
        const selectedVehicleId = selection.getSelectedVehicleId();
        const selectedEntry = entryFor(selectedVehicleId);
        const profile = profileFor(selectedVehicleId);
        const xp = xpToNextLevel(profile);
        const spendableUpgradeXp = getSpendableUpgradeXp(profile);
        const favorites = new Set(selection.getFavorites());
        const recents = new Set(selection.getRecents());
        const visible = selection.getVisibleEntries(profiles);

        detailTitle.textContent = selectedEntry.label;
        detailMeta.textContent = `${selectedEntry.kategorie} | ${selectedEntry.hitboxKlasse} | Levelband ${toBand(profile.level)}`;
        detailText.textContent = selectedEntry.kurzbeschreibung;
        detailBadges.innerHTML = '';
        cardBadges(selectedEntry, profile, favorites.has(selectedVehicleId), recents.has(selectedVehicleId)).forEach((badge) => {
            detailBadges.appendChild(el('span', 'arcade-vehicle-badge', badge));
        });

        levelLine.textContent = `Level ${profile.level} | XP ${xp.current}/${xp.required} | Upgrade-XP ${spendableUpgradeXp}`;
        xpFill.style.width = `${(xp.progress * 100).toFixed(1)}%`;
        favoriteBtn.textContent = favorites.has(selectedVehicleId) ? 'Favorit entfernen' : 'Als Favorit markieren';
        favoriteBtn.classList.toggle('is-active', favorites.has(selectedVehicleId));

        resultLine.textContent = `${visible.length} Fahrzeuge sichtbar`;
        onlyFavBtn.classList.toggle('is-active', selection.isFavoritesOnly());

        categoryTabs.querySelectorAll('button').forEach((btn) => {
            btn.classList.toggle('is-active', String(btn.dataset.category || '') === selection.getCategory());
        });
        hitboxChips.querySelectorAll('button').forEach((btn) => {
            btn.classList.toggle('is-active', String(btn.dataset.filterValue || '') === selection.getHitboxFilter());
        });
        levelChips.querySelectorAll('button').forEach((btn) => {
            btn.classList.toggle('is-active', String(btn.dataset.filterValue || '') === selection.getLevelFilter());
        });

        vehicleList.innerHTML = '';
        if (!visible.length) {
            vehicleList.appendChild(el('p', 'menu-hint', 'Kein Fahrzeug fuer die aktuelle Filterung gefunden.'));
        }
        for (let i = 0; i < visible.length; i += 1) {
            const entry = visible[i];
            const listProfile = profileFor(entry.vehicleId);
            const card = el('button', 'arcade-vehicle-card');
            card.type = 'button';
            card.dataset.vehicleId = entry.vehicleId;
            card.dataset.vehicleCategory = entry.kategorie;
            card.dataset.vehicleHitbox = entry.hitboxKlasse;
            card.dataset.vehiclePreviewToken = entry.previewToken;
            card.classList.toggle('selected', entry.vehicleId === selectedVehicleId);
            card.classList.toggle('is-favorite', favorites.has(entry.vehicleId));
            card.setAttribute('role', 'option');
            card.setAttribute('aria-selected', String(entry.vehicleId === selectedVehicleId));

            const header = el('div', 'arcade-vehicle-card-header');
            header.appendChild(el('span', 'arcade-vehicle-card-title', entry.label));
            const miniBadges = el('div', 'arcade-vehicle-card-badges');
            cardBadges(entry, listProfile, favorites.has(entry.vehicleId), recents.has(entry.vehicleId)).forEach((badge) => {
                miniBadges.appendChild(el('span', 'arcade-vehicle-mini-badge', badge));
            });
            header.appendChild(miniBadges);
            card.appendChild(header);
            card.appendChild(el('p', 'arcade-vehicle-card-meta', `${entry.kategorie} | ${entry.hitboxKlasse} | Lv ${listProfile.level}`));
            bind(card, 'click', () => {
                selectVehicle(entry.vehicleId);
            });
            vehicleList.appendChild(card);
        }

        syncQuickRow(favRow, 'Favoriten', selection.getFavorites());
        syncQuickRow(recentRow, 'Zuletzt genutzt', selection.getRecents());

        compareSelect.innerHTML = '';
        const compareOptions = catalogEntries.filter((entry) => entry.vehicleId !== selectedVehicleId);
        if (!compareOptions.length) {
            compareSelect.disabled = true;
            const option = document.createElement('option');
            option.value = selectedVehicleId;
            option.textContent = selectedEntry.label;
            compareSelect.appendChild(option);
        } else {
            compareSelect.disabled = false;
            compareOptions.forEach((entry) => {
                const option = document.createElement('option');
                option.value = entry.vehicleId;
                option.textContent = entry.label;
                compareSelect.appendChild(option);
            });
            const compareId = selection.getCompareVehicleId();
            if (!compareOptions.some((entry) => entry.vehicleId === compareId)) {
                selection.setCompareVehicleId(compareOptions[0].vehicleId);
            }
            compareSelect.value = selection.getCompareVehicleId();
        }

        compareRows.innerHTML = '';
        const compareEntry = entryFor(selection.getCompareVehicleId());
        statRows(selectedEntry.statsSummary, compareEntry.statsSummary).forEach((metric) => {
            const row = el('div', 'arcade-vehicle-compare-row');
            row.appendChild(el('span', 'arcade-vehicle-compare-label', metric.label));
            const leftShell = el('div', 'arcade-vehicle-compare-bar-shell');
            const leftBar = el('div', 'arcade-vehicle-compare-bar arcade-vehicle-compare-bar-left');
            leftBar.style.width = barWidth(metric.left, metric.max);
            leftShell.appendChild(leftBar);
            row.appendChild(leftShell);
            row.appendChild(el('span', 'arcade-vehicle-compare-value', String(metric.left)));
            row.appendChild(el('span', 'arcade-vehicle-compare-value', String(metric.right)));
            const rightShell = el('div', 'arcade-vehicle-compare-bar-shell');
            const rightBar = el('div', 'arcade-vehicle-compare-bar arcade-vehicle-compare-bar-right');
            rightBar.style.width = barWidth(metric.right, metric.max);
            rightShell.appendChild(rightBar);
            row.appendChild(rightShell);
            compareRows.appendChild(row);
        });

        refreshPresets(presetSelect.value);

        const overlayStates = [];
        for (let i = 0; i < UPGRADE_SLOT_DISPLAY.length; i += 1) {
            const slot = UPGRADE_SLOT_DISPLAY[i];
            const ref = slotRefs[slot.key];
            const current = profile.upgrades?.[slot.key] || 'T1';
            const next = nextTier(current);
            ref.tier.textContent = current;
            if (!next) {
                ref.btn.textContent = 'MAX';
                ref.btn.disabled = true;
                overlayStates.push({ slotKey: slot.key, badge: 'MAX', disabled: true, label: ref.label, tooltip: `${ref.label} maxed` });
                continue;
            }
            const upgradeState = evaluateUpgradePurchase(profile, slot.key, next);
            const allowed = upgradeState.ok;
            const cost = Number.isFinite(upgradeState.cost) ? Math.round(upgradeState.cost) : 0;
            ref.btn.textContent = `${next} (${cost} XP)`;
            ref.btn.disabled = !allowed;
            overlayStates.push({
                slotKey: slot.key,
                badge: current,
                disabled: !allowed,
                label: ref.label,
                tooltip: buildUpgradeTooltip(ref.label, next, upgradeState),
            });
        }

        preview.setVehicle(selectedVehicleId, playerColor(settings));
        preview.setSlotStates(overlayStates, (slotKey) => upgradeSlot(slotKey));
        container.dataset.previewStatus = preview.getStatus();
    }

    rules.categories.forEach((category) => {
        const button = el('button', 'arcade-vehicle-tab', category.label);
        button.type = 'button';
        button.dataset.category = category.id;
        bind(button, 'click', () => {
            selection.setCategory(category.id);
            syncDisplay();
        });
        categoryTabs.appendChild(button);
    });

    ['all', ...rules.filterChips.hitboxKlasse].forEach((value) => {
        const button = el('button', 'arcade-vehicle-chip', HITBOX_LABELS[value] || value);
        button.type = 'button';
        button.dataset.filterValue = value;
        bind(button, 'click', () => {
            selection.setHitboxFilter(value);
            syncDisplay();
        });
        hitboxChips.appendChild(button);
    });

    ['all', ...rules.filterChips.levelBand].forEach((value) => {
        const button = el('button', 'arcade-vehicle-chip', LEVEL_LABELS[value] || value);
        button.type = 'button';
        button.dataset.filterValue = value;
        bind(button, 'click', () => {
            selection.setLevelFilter(value);
            syncDisplay();
        });
        levelChips.appendChild(button);
    });

    bind(search, 'input', () => {
        selection.setSearchTerm(search.value);
        syncDisplay();
    });

    bind(onlyFavBtn, 'click', () => {
        selection.setFavoritesOnly(!selection.isFavoritesOnly());
        syncDisplay();
    });

    bind(favoriteBtn, 'click', () => {
        selection.toggleFavorite(selection.getSelectedVehicleId());
        syncDisplay();
    });

    bind(compareSelect, 'change', () => {
        selection.setCompareVehicleId(compareSelect.value);
        syncDisplay();
    });

    UPGRADE_SLOT_DISPLAY.forEach((slot) => {
        bind(slotRefs[slot.key].btn, 'click', () => upgradeSlot(slot.key));
    });

    bind(presetSave, 'click', () => {
        const selectedVehicleId = selection.getSelectedVehicleId();
        const profile = profileFor(selectedVehicleId);
        const defaultName = `${entryFor(selectedVehicleId).label} Setup`;
        const sanitizedPreset = applyLoadoutPreset(profile, profile.upgrades || {});
        const saved = presetStore.savePreset(
            selectedVehicleId,
            norm(presetName.value, defaultName),
            sanitizedPreset.upgrades || {}
        );
        presetName.value = '';
        refreshPresets(saved.presetId);
        showPresetValidationFeedback(saved.invalidEntries);
        showPresetValidationFeedback(sanitizedPreset.rejectedEntries);
        toast(`Preset gespeichert: ${saved.name}`);
    });

    bind(presetLoad, 'click', () => {
        const selectedVehicleId = selection.getSelectedVehicleId();
        const preset = presetStore.loadPreset(selectedVehicleId, presetSelect.value);
        if (!preset) return;
        const profile = profileFor(selectedVehicleId);
        const loadedPreset = applyLoadoutPreset(profile, preset.upgrades || {});
        profiles[selectedVehicleId] = loadedPreset.profile;
        persistProfiles();
        showPresetValidationFeedback(preset.invalidEntries);
        showPresetValidationFeedback(loadedPreset.rejectedEntries);
        toast(`Preset geladen: ${preset.name}`);
        syncDisplay();
    });

    bind(presetDelete, 'click', () => {
        const selectedVehicleId = selection.getSelectedVehicleId();
        if (!presetStore.deletePreset(selectedVehicleId, presetSelect.value)) return;
        refreshPresets('');
        toast('Preset geloescht', 'warning');
        syncDisplay();
    });

    bind(vehicleList, 'wheel', (event) => {
        if (!event || typeof event.deltaY !== 'number') return;
        if (Math.abs(event.deltaY) < 3) return;
        event.preventDefault();
        const step = event.deltaY > 0 ? 1 : -1;
        const nextId = selection.getNextVisibleVehicleId(step, profiles);
        selectVehicle(nextId);
    }, { passive: false });

    bind(container, 'keydown', (event) => {
        if (!event) return;
        const key = String(event.key || '');
        if (key === 'ArrowRight' || key === 'ArrowLeft') {
            event.preventDefault();
            const nextId = selection.getNextVisibleVehicleId(key === 'ArrowRight' ? 1 : -1, profiles);
            selectVehicle(nextId);
            return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            event.preventDefault();
            selection.cycleCategory(key === 'ArrowDown' ? 1 : -1);
            const visible = selection.getVisibleEntries(profiles);
            if (visible.length && !visible.some((entry) => entry.vehicleId === selection.getSelectedVehicleId())) {
                selection.setSelectedVehicleId(visible[0].vehicleId, { skipRecent: true });
            }
            syncDisplay();
            return;
        }
        if (key.toLowerCase() === 'f') {
            event.preventDefault();
            selection.toggleFavorite(selection.getSelectedVehicleId());
            syncDisplay();
            return;
        }
        if (/^[1-5]$/.test(key)) {
            const idx = Number.parseInt(key, 10) - 1;
            const category = rules.categories[idx];
            if (!category) return;
            selection.setCategory(category.id);
            syncDisplay();
        }
    });

    if (ui.vehicleSelectP1) {
        bind(ui.vehicleSelectP1, 'change', () => {
            const nextId = norm(ui.vehicleSelectP1.value).toLowerCase();
            if (!nextId || nextId === selection.getSelectedVehicleId()) return;
            selection.setSelectedVehicleId(nextId, { skipRecent: true });
            syncDisplay();
        });
    }

    syncVehicleContract(selection.getSelectedVehicleId());
    syncDisplay();

    return {
        container,
        syncDisplay,
        getSelectedVehicleId: () => selection.getSelectedVehicleId(),
        dispose: () => preview.dispose(),
    };
}
