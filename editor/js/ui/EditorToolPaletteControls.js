import {
    findEditorBuildEntryById,
    findEditorBuildEntryByToolAndSubtype,
    getEditorBuildCategories,
    getEditorBuildEntriesForCategory,
    listEditorBuildDescriptorEntries,
    resolveEditorBuildEntryAssetId,
} from './EditorBuildCatalog.js';
import { createEditorToolDockState } from './EditorToolDockState.js';

function resolveEntryAssetState(editor, entry) {
    const assetId = resolveEditorBuildEntryAssetId(entry);
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

    if (status.state === 'idle') {
        return {
            state: 'idle',
            label: 'Bereit',
            detail: 'Asset wird bei der ersten Platzierung geladen.'
        };
    }

    if (status.state === 'loading') {
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
    button.setAttribute('aria-label', `${entry.label}. ${entry.description}. ${assetState.label}.`);

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
            ${options.previewUrl ? `<img src="${options.previewUrl}" alt="" loading="lazy" />` : `<span class="buildCardPreviewGlyph">${entry.previewGlyph}</span>`}
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

function updateEntryButtonPreview(button, entry, previewUrl, assetState) {
    if (!button || !previewUrl) return;
    const preview = button.querySelector('.buildCardPreview');
    if (preview) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = '';
        image.loading = 'lazy';
        preview.replaceChildren(image);
    }
    button.dataset.assetState = assetState.state;
    button.title = `${entry.label}: ${entry.description} ${assetState.detail}`;
    button.setAttribute('aria-label', `${entry.label}. ${entry.description}. ${assetState.label}.`);
    const stateLabel = button.querySelector('.buildCardState');
    if (stateLabel) {
        stateLabel.className = `buildCardState state-${assetState.state}`;
        stateLabel.textContent = assetState.label;
    }
    const stateDetail = button.querySelector('.buildCardStateDetail');
    if (stateDetail) stateDetail.textContent = assetState.detail;
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
        ? `Letzte Baukarte: ${activeEntry?.label || 'keine'}. Rechts eine Karte anklicken und dann in die Szene klicken.`
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
    let catalogQuery = '';
    let assetFilter = '';
    const previewLoads = new Map();

    const requestEntryPreview = (button, entry) => {
        if (entry.tool !== 'glb' || editor.getBuildPreviewUrl?.(entry.id)) return;
        let pending = previewLoads.get(entry.id);
        if (!pending && typeof editor.loadBuildPreview === 'function') {
            pending = Promise.resolve(editor.loadBuildPreview(entry));
            previewLoads.set(entry.id, pending);
        }
        pending?.then((previewUrl) => {
            if (!previewUrl) return;
            editor.buildPreviewCache?.set(entry.id, previewUrl);
            const currentButton = button.isConnected
                ? button
                : Array.from(dom.dockCards?.querySelectorAll('[data-entry-id]') || [])
                    .find((candidate) => candidate.dataset.entryId === entry.id);
            updateEntryButtonPreview(currentButton, entry, previewUrl, resolveEntryAssetState(editor, entry));
        }).catch((error) => {
            console.warn(`[EditorToolPaletteControls] Preview for "${entry.id}" failed:`, error);
        });
    };

    const previewObserver = typeof IntersectionObserver === 'function' && dom.dockCards
        ? new IntersectionObserver((records) => {
            for (const record of records) {
                if (!record.isIntersecting) continue;
                previewObserver.unobserve(record.target);
                const entry = findEditorBuildEntryById(record.target.dataset.entryId);
                if (entry) requestEntryPreview(record.target, entry);
            }
        }, { root: dom.dockCards, rootMargin: '120px 0px' })
        : null;

    const matchesCatalogFilter = (entry) => {
        const assetState = resolveEntryAssetState(editor, entry);
        if (assetFilter === 'builtin' && assetState.state !== 'builtin') return false;
        if (assetFilter === 'loaded' && assetState.state !== 'loaded') return false;
        if (assetFilter === 'problem' && !['timeout', 'error', 'placeholder'].includes(assetState.state)) return false;
        if (!catalogQuery) return true;
        const haystack = [
            entry.label,
            entry.description,
            entry.badge,
            entry.tool,
            entry.subType,
            ...(Array.isArray(entry.keywords) ? entry.keywords : [])
        ].join(' ').toLocaleLowerCase('de');
        return haystack.includes(catalogQuery);
    };

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
        editor.core.container.dataset.activeTool = nextTool;
        editor.core.container.style.cursor = nextTool === 'select' ? 'default' : 'crosshair';

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
                applySnapshotToEditor(nextSnapshot);
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

        const sourceEntries = catalogQuery
            ? listEditorBuildDescriptorEntries()
            : getEditorBuildEntriesForCategory(snapshot.currentCategoryId);
        const entries = sourceEntries.filter(matchesCatalogFilter);

        if (entries.length === 0) {
            const emptyState = document.createElement('span');
            emptyState.className = 'dockShortcutEmpty';
            emptyState.textContent = 'Keine passenden Baukarten.';
            dom.dockCards.appendChild(emptyState);
            return;
        }

        for (const entry of entries) {
            const button = createEntryButton(entry, {
                isActive: snapshot.mode === 'place' && snapshot.selectedEntry?.id === entry.id,
                isSelected: snapshot.selectedEntry?.id === entry.id,
                assetState: resolveEntryAssetState(editor, entry),
                previewUrl: editor.getBuildPreviewUrl?.(entry.id) || '',
            });
            button.addEventListener('click', () => {
                hoveredEntryId = null;
                const nextSnapshot = toolDockState.activateEntry(entry.id);
                applySnapshotToEditor(nextSnapshot, { clearSelection: true });
                renderAll(nextSnapshot);
            });
            button.addEventListener('mouseenter', () => {
                requestEntryPreview(button, entry);
                hoveredEntryId = entry.id;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('mouseleave', () => {
                if (hoveredEntryId !== entry.id) return;
                hoveredEntryId = null;
                updateSummaryViews(dom, buildSnapshotView(snapshot));
            });
            button.addEventListener('focus', () => {
                requestEntryPreview(button, entry);
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
            if (entry.tool === 'glb' && !editor.getBuildPreviewUrl?.(entry.id)) {
                previewObserver?.observe(button);
            }
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
    editor.setBuildPreviewCache = (cache) => {
        editor.buildPreviewCache = cache instanceof Map ? cache : new Map();
        renderAll(toolDockState.getSnapshot());
    };
    editor.setBuildPreviewLoader = (loader) => {
        editor.loadBuildPreview = typeof loader === 'function' ? loader : null;
    };
    editor.getBuildPreviewUrl = (entryId) => editor.buildPreviewCache?.get(entryId) || '';

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

    dom.dockSearch?.addEventListener('input', () => {
        catalogQuery = String(dom.dockSearch.value || '').trim().toLocaleLowerCase('de');
        renderAll(toolDockState.getSnapshot());
    });

    dom.dockAssetFilter?.addEventListener('change', () => {
        assetFilter = String(dom.dockAssetFilter.value || '');
        renderAll(toolDockState.getSnapshot());
    });

    document.addEventListener('keydown', (event) => {
        if (editor.dom?.editorModalBackdrop?.classList.contains('is-open')) return;
        if (event.target instanceof HTMLElement) {
            const tagName = event.target.tagName.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || event.target.isContentEditable) {
                return;
            }
        }
        if (event.key !== 'Escape') return;
        if (editor.isDrawing) {
            event.preventDefault();
            editor.cancelActiveDrawing?.();
        }
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
