/**
 * Event wiring of the catalog side of the hangar workshop: the vehicle/part switch, the build
 * tabs, search and filters, and the catalog list (select, hover preview, keyboard, drag start).
 *
 * Call it after the shell, the renderer and the drag controller exist. The handlers reach the
 * other modules through `api`, which the controller fills before anything runs.
 */
export function bindWorkshopCatalogEvents(st, api) {
    const { bind, selection, dragController } = st;
    const {
        viewSwitch, search, onlyFavBtn, categoryTabs, hitboxChips, levelChips,
        familySelect, tierSelect, traitSelect, availabilitySelect, partFilterReset,
        quickRows, catalogList, buildViewSwitch,
    } = st.shell;

    function showCatalogView(view) {
        st.catalogView = view === 'parts' ? 'parts' : 'vehicles';
        if (st.catalogView === 'vehicles') {
            st.selectedPartId = '';
            st.previewPartId = '';
        }
        search.value = st.catalogView === 'vehicles' ? selection.getSearchTerm() : '';
        api.syncDisplay();
    }

    bind(viewSwitch, 'click', (event) => {
        const view = event.target?.closest?.('[data-catalog-view]')?.dataset.catalogView;
        if (!view) return;
        showCatalogView(view);
    });
    bind(viewSwitch, 'keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const tabs = Array.from(viewSwitch.querySelectorAll('[data-catalog-view]'));
        const currentIndex = tabs.findIndex((node) => node === event.target);
        if (currentIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
        showCatalogView(next.dataset.catalogView);
        next.focus();
    });
    bind(buildViewSwitch, 'click', (event) => {
        const view = event.target?.closest?.('[data-build-view]')?.dataset.buildView;
        if (!['workshop', 'stats', 'presets', 'upgrade', 'form'].includes(view)) return;
        st.buildView = view;
        api.syncDisplay({ preserveCatalog: true });
    });
    bind(buildViewSwitch, 'keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const tabs = Array.from(buildViewSwitch.querySelectorAll('[data-build-view]:not(.hidden)'));
        const currentIndex = tabs.findIndex((node) => node === event.target);
        if (currentIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
        st.buildView = next.dataset.buildView;
        api.syncDisplay({ preserveCatalog: true });
        next.focus();
    });
    bind(search, 'input', () => {
        if (st.catalogView === 'vehicles') selection.setSearchTerm(search.value);
        api.syncDisplay();
    });
    bind(onlyFavBtn, 'click', () => {
        selection.setFavoritesOnly(!selection.isFavoritesOnly());
        api.syncDisplay();
    });
    bind(categoryTabs, 'click', (event) => {
        const value = event.target?.closest?.('[data-category]')?.dataset.category;
        if (!value) return;
        selection.setCategory(value);
        api.syncDisplay();
    });
    bind(hitboxChips, 'click', (event) => {
        const value = event.target?.closest?.('[data-filter-value]')?.dataset.filterValue;
        if (!value) return;
        selection.setHitboxFilter(value);
        api.syncDisplay();
    });
    bind(levelChips, 'click', (event) => {
        const value = event.target?.closest?.('[data-filter-value]')?.dataset.filterValue;
        if (!value) return;
        selection.setLevelFilter(value);
        api.syncDisplay();
    });
    bind(familySelect, 'change', () => {
        st.partFamily = familySelect.value;
        api.syncDisplay();
    });
    bind(tierSelect, 'change', () => {
        st.partTier = tierSelect.value;
        api.syncDisplay();
    });
    bind(traitSelect, 'change', () => {
        st.partTrait = traitSelect.value;
        api.syncDisplay();
    });
    bind(availabilitySelect, 'change', () => {
        st.partAvailability = availabilitySelect.value;
        api.syncDisplay();
    });
    bind(partFilterReset, 'click', () => {
        st.partFamily = 'all';
        st.partTier = 'ALL';
        st.partTrait = 'all';
        st.partAvailability = 'all';
        search.value = '';
        familySelect.value = st.partFamily;
        tierSelect.value = st.partTier;
        traitSelect.value = st.partTrait;
        availabilitySelect.value = st.partAvailability;
        api.syncDisplay();
    });
    bind(catalogList, 'click', (event) => {
        const vehicleId = event.target?.closest?.('[data-vehicle-id]')?.dataset.vehicleId;
        if (vehicleId) {
            api.selectVehicle(vehicleId);
            return;
        }
        const card = event.target?.closest?.('[data-part-id]');
        if (!card) return;
        if (card.dataset.hangarSuppressClick === 'true') return;
        if (card.dataset.locked === 'true') {
            api.toast(card.dataset.lockedReason || 'Dieser Stein ist noch gesperrt.', 'warning');
            return;
        }
        api.selectPart(card.dataset.partId);
    });
    bind(catalogList, 'pointerover', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (!card || card.dataset.locked === 'true' || st.previewPartId === card.dataset.partId) return;
        st.previewPartId = card.dataset.partId;
        api.syncDisplay({ preserveCatalog: true });
    });
    bind(catalogList, 'pointerout', (event) => {
        const card = event.target?.closest?.('[data-part-id]');
        if (!card || card.contains(event.relatedTarget)) return;
        st.previewPartId = st.selectedPartId;
        api.syncDisplay({ preserveCatalog: true });
    });
    bind(quickRows, 'click', (event) => {
        const id = event.target?.closest?.('[data-quick-vehicle-id]')?.dataset.quickVehicleId;
        if (id) api.selectVehicle(id);
    });
    bind(catalogList, 'keydown', (event) => {
        const card = event.target?.closest?.('[data-vehicle-id]');
        if (!card || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const id = selection.getNextVisibleVehicleId(event.key === 'ArrowDown' ? 1 : -1, st.profiles);
        api.selectVehicle(id);
        const nextCard = Array.from(catalogList.querySelectorAll('[data-vehicle-id]'))
            .find((node) => node.dataset.vehicleId === id);
        nextCard?.focus();
    });
    bind(catalogList, 'pointerdown', (event) => {
        const selectButton = event.target?.closest?.('[data-part-select]');
        const card = selectButton?.closest?.('[data-part-id]');
        if (card && card.dataset.locked !== 'true') {
            dragController.begin(event, { partId: card.dataset.partId, label: card.dataset.partLabel }, card);
        }
    });
}
