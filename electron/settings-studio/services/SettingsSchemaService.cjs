const path = require('node:path');
const { pathToFileURL } = require('node:url');

let cachedContractModulePromise = null;
let cachedMenuEditorModulePromise = null;

function loadContractModule() {
    if (cachedContractModulePromise) {
        return cachedContractModulePromise;
    }

    const contractModuleUrl = pathToFileURL(
        path.resolve(__dirname, '..', '..', '..', 'src', 'core', 'settings', 'SettingsOverrideContract.js')
    ).href;

    cachedContractModulePromise = import(contractModuleUrl);
    return cachedContractModulePromise;
}

function loadMenuEditorModule() {
    if (!cachedMenuEditorModulePromise) {
        cachedMenuEditorModulePromise = import(pathToFileURL(
            path.resolve(__dirname, '..', '..', '..', 'src', 'ui', 'menu', 'MenuEditorModel.js')
        ).href);
    }
    return cachedMenuEditorModulePromise;
}

async function getSchemaDescriptor() {
    const contractModule = await loadContractModule();
    return contractModule.createSettingsStudioSchemaDescriptor();
}

async function createDraft() {
    const contractModule = await loadContractModule();
    return contractModule.createSettingsOverrideDraft();
}

async function validateDraft(draft) {
    const contractModule = await loadContractModule();
    return contractModule.validateSettingsOverrideDraft(draft);
}

async function classifyMigration(draft) {
    const contractModule = await loadContractModule();
    const migration = contractModule.classifyOverrideDraftMigration(draft);
    const migrated = contractModule.migrateOverrideDraft(draft, migration);
    return { ...migration, migrated };
}

async function createMenuEditorModel(draft, textOverrides = {}) {
    const [contractModule, menuEditorModule] = await Promise.all([
        loadContractModule(),
        loadMenuEditorModule(),
    ]);
    return menuEditorModule.createMenuEditorModel({
        draft,
        textOverrides,
        fields: contractModule.createSettingsOverrideFieldRegistry(),
    });
}

module.exports = {
    createDraft,
    getSchemaDescriptor,
    validateDraft,
    classifyMigration,
    createMenuEditorModel,
};
