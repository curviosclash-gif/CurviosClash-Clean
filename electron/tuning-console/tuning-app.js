import { renderParameterList, renderTabs } from './tuning-renderer.js';
import { createTuningPresetUi } from './tuning-preset-ui.js';
import { TuningPresetManager } from '../../src/dev/tuning/TuningPresetManager.js';

const tuningApi = globalThis.tuningApi;

const dom = {
    capabilityMessage: document.getElementById('capability-message'),
    changedCount: document.getElementById('changed-count'),
    searchInput: document.getElementById('search-input'),
    tabs: document.getElementById('tabs'),
    parameterList: document.getElementById('parameter-list'),
    statusLine: document.getElementById('status-line'),
    botProfileWrap: document.getElementById('bot-profile-wrap'),
    botProfileSelect: document.getElementById('bot-profile-select'),
    presetSelect: document.getElementById('preset-select'),
    presetNameInput: document.getElementById('preset-name-input'),
    presetSaveButton: document.getElementById('preset-save-btn'),
    presetLoadButton: document.getElementById('preset-load-btn'),
    presetExportButton: document.getElementById('preset-export-btn'),
    presetImportButton: document.getElementById('preset-import-btn'),
    resetAllButton: document.getElementById('reset-all-btn'),
};

const state = {
    registry: null,
    descriptors: [],
    sectionEntries: [],
    activeSection: '',
    botProfile: 'NORMAL',
    searchTerm: '',
    valuesByPath: {},
    defaultsByPath: {},
    presetManager: new TuningPresetManager(),
    presetUi: null,
    unsubscribeUpdate: null,
};

function setStatus(message, tone = 'info') {
    if (!dom.statusLine) return;
    dom.statusLine.textContent = String(message || '');
    dom.statusLine.classList.remove('muted');
    if (tone === 'error') {
        dom.statusLine.style.color = '#ff9f9f';
        return;
    }
    if (tone === 'success') {
        dom.statusLine.style.color = '#9df3d4';
        return;
    }
    dom.statusLine.style.color = '';
    dom.statusLine.classList.add('muted');
}

function setCapabilityMessage(message, tone = 'muted') {
    if (!dom.capabilityMessage) return;
    dom.capabilityMessage.textContent = String(message || '');
    dom.capabilityMessage.classList.remove('muted');
    if (tone === 'error') {
        dom.capabilityMessage.style.color = '#ff9f9f';
        return;
    }
    dom.capabilityMessage.style.color = '';
    dom.capabilityMessage.classList.add('muted');
}

function resolveResultPayload(result) {
    if (!result || typeof result !== 'object') {
        return {
            ok: false,
            reason: 'invalid_result',
            value: null,
        };
    }
    return {
        ok: result.ok === true,
        reason: String(result.reason || (result.ok === true ? 'ok' : 'runtime_error')),
        detail: String(result.detail || ''),
        value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : null,
        capability: result.capability && typeof result.capability === 'object' ? result.capability : null,
    };
}

function computeSectionEntries(registry) {
    const sections = registry?.sections && typeof registry.sections === 'object'
        ? registry.sections
        : {};
    const counts = new Map();
    state.descriptors.forEach((descriptor) => {
        const section = String(descriptor.section || '').trim().toUpperCase();
        counts.set(section, (counts.get(section) || 0) + 1);
    });
    return Object.entries(sections)
        .map(([section, label]) => ({
            section,
            label: `${label} (${counts.get(section) || 0})`,
        }))
        .filter((entry) => (counts.get(entry.section) || 0) > 0);
}

function updateChangedCount() {
    if (!dom.changedCount) return;
    const changedCount = state.presetManager.getChangedCount(state.valuesByPath, state.defaultsByPath);
    dom.changedCount.textContent = `${changedCount} geaendert`;
}

function filterDescriptors() {
    const search = state.searchTerm.trim().toLowerCase();
    return state.descriptors.filter((descriptor) => {
        if (descriptor.section !== state.activeSection) {
            return false;
        }
        if (state.activeSection === 'BOT') {
            const profilePrefix = `BOT.DIFFICULTY_PROFILES.${state.botProfile}.`;
            const isProfileParameter = descriptor.path.startsWith('BOT.DIFFICULTY_PROFILES.');
            if (isProfileParameter && !descriptor.path.startsWith(profilePrefix)) {
                return false;
            }
        }
        if (!search) {
            return true;
        }
        const haystack = `${descriptor.path} ${descriptor.label}`.toLowerCase();
        return haystack.includes(search);
    });
}

function renderUi() {
    renderTabs({
        container: dom.tabs,
        sectionEntries: state.sectionEntries,
        activeSection: state.activeSection,
        onSectionSelected: (section) => {
            state.activeSection = section;
            renderUi();
        },
    });

    const botSectionActive = state.activeSection === 'BOT';
    dom.botProfileWrap?.classList.toggle('hidden', !botSectionActive);
    if (dom.botProfileSelect && dom.botProfileSelect.value !== state.botProfile) {
        dom.botProfileSelect.value = state.botProfile;
    }

    renderParameterList({
        container: dom.parameterList,
        descriptors: filterDescriptors(),
        valuesByPath: state.valuesByPath,
        defaultsByPath: state.defaultsByPath,
        onValueChange: (path, value) => {
            void handleSetValue(path, value);
        },
        onResetParameter: (path) => {
            void handleResetParameter(path);
        },
    });
    updateChangedCount();
}

async function reloadRuntimeValues() {
    const allResult = resolveResultPayload(await tuningApi.getAll());
    if (!allResult.ok || !allResult.value || typeof allResult.value !== 'object') {
        setStatus(`Runtime-Werte konnten nicht geladen werden: ${allResult.reason}`, 'error');
        return false;
    }
    state.valuesByPath = { ...allResult.value };
    renderUi();
    return true;
}

async function handleSetValue(path, value) {
    const result = resolveResultPayload(await tuningApi.setValue(path, value));
    if (!result.ok || !result.value || result.value.ok !== true) {
        setStatus(`Set fehlgeschlagen (${result.reason})`, 'error');
        return;
    }
    state.valuesByPath[path] = result.value.value;
    renderUi();
    setStatus(`Aktualisiert: ${path}`, 'success');
}

async function handleResetParameter(path) {
    const defaultValue = state.defaultsByPath[path];
    await handleSetValue(path, defaultValue);
}

async function handleCapabilityStatus() {
    const result = await tuningApi.getCapability();
    if (!result || result.ok !== true || !result.capability) {
        setCapabilityMessage('Capability-Status nicht verfuegbar.', 'error');
        return;
    }
    if (result.capability.available !== true) {
        setCapabilityMessage(result.capability.message || 'Tuning Console ist blockiert.', 'error');
        return;
    }
    setCapabilityMessage(result.capability.message || 'Desktop-Capability aktiv.', 'muted');
}

function mapDefaultsByPath(descriptors) {
    const defaults = {};
    descriptors.forEach((descriptor) => {
        defaults[descriptor.path] = descriptor.defaultValue;
    });
    return defaults;
}

function setupUiBindings() {
    dom.searchInput?.addEventListener('input', () => {
        state.searchTerm = String(dom.searchInput.value || '');
        renderUi();
    });
    dom.botProfileSelect?.addEventListener('change', () => {
        state.botProfile = String(dom.botProfileSelect.value || 'NORMAL').trim().toUpperCase() || 'NORMAL';
        renderUi();
    });
}

function setupPresetUi() {
    state.presetUi = createTuningPresetUi({
        tuningApi,
        presetManager: state.presetManager,
        elements: {
            presetSelect: dom.presetSelect,
            presetNameInput: dom.presetNameInput,
            presetSaveButton: dom.presetSaveButton,
            presetLoadButton: dom.presetLoadButton,
            presetExportButton: dom.presetExportButton,
            presetImportButton: dom.presetImportButton,
            resetAllButton: dom.resetAllButton,
        },
        getValues: () => ({ ...state.valuesByPath }),
        getDefaults: () => ({ ...state.defaultsByPath }),
        setStatus: (message) => setStatus(message, 'info'),
        reloadRuntimeValues,
        updateChangedCount,
    });
}

function setupRuntimeUpdateSubscription() {
    state.unsubscribeUpdate = tuningApi.onUpdate((eventPayload) => {
        const snapshot = resolveResultPayload(eventPayload?.snapshot);
        if (!snapshot.ok || !snapshot.value || typeof snapshot.value !== 'object') {
            return;
        }
        state.valuesByPath = { ...snapshot.value };
        renderUi();
    });
}

async function bootstrap() {
    if (!tuningApi || typeof tuningApi.getRegistry !== 'function') {
        setCapabilityMessage('tuningApi wurde nicht im Preload gefunden.', 'error');
        setStatus('IPC-Bridge fehlt.', 'error');
        return;
    }

    await handleCapabilityStatus();
    setupUiBindings();

    const registryResult = resolveResultPayload(await tuningApi.getRegistry());
    if (!registryResult.ok || !registryResult.value || typeof registryResult.value !== 'object') {
        setStatus(`Registry konnte nicht geladen werden: ${registryResult.reason}`, 'error');
        return;
    }
    state.registry = registryResult.value;
    state.descriptors = Array.isArray(state.registry.parameters) ? state.registry.parameters.slice() : [];
    state.defaultsByPath = mapDefaultsByPath(state.descriptors);
    state.sectionEntries = computeSectionEntries(state.registry);
    state.activeSection = state.sectionEntries[0]?.section || '';

    const loaded = await reloadRuntimeValues();
    if (!loaded) {
        return;
    }

    setupPresetUi();
    setupRuntimeUpdateSubscription();
    renderUi();
    setStatus('Tuning Console bereit.', 'success');
}

void bootstrap();
