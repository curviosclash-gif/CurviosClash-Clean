import {
    findEditorBuildEntryById,
    findEditorBuildEntryByToolAndSubtype,
    getEditorBuildCategories,
    getEditorBuildEntriesForCategory
} from './EditorBuildCatalog.js';
import { createEditorToolDockState } from './EditorToolDockState.js';

function resolveAssetIdForEntry(entry) {
    if (!entry) return null;
    if (entry.tool === 'item' || entry.tool === 'aircraft') {
        return entry.subType || null;
    }
    if (entry.tool === 'portal' && typeof entry.subType === 'string' && entry.subType.startsWith('portal_')) {
        return entry.subType;
    }
    if (entry.tool === 'tunnel' && typeof entry.subType === 'string' && entry.subType.startsWith('trail_')) {
        return entry.subType;
    }
    return null;
}

function resolveEntryAssetState(editor, entry) {
    const assetId = resolveAssetIdForEntry(entry);
    if (!assetId) {
        return {
            state: 'builtin',
            label: 'Direkt',
            detail: 'Keine externe Asset-Datei noetig.'
        };
    }

    const assetLoader = editor?.mapManager?.assetLoader;
    const status = assetLoader?.getLoadStatus?.(assetId) || { state: 'idle', id: assetId };

    if (status.state === 'loaded') {
        return {
            state: 'loaded',
            label: 'Ready',
            detail: 'Asset geladen.'
        };
    }

    if (status.state === 'loading' || status.state === 'idle') {
        return {
            state: 'loading',
            label: 'Laedt',
            detail: 'Asset wird geladen, Platzierung bleibt moeglich.'
        };
    }

    if (status.state === 'timeout') {
        return {
            state: 'timeout',
            label: 'Timeout',
            detail: 'Zeitlimit erreicht, Karte nutzt Fallback-Preview.'
        };
    }

    if (status.state === 'error') {
        return {
            state: 'error',
            label: 'Fehler',
            detail: 'Asset fehlgeschlagen, Platzierung nutzt Placeholder.'
        };
    }

    if (status.state === 'placeholder') {
        return {
            state: 'placeholder',
            label: 'Fallback',
            detail: status.reason === 'missing'
                ? 'Asset noch nicht im Cache, Platzierung nutzt Placeholder.'
                : 'Asset wird ueber Placeholder abgesichert.'
        };
    }

    return {
        state: 'placeholder',
        label: 'Fallback',
        detail: 'Assetstatus unbekannt, Fallback bleibt waehlbar.'
    };
}

function syncLegacySubtypeInputs(dom, entry) {
    if (!dom || !entry) return;

    const entryValue = String(entry.subType ?? '');
    if (entry.tool === 'spawn' && dom.selSpawnType) dom.selSpawnType.value = entryValue;
    if (entry.tool === 'tunnel' && dom.selTunnelType) dom.selTunnelType.value = entryValue;
    if (entry.tool === 'portal' && dom.selPortalType) dom.selPortalType.value = entryValue;
    if (entry.tool === 'item' && dom.selItemType) dom.selItemType.value = entryValue;
    if (entry.tool === 'aircraft' && dom.selAircraftType) dom.selAircraftType.value = entryValue;
}

function createEntryButton(entry, options = {}) {
    const button = document.createElement('button');
    const assetState = options.assetState || {
        state: 'builtin',
        label: 'Direkt',
        detail: 'Keine externe Asset-Datei noetig.'
    };
    button.type = 'button';
    button.dataset.entryId = entry.id;
    button.dataset.tool = entry.tool;
    button.dataset.subType = String(entry.subType ?? '');
    button.dataset.assetState = assetState.state;
    button.style.setProperty('--entry-accent', entry.accentColor);
    button.className = options.compact ? 'dockMiniCard' : 'buildCard';
    button.title = `${entry.label}: ${entry.description} ${assetState.detail}`;

    if (options.isActive) {
        button.classList.add('is-active');
    } else if (options.isSelected) {
        button.classList.add('is-selected');
    }

    if (options.compact) {
        button.innerHTML = `
            <span class="dockMiniGlyph">${entry.previewGlyph}</span>
            <span class="dockMiniLabelGroup">
                <span class="dockMiniLabel">${entry.label}</span>
                <span class="dockMiniState state-${assetState.state}">${assetState.label}</span>
            </span>
        `;
        return button;
    }

    button.innerHTML = `
        <span class="buildCardPreview" data-preview-token="${entry.previewToken}" aria-hidden="true">
            <span class="buildCardPreviewGlyph">${entry.previewGlyph}</span>
        </span>
        <span class="buildCardBody">
            <span class="buildCardTitleRow">
                <span class="buildCardTitle">${entry.label}</span>
                ${entry.badge ? `<span class="buildCardBadge">${entry.badge}</span>` : ''}
            </span>
            <span class="buildCardDescription">${entry.description}</span>
            <span class="buildCardFooter">
                <span class="buildCardState state-${assetState.state}">${assetState.label}</span>
                <span class="buildCardStateDetail">${assetState.detail}</span>
            </span>
        </span>
    `;

    return button;
}

function renderShortcutList(container, entries, snapshot, onSelect, emptyLabel, editor, onHoverChange) {
    if (!container) return;
    container.replaceChildren();

    if (!entries.length) {
        const emptyState = document.createElement('span');
        emptyState.className = 'dockShortcutEmpty';
        emptyState.textContent = emptyLabel;
        container.appendChild(emptyState);
        return;
    }

    for (const entry of entries) {
        const button = createEntryButton(entry, {
            compact: true,
            isActive: snapshot.mode === 'place' && snapshot.selectedEntry?.id === entry.id,
            isSelected: snapshot.selectedEntry?.id === entry.id,
            assetState: resolveEntryAssetState(editor, entry)
        });
        button.addEventListener('click', () => onSelect(entry.id));
        button.addEventListener('mouseenter', () => onHoverChange?.(entry.id));
        button.addEventListener('mouseleave', () => onHoverChange?.(null));
        button.addEventListener('focus', () => onHoverChange?.(entry.id));
        button.addEventListener('blur', () => onHoverChange?.(null));
        container.appendChild(button);
    }
}

function enableHorizontalWheelScroll(container) {
    if (!container || container.dataset.horizontalWheelBound === '1') return;
    container.dataset.horizontalWheelBound = '1';
    container.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        container.scrollLeft += event.deltaY;
        event.preventDefault();
    }, { passive: false });
}

function updateSummaryViews(dom, snapshot) {
    const activeEntry = snapshot.activeEntry || snapshot.selectedEntry;
    const isSelectionMode = snapshot.mode === 'select';
    const title = isSelectionMode
        ? 'Auswahl / Bewegen'
        : (activeEntry?.label || 'Build-Dock');
    const description = isSelectionMode
        ? `Letzte Baukarte: ${activeEntry?.label || 'keine'}. Unten eine Karte anklicken und dann in die Szene klicken.`
        : `${activeEntry?.description || 'Objekt platzieren.'} ${snapshot.assetState?.detail || 'Klick in die Szene, um die Platzierung auszufuehren.'}`;
    const badgeText = isSelectionMode ? 'Auswahl' : 'Bau-Modus';

    if (dom.inspectorToolModeBadge) dom.inspectorToolModeBadge.textContent = badgeText;
    if (dom.inspectorToolTitle) dom.inspectorToolTitle.textContent = title;
    if (dom.inspectorToolDescription) dom.inspectorToolDescription.textContent = description;
    if (dom.dockModeBadge) dom.dockModeBadge.textContent = badgeText;
    if (dom.dockActiveTitle) dom.dockActiveTitle.textContent = title;
    if (dom.dockActiveDescription) dom.dockActiveDescription.textContent = description;
}

export function bindEditorToolPaletteControls(editor) {
    if (!editor) return;
    const dom = editor.dom || {};
    const categories = getEditorBuildCategories();
    const toolDockState = createEditorToolDockState();
    editor.toolDockState = toolDockState;
    let hoveredEntryId = null;

    const buildSnapshotView = (snapshot) => {
        const hoveredEntry = hoveredEntryId ? findEditorBuildEntryById(hoveredEntryId) : null;
        const displayEntry = hoveredEntry || snapshot.selectedEntry || null;
        const isSelectionMode = hoveredEntry ? false : snapshot.mode === 'select';
        const assetState = displayEntry ? resolveEntryAssetState(editor, displayEntry) : null;
        return {
            ...snapshot,
            editor,
            activeEntry: displayEntry,
            selectedEntry: snapshot.selectedEntry,
            mode: isSelectionMode ? 'select' : 'place',
            assetState,
            isHoverPreview: !!hoveredEntry
        };
    };

    const applySnapshotToEditor = (snapshot, options = {}) => {
        const activeEntry = snapshot.selectedEntry;
        syncLegacySubtypeInputs(dom, activeEntry);

        const nextTool = snapshot.mode === 'place' ? (activeEntry?.tool || 'select') : 'select';
        const shouldClearSelection = options.clearSelection === true && nextTool !== 'select';
        editor.currentTool = nextTool;

        if (shouldClearSelection) {
            editor.selectObject(null);
        }

        updateSummaryViews(dom, buildSnapshotView(snapshot));

        if (dom.btnDockSelectMode) {
            dom.btnDockSelectMode.classList.toggle('active', snapshot.mode === 'select');
            dom.btnDockSelectMode.setAttribute('aria-pressed', snapshot.mode === 'select' ? 'true' : 'false');
        }

        if (dom.btnDockFavoriteToggle) {
            const favoriteActive = !!activeEntry && snapshot.favoriteEntries.some((entry) => entry.id === activeEntry.id);
            dom.btnDockFavoriteToggle.textContent = favoriteActive ? 'Favorit loesen' : 'Favorit merken';
            dom.btnDockFavoriteToggle.classList.toggle('active', favoriteActive);
            dom.btnDockFavoriteToggle.disabled = !activeEntry;
        }
    };

    const renderCategoryTabs = (snapshot) => {
        if (!dom.dockCategoryTabs) return;
        dom.dockCategoryTabs.replaceChildren();

        for (const category of categories) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dockCategoryTab';
            button.dataset.categoryId = category.id;
            button.style.setProperty('--entry-accent', category.accentColor);
            if (snapshot.currentCategoryId === category.id) {
                button.classList.add('active');
            }
            const categoryCount = getEditorBuildEntriesForCategory(category.id).length;
            button.innerHTML = `
                <span class="dockCategoryLabel">${category.label}</span>
                <span class="dockCategoryCount">${categoryCount}</span>
            `;
            button.title = `${category.label}: ${category.description}`;
            button.addEventListener('click', () => {
                hoveredEntryId = null;
                const nextSnapshot = toolDockState.activateCategory(category.id);
                applySnapshotToEditor(nextSnapshot, { clearSelection: true });
                renderAll(nextSnapshot);
            });
            button.addEventListener('keydown', (event) => {
                const buttons = Array.from(dom.dockCategoryTabs?.querySelectorAll('.dockCategoryTab') || []);
                const currentIndex = buttons.indexOf(button);
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const delta = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
                    buttons[nextIndex]?.focus();
                } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    dom.dockCards?.querySelector('[data-entry-id]')?.focus();
                }
            });
            dom.dockCategoryTabs.appendChild(button);
        }
    };

    const renderCards = (snapshot) => {
        if (!dom.dockCards) return;
        dom.dockCards.replaceChildren();

        const entries = getEditorBuildEntriesForCategory(snapshot.currentCategoryId);

        for (const entry of entries) {
            const button = createEntryButton(entry, {
                isActive: snapshot.mode === 'place' && snapshot.selectedEntry?.id === entry.id,
                isSelected: snapshot.selectedEntry?.id === entry.id,
                assetState: resolveEntryAssetState(editor, entry)
            });
            button.addEventListener('click', () => {
                hoveredEntryId = null;
                const nextSnapshot = toolDockState.activateEntry(entry.id);
                applySnapshotToEditor(nextSnapshot, { clearSelection: true });
                renderAll(nextSnapshot);
            });
            button.addEventListener('mouseenter', () => {
                hoveredEntryId = entry.id;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('mouseleave', () => {
                if (hoveredEntryId !== entry.id) return;
                hoveredEntryId = null;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('focus', () => {
                hoveredEntryId = entry.id;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('blur', () => {
                if (hoveredEntryId !== entry.id) return;
                hoveredEntryId = null;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('keydown', (event) => {
                const buttons = Array.from(dom.dockCards?.querySelectorAll('[data-entry-id]') || []);
                const currentIndex = buttons.indexOf(button);
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const delta = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
                    buttons[nextIndex]?.focus();
                    buttons[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    dom.dockCategoryTabs?.querySelector('.dockCategoryTab.active')?.focus();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    hoveredEntryId = null;
                    const nextSnapshot = toolDockState.activateSelectionMode();
                    applySnapshotToEditor(nextSnapshot);
                    renderAll(nextSnapshot);
                    dom.btnDockSelectMode?.focus();
                }
            });
            dom.dockCards.appendChild(button);
        }
    };

    const renderAll = (snapshot = toolDockState.getSnapshot()) => {
        renderCategoryTabs(snapshot);
        renderCards(snapshot);
        renderShortcutList(
            dom.dockRecentList,
            snapshot.recentEntries,
            snapshot,
            (entryId) => {
                const nextSnapshot = toolDockState.activateEntry(entryId);
                applySnapshotToEditor(nextSnapshot, { clearSelection: true });
                renderAll(nextSnapshot);
            },
            'Noch nichts benutzt',
            editor,
            (entryId) => {
                hoveredEntryId = entryId;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            }
        );
        renderShortcutList(
            dom.dockFavoriteList,
            snapshot.favoriteEntries,
            snapshot,
            (entryId) => {
                const nextSnapshot = toolDockState.activateEntry(entryId, { recordRecent: false });
                applySnapshotToEditor(nextSnapshot, { clearSelection: true });
                renderAll(nextSnapshot);
            },
            'Keine Favoriten',
            editor,
            (entryId) => {
                hoveredEntryId = entryId;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            }
        );
        updateSummaryViews(dom, buildSnapshotView(snapshot));
    };

    editor.refreshToolDock = () => {
        renderAll(toolDockState.getSnapshot());
    };

    dom.btnDockSelectMode?.addEventListener('click', () => {
        hoveredEntryId = null;
        const nextSnapshot = toolDockState.activateSelectionMode();
        applySnapshotToEditor(nextSnapshot);
        renderAll(nextSnapshot);
    });

    dom.btnDockFavoriteToggle?.addEventListener('click', () => {
        const nextSnapshot = toolDockState.toggleFavorite();
        applySnapshotToEditor(nextSnapshot);
        renderAll(nextSnapshot);
    });

    document.addEventListener('keydown', (event) => {
        if (event.target instanceof HTMLElement) {
            const tagName = event.target.tagName.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || event.target.isContentEditable) {
                return;
            }
        }
        if (event.key !== 'Escape') return;
        if (editor.currentTool === 'select') return;
        hoveredEntryId = null;
        const nextSnapshot = toolDockState.activateSelectionMode();
        applySnapshotToEditor(nextSnapshot);
        renderAll(nextSnapshot);
    });

    [
        ['spawn', dom.selSpawnType],
        ['tunnel', dom.selTunnelType],
        ['portal', dom.selPortalType],
        ['item', dom.selItemType],
        ['aircraft', dom.selAircraftType]
    ].forEach(([tool, select]) => {
        select?.addEventListener('change', () => {
            const entry = findEditorBuildEntryByToolAndSubtype(tool, select.value);
            if (!entry) return;
            hoveredEntryId = null;
            const nextSnapshot = toolDockState.activateEntry(entry.id, { recordRecent: false });
            applySnapshotToEditor(nextSnapshot);
            renderAll(nextSnapshot);
        });
    });

    enableHorizontalWheelScroll(dom.dockCards);
    enableHorizontalWheelScroll(dom.dockRecentList);
    enableHorizontalWheelScroll(dom.dockFavoriteList);

    const initialSnapshot = toolDockState.getSnapshot();
    applySnapshotToEditor(initialSnapshot);
    renderAll(initialSnapshot);
}
