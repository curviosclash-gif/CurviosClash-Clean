import {
    MENU_DEFAULT_EDITOR_SCHEMA_VERSION,
    createMenuDefaultsEditorConfigSnapshot,
    getSettingsFieldDescriptorForOverridePath,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { SETTINGS_LIMITS, clampSettingValue } from '../../shared/contracts/SettingsRuntimeContract.js';
import { BOT_HEURISTIC_FIELD_HELP_METADATA, BOT_HEURISTIC_FIELD_LIMITS } from './BotHeuristicSettingsStudioContract.js';
import {
    collectPrimitiveLeafPaths,
    deepCloneJson,
    deepMergeKnownShape,
    isPlainObject,
    readPathValue,
    writePathValue,
} from './SettingsOverrideMergeOps.js';
import { dropRetiredOverridePaths } from './SettingsOverrideRetiredPaths.js';
import {
    normalizeLimitOverrides,
    resolveEffectiveLimits,
    validateLimitRule,
} from './SettingsOverrideRangeContract.js';

export const SETTINGS_OVERRIDE_SCHEMA_VERSION = 'menu-defaults-override.v4';
export const LEGACY_SETTINGS_OVERRIDE_SCHEMA_VERSION = 'menu-defaults-override.v1';
export const SETTINGS_STUDIO_SCHEMA_CONTRACT_VERSION = 'settings-studio-schema.v1';

/** Older drafts that migrate forward; only fields the product no longer has are dropped. */
const UPGRADABLE_SCHEMA_VERSIONS = new Set([
    LEGACY_SETTINGS_OVERRIDE_SCHEMA_VERSION,
    'menu-defaults-override.v2',
    'menu-defaults-override.v3',
]);

/**
 * v3 gave hunt.deathmatchKillLimit a limit rule. Drafts saved before that could hold any
 * number, so the migration pulls the stored value into the rule instead of letting the
 * validation reject it - a single invalid field skips the whole override.
 */
const MIGRATED_KILL_LIMIT_PATH = 'baseSettings.hunt.deathmatchKillLimit';

export const SCHEMA_MIGRATION_CODES = Object.freeze({
    CURRENT: 'SCHEMA_VERSION_CURRENT',
    UPGRADE: 'SCHEMA_VERSION_UPGRADE',
    FALLBACK: 'SCHEMA_VERSION_UNKNOWN',
    REJECT: 'SCHEMA_VERSION_CORRUPT',
});

const DEFAULT_LANGUAGE = 'de';
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);

const FIELD_HELP_METADATA = Object.freeze({
    ...BOT_HEURISTIC_FIELD_HELP_METADATA,
    'baseSettings.gameplay.trailLength': Object.freeze({ riskLevel: 'medium', unit: 'segments', example: '5000', help: { de: 'Maximale Segmentanzahl der Kursspur.', en: 'Maximum segment count of each flight trail.' }, impact: { de: 'Höhere Werte verlängern die Spur, erhöhen aber Speicher-, GPU- und Kollisionskosten.', en: 'Higher values make trails longer, but increase memory, GPU, and collision cost.' } }),
    'baseSettings.numBots': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Anzahl der KI-Gegner pro Match.', en: 'Number of AI opponents per match.' }, impact: { de: 'Mehr Bots erzeugen mehr Spielaktion, erhöhen aber den Rechenaufwand.', en: 'More bots create more action, but increase CPU load.' } }),
    'baseSettings.winsNeeded': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Rundensiege, die zum Matchgewinn benötigt werden.', en: 'Round wins needed to win the match.' }, impact: { de: 'Bestimmt die Matchlänge direkt.', en: 'Directly determines match length.' } }),
    'baseSettings.gameplay.speed': Object.freeze({ riskLevel: 'medium', unit: null, example: '21', help: { de: 'Grundgeschwindigkeit der Flugzeuge.', en: 'Base flight speed of the planes.' }, impact: { de: 'Beeinflusst Schwierigkeit und Reaktionszeit stark. Extreme Werte können das Spiel unspielbar machen.', en: 'Strongly affects difficulty and reaction time. Extreme values may make the game unplayable.' } }),
    'baseSettings.gameplay.turnSensitivity': Object.freeze({ riskLevel: 'medium', unit: null, example: '2.4', help: { de: 'Lenkempfindlichkeit der Flugzeuge.', en: 'Steering sensitivity of the planes.' }, impact: { de: 'Höhere Werte erlauben engere Kurven. Zu hohe Werte machen die Steuerung unbeherrschbar.', en: 'Higher values allow tighter turns. Too high makes control unpredictable.' } }),
    'baseSettings.gameplay.planeScale': Object.freeze({ riskLevel: 'low', unit: null, example: '1.0', help: { de: 'Skalierung der Flugzeug-Modelle.', en: 'Scale of the plane models.' }, impact: { de: 'Rein visuell; beeinflusst keine Spielmechanik.', en: 'Visual only; does not affect gameplay mechanics.' } }),
    'baseSettings.gameplay.trailWidth': Object.freeze({ riskLevel: 'low', unit: null, example: '0.15', help: { de: 'Breite der Kursspur jedes Flugzeugs.', en: "Width of each plane's flight trail." }, impact: { de: 'Breitere Spuren erhöhen die Kollisionswahrscheinlichkeit.', en: 'Wider trails increase collision probability.' } }),
    'baseSettings.gameplay.gapSize': Object.freeze({ riskLevel: 'medium', unit: null, example: '0.5', help: { de: 'Größe der Lücken in der Flugspur.', en: 'Size of gaps in the flight trail.' }, impact: { de: 'Größere Lücken erlauben Durchschlüpfen durch die eigene Spur.', en: 'Larger gaps allow passing through own trail.' } }),
    'baseSettings.gameplay.gapFrequency': Object.freeze({ riskLevel: 'low', unit: null, example: '0.05', help: { de: 'Häufigkeit der Lücken in der Flugspur.', en: 'Frequency of gaps in the flight trail.' }, impact: { de: 'Höhere Werte erzeugen mehr Lücken pro Zeiteinheit.', en: 'Higher values produce more gaps per time unit.' } }),
    'baseSettings.gameplay.itemAmount': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Item-Menge auf der Standard-Arena. Anzahl und Nachfüllrate skalieren mit der Map-Größe (3D: Volumen, 2D: Grundfläche), bis maximal 100 Items.', en: 'Item amount on the standard arena. Count and refill rate scale with map size (3D: volume, 2D: floor area), up to 100 items.' }, impact: { de: 'Mehr Items = häufigere Power-up-Gelegenheiten.', en: 'More items = more frequent power-up opportunities.' } }),
    'baseSettings.gameplay.fireRate': Object.freeze({ riskLevel: 'medium', unit: null, example: '0.15', help: { de: 'Schussrate der Bordkanone (Schüsse/s).', en: 'Machine gun fire rate (shots/s).' }, impact: { de: 'Höhere Werte ermöglichen schnelleres Schießen; beeinflusst Kampfbalance.', en: 'Higher values allow faster shooting; affects combat balance.' } }),
    'baseSettings.gameplay.lockOnAngle': Object.freeze({ riskLevel: 'low', unit: '°', example: '30', help: { de: 'Winkelbereich für automatisches Zielen.', en: 'Angle range for automatic lock-on targeting.' }, impact: { de: 'Größerer Winkel erleichtert das Zielen erheblich.', en: 'Larger angle makes aiming significantly easier.' } }),
    'baseSettings.gameplay.nextCheckpointGlowIntensity': Object.freeze({ riskLevel: 'low', unit: null, example: '1.35', help: { de: 'Leuchtstärke für den nächsten Parcours-Checkpoint-Ring.', en: 'Glow strength for the next parcours checkpoint ring.' }, impact: { de: 'Höhere Werte machen den nächsten Ring deutlicher sichtbar.', en: 'Higher values make the next ring more visually prominent.' } }),
    'baseSettings.gameplay.mgTrailAimRadius': Object.freeze({ riskLevel: 'low', unit: null, example: '0.15', help: { de: 'Trefferradius der Bordkanone auf der Spur.', en: 'Machine gun hit radius on the trail.' }, impact: { de: 'Größerer Radius = treffsicherer, aber ggf. weniger präzises Gefühl.', en: 'Larger radius = more accurate, but potentially less precise feel.' } }),
    'baseSettings.gameplay.fightPlayerHp': Object.freeze({ riskLevel: 'medium', unit: null, example: '100', help: { de: 'Trefferpunkte der Spieler im Kampfmodus.', en: 'Player hit points in fight mode.' }, impact: { de: 'Niedrigere Werte = kürzere Kämpfe. Sehr hohe Werte verlängern Matches stark.', en: 'Lower values = shorter fights. Very high values extend matches significantly.' } }),
    'baseSettings.gameplay.fightMgDamage': Object.freeze({ riskLevel: 'medium', unit: null, example: '10', help: { de: 'Schaden pro Bordkanonen-Treffer im Kampfmodus.', en: 'Damage per machine gun hit in fight mode.' }, impact: { de: 'Zusammen mit HP bestimmt dies die Kampfdauer. Nicht isoliert anpassen.', en: 'Together with HP determines fight duration. Do not adjust in isolation.' } }),
    'baseSettings.gameplay.planarLevelCount': Object.freeze({ riskLevel: 'low', unit: null, example: '5', help: { de: 'Anzahl der Ebenen im planaren Modus.', en: 'Number of levels in planar mode.' }, impact: { de: 'Bestimmt die Arena-Größe im Planar-Modus.', en: 'Determines arena size in planar mode.' } }),
    'baseSettings.botBridge.timeoutMs': Object.freeze({ riskLevel: 'high', unit: 'ms', example: '1000', help: { de: 'Zeitlimit für KI-Entscheidungen in ms.', en: 'Timeout for AI decisions in ms.' }, impact: { de: 'Zu kurz: Bots fallen aus. Zu lang: blockiert den Spielablauf. Sorgfältig anpassen.', en: 'Too short: bots fail. Too long: blocks game flow. Adjust carefully.' } }),
    'baseSettings.botBridge.maxRetries': Object.freeze({ riskLevel: 'medium', unit: null, example: '3', help: { de: 'Maximale Bot-Verbindungswiederholungen bei Fehlern.', en: 'Maximum bot connection retries on failure.' }, impact: { de: 'Mehr Versuche = robusterer Bot, aber langsamerer Fehlerrecovery.', en: 'More retries = more robust bot, but slower error recovery.' } }),
    'baseSettings.botBridge.retryDelayMs': Object.freeze({ riskLevel: 'medium', unit: 'ms', example: '200', help: { de: 'Wartezeit zwischen Bot-Verbindungsversuchen.', en: 'Delay between bot connection retry attempts.' }, impact: { de: 'Längere Delays reduzieren Last, erhöhen aber Reaktionszeit.', en: 'Longer delays reduce load but increase response time.' } }),
});

function resolveFieldHelpMetadata(path) {
    if (FIELD_HELP_METADATA[path]) return FIELD_HELP_METADATA[path];
    if (String(path || '').startsWith('configShare.')) {
        const mirror = path.replace(/^configShare\./, 'baseSettings.');
        if (FIELD_HELP_METADATA[mirror]) return FIELD_HELP_METADATA[mirror];
    }
    return Object.freeze({ label: null, riskLevel: 'low', unit: null, example: null, help: null, impact: null });
}

const SECTION_DEFINITIONS = Object.freeze([
    { key: 'baseSettings', category: 'base' },
    { key: 'localSettings', category: 'local' },
    { key: 'level3Reset', category: 'level3' },
    { key: 'configShare', category: 'configShare' },
    { key: 'fixedPresets', category: 'presets' },
]);

const DEFAULT_FIELD_LIMITS = Object.freeze({
    ...BOT_HEURISTIC_FIELD_LIMITS,
    'baseSettings.gameplay.trailLength': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailLength, step: 100 }),
    'configShare.gameplay.trailLength': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailLength, step: 100 }),
    'baseSettings.numBots': Object.freeze({ ...SETTINGS_LIMITS.session.numBots, step: 1 }),
    'baseSettings.winsNeeded': Object.freeze({ ...SETTINGS_LIMITS.session.winsNeeded, step: 1 }),
    'baseSettings.hunt.deathmatchKillLimit': Object.freeze({ ...SETTINGS_LIMITS.hunt.deathmatchKillLimit, step: 1 }),
    'baseSettings.gameplay.speed': Object.freeze({ min: 0, max: 50, step: 0.1 }),
    'baseSettings.gameplay.turnSensitivity': Object.freeze({ ...SETTINGS_LIMITS.gameplay.turnSensitivity, step: 0.1 }),
    'baseSettings.gameplay.planeScale': Object.freeze({ ...SETTINGS_LIMITS.gameplay.planeScale, step: 0.05 }),
    'baseSettings.gameplay.trailWidth': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailWidth, step: 0.05 }),
    'baseSettings.gameplay.gapSize': Object.freeze({ ...SETTINGS_LIMITS.gameplay.gapSize, step: 0.01 }),
    'baseSettings.gameplay.gapFrequency': Object.freeze({ ...SETTINGS_LIMITS.gameplay.gapFrequency, step: 0.01 }),
    'baseSettings.gameplay.itemAmount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.itemAmount, step: 1 }),
    'baseSettings.gameplay.fireRate': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fireRate, step: 0.01 }),
    'baseSettings.gameplay.lockOnAngle': Object.freeze({ ...SETTINGS_LIMITS.gameplay.lockOnAngle, step: 1 }),
    'baseSettings.gameplay.nextCheckpointGlowIntensity': Object.freeze({ ...SETTINGS_LIMITS.gameplay.nextCheckpointGlowIntensity, step: 0.05 }),
    'baseSettings.gameplay.mgTrailAimRadius': Object.freeze({ ...SETTINGS_LIMITS.gameplay.mgTrailAimRadius, step: 0.01 }),
    'baseSettings.gameplay.fightPlayerHp': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fightPlayerHp, step: 1 }),
    'baseSettings.gameplay.fightMgDamage': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fightMgDamage, step: 0.25 }),
    'baseSettings.gameplay.planarLevelCount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.planarLevelCount, step: 1 }),
    'baseSettings.cameraPerspective.speedFovIntensity': Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
    'baseSettings.cameraPerspective.thrusterExhaustIntensity': Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
    'baseSettings.botBridge.timeoutMs': Object.freeze({ ...SETTINGS_LIMITS.botBridge.timeoutMs, step: 1 }),
    'baseSettings.botBridge.maxRetries': Object.freeze({ ...SETTINGS_LIMITS.botBridge.maxRetries, step: 1 }),
    'baseSettings.botBridge.retryDelayMs': Object.freeze({ ...SETTINGS_LIMITS.botBridge.retryDelayMs, step: 1 }),
    'configShare.numBots': Object.freeze({ ...SETTINGS_LIMITS.session.numBots, step: 1 }),
    'configShare.winsNeeded': Object.freeze({ ...SETTINGS_LIMITS.session.winsNeeded, step: 1 }),
    'configShare.gameplay.speed': Object.freeze({ min: 0, max: 50, step: 0.1 }),
    'configShare.gameplay.turnSensitivity': Object.freeze({ ...SETTINGS_LIMITS.gameplay.turnSensitivity, step: 0.1 }),
    'configShare.gameplay.planeScale': Object.freeze({ ...SETTINGS_LIMITS.gameplay.planeScale, step: 0.05 }),
    'configShare.gameplay.trailWidth': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailWidth, step: 0.05 }),
    'configShare.gameplay.gapSize': Object.freeze({ ...SETTINGS_LIMITS.gameplay.gapSize, step: 0.01 }),
    'configShare.gameplay.gapFrequency': Object.freeze({ ...SETTINGS_LIMITS.gameplay.gapFrequency, step: 0.01 }),
    'configShare.gameplay.itemAmount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.itemAmount, step: 1 }),
    'configShare.gameplay.fireRate': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fireRate, step: 0.01 }),
    'configShare.gameplay.lockOnAngle': Object.freeze({ ...SETTINGS_LIMITS.gameplay.lockOnAngle, step: 1 }),
    'configShare.gameplay.nextCheckpointGlowIntensity': Object.freeze({ ...SETTINGS_LIMITS.gameplay.nextCheckpointGlowIntensity, step: 0.05 }),
    'configShare.gameplay.mgTrailAimRadius': Object.freeze({ ...SETTINGS_LIMITS.gameplay.mgTrailAimRadius, step: 0.01 }),
    'configShare.gameplay.fightPlayerHp': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fightPlayerHp, step: 1 }),
    'configShare.gameplay.fightMgDamage': Object.freeze({ ...SETTINGS_LIMITS.gameplay.fightMgDamage, step: 0.25 }),
    'configShare.gameplay.planarLevelCount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.planarLevelCount, step: 1 }),
    'configShare.cameraPerspective.speedFovIntensity': Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
    'configShare.cameraPerspective.thrusterExhaustIntensity': Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
});

function createError(path, code, message) {
    return Object.freeze({ path, code, message });
}

function toFiniteNumber(value, fallback = null) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
}

function inferFieldType(value) {
    if (Array.isArray(value)) return 'json';
    const type = typeof value;
    if (type === 'number') return 'number';
    if (type === 'boolean') return 'boolean';
    if (type === 'string') return 'string';
    return 'json';
}

function resolveFieldCategory(path, fallbackCategory) {
    const normalized = String(path || '').trim();
    if (!normalized) return fallbackCategory;
    if (normalized.includes('.gameplay.')) return 'gameplay';
    if (normalized.includes('.botBridge.')) return 'botBridge';
    if (normalized.includes('.botHeuristicTuning.')) return 'botHeuristicTuning';
    if (normalized.includes('.hunt.')) return 'hunt';
    if (normalized.includes('.recording.')) return 'recording';
    if (normalized.includes('.cameraPerspective.')) return 'cameraPerspective';
    if (normalized.startsWith('fixedPresets')) return 'presets';
    return fallbackCategory;
}

function deriveSeedDefaultValue(path, draft) {
    const existingValue = readPathValue(draft, path);
    if (existingValue !== undefined) return existingValue;
    if (path.startsWith('configShare.gameplay.')) {
        const mirrorPath = path.replace(/^configShare\./, 'baseSettings.');
        const mirroredValue = readPathValue(draft, mirrorPath);
        if (mirroredValue !== undefined) return mirroredValue;
    }
    return 0;
}

function normalizeLanguage(language) {
    const normalized = String(language || DEFAULT_LANGUAGE).trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : DEFAULT_LANGUAGE;
}

export function createSettingsOverrideDraft() {
    const defaults = createMenuDefaultsEditorConfigSnapshot();
    return {
        schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION,
        sourceSchemaVersion: MENU_DEFAULT_EDITOR_SCHEMA_VERSION,
        language: DEFAULT_LANGUAGE,
        limitOverrides: {},
        baseSettings: deepCloneJson(defaults.baseSettings),
        localSettings: deepCloneJson(defaults.localSettings),
        level3Reset: deepCloneJson(defaults.level3Reset),
        configShare: deepCloneJson(defaults.configShare),
        fixedPresets: deepCloneJson(defaults.fixedPresets),
    };
}

export function createSettingsOverrideFieldRegistry() {
    const draft = createSettingsOverrideDraft();
    const entries = [];
    const pathSet = new Set();

    for (const section of SECTION_DEFINITIONS) {
        const sectionValue = draft[section.key];
        const paths = collectPrimitiveLeafPaths(sectionValue, section.key);
        for (const path of paths) {
            if (!path || pathSet.has(path)) continue;
            pathSet.add(path);
            const value = readPathValue(draft, path);
            const type = inferFieldType(value);
            const limits = type === 'number' && DEFAULT_FIELD_LIMITS[path]
                ? deepCloneJson(DEFAULT_FIELD_LIMITS[path])
                : null;
            const meta = resolveFieldHelpMetadata(path);
            const runtimeField = getSettingsFieldDescriptorForOverridePath(path);
            entries.push({
                path,
                section: section.key,
                category: resolveFieldCategory(path, section.category),
                type,
                labelKey: `settings.field.${path}`, label: meta.label, control: path.startsWith('baseSettings.botHeuristicTuning.') ? 'range' : null,
                defaultValue: deepCloneJson(value),
                limits,
                riskLevel: meta.riskLevel,
                unit: meta.unit,
                example: meta.example,
                help: meta.help,
                impact: meta.impact,
                options: deepCloneJson(runtimeField?.options || []),
            });
        }
    }

    for (const path of Object.keys(DEFAULT_FIELD_LIMITS)) {
        if (pathSet.has(path)) continue;
        pathSet.add(path);
        const meta = resolveFieldHelpMetadata(path);
        const runtimeField = getSettingsFieldDescriptorForOverridePath(path);
        entries.push({
            path,
            section: path.split('.')[0],
            category: resolveFieldCategory(path, 'gameplay'),
            type: 'number',
            labelKey: `settings.field.${path}`, label: meta.label, control: path.startsWith('baseSettings.botHeuristicTuning.') ? 'range' : null,
            defaultValue: deriveSeedDefaultValue(path, draft),
            limits: deepCloneJson(DEFAULT_FIELD_LIMITS[path]),
            riskLevel: meta.riskLevel,
            unit: meta.unit,
            example: meta.example,
            help: meta.help,
            impact: meta.impact,
            options: deepCloneJson(runtimeField?.options || []),
        });
    }

    return Object.freeze(entries.sort((left, right) => left.path.localeCompare(right.path)));
}

const FIELD_REGISTRY = createSettingsOverrideFieldRegistry();
const FIELD_REGISTRY_BY_PATH = new Map(FIELD_REGISTRY.map((entry) => [entry.path, entry]));

function mergeDraftCandidate(candidate) {
    const baseDraft = createSettingsOverrideDraft();
    const source = isPlainObject(candidate) ? candidate : {};
    const merged = deepCloneJson(baseDraft);

    merged.schemaVersion = typeof source.schemaVersion === 'string'
        ? source.schemaVersion.trim() || baseDraft.schemaVersion
        : baseDraft.schemaVersion;
    merged.sourceSchemaVersion = typeof source.sourceSchemaVersion === 'string'
        ? source.sourceSchemaVersion.trim() || baseDraft.sourceSchemaVersion
        : baseDraft.sourceSchemaVersion;
    merged.language = normalizeLanguage(source.language || baseDraft.language);

    for (const section of SECTION_DEFINITIONS) {
        const key = section.key;
        if (key === 'fixedPresets') {
            merged.fixedPresets = Array.isArray(source.fixedPresets)
                ? deepCloneJson(source.fixedPresets)
                : deepCloneJson(baseDraft.fixedPresets);
            continue;
        }
        merged[key] = deepMergeKnownShape(baseDraft[key], source[key]);
    }

    return merged;
}

function validateKnownDraftPaths(candidateDraft, errors) {
    if (!isPlainObject(candidateDraft)) {
        errors.push(createError('', 'DRAFT_TYPE_INVALID', 'Override-Draft muss ein Objekt sein.'));
        return;
    }
    const allowedRootKeys = new Set([
        'schemaVersion',
        'sourceSchemaVersion',
        'language',
        'limitOverrides',
        ...SECTION_DEFINITIONS.map((section) => section.key),
    ]);
    for (const key of Object.keys(candidateDraft)) {
        if (!allowedRootKeys.has(key)) {
            errors.push(createError(key, 'FIELD_PATH_UNKNOWN', `Unbekannter Settings-Pfad: ${key}.`));
        }
    }
    for (const section of SECTION_DEFINITIONS) {
        if (section.key === 'fixedPresets' || candidateDraft[section.key] === undefined) continue;
        for (const path of collectPrimitiveLeafPaths(candidateDraft[section.key], section.key)) {
            if (path === section.key && isPlainObject(candidateDraft[section.key])
                && !Object.keys(candidateDraft[section.key]).length) continue;
            if (!FIELD_REGISTRY_BY_PATH.has(path)) {
                errors.push(createError(path, 'FIELD_PATH_UNKNOWN', `Unbekannter Settings-Pfad: ${path}.`));
            }
        }
    }
}

export function createSettingsStudioSchemaDescriptor() {
    const fieldRegistry = createSettingsOverrideFieldRegistry();
    return {
        contractVersion: SETTINGS_STUDIO_SCHEMA_CONTRACT_VERSION,
        schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION,
        sections: deepCloneJson(SECTION_DEFINITIONS),
        fields: deepCloneJson(fieldRegistry),
        supportedLanguages: ['de', 'en'],
    };
}

export function validateSettingsOverrideDraft(candidateDraft) {
    const errors = [];
    const warnings = [];
    validateKnownDraftPaths(candidateDraft, errors);
    const normalizedDraft = mergeDraftCandidate(candidateDraft);

    if (normalizedDraft.schemaVersion !== SETTINGS_OVERRIDE_SCHEMA_VERSION) {
        errors.push(createError(
            'schemaVersion',
            'SCHEMA_VERSION_MISMATCH',
            `schemaVersion muss ${SETTINGS_OVERRIDE_SCHEMA_VERSION} sein.`
        ));
    }

    normalizedDraft.limitOverrides = normalizeLimitOverrides(
        candidateDraft?.limitOverrides,
        FIELD_REGISTRY_BY_PATH,
        errors,
        createError
    );

    for (const field of FIELD_REGISTRY) {
        const value = readPathValue(normalizedDraft, field.path);
        if (value === undefined) {
            continue;
        }

        if (field.type === 'number') {
            const asNumber = toFiniteNumber(value, null);
            if (!Number.isFinite(asNumber)) {
                errors.push(createError(field.path, 'FIELD_NUMBER_INVALID', `Zahl erwartet für ${field.path}.`));
                continue;
            }

            const limits = resolveEffectiveLimits(field, normalizedDraft.limitOverrides);
            if (!limits) continue;

            const hasExplicitLimitOverride = Object.prototype.hasOwnProperty.call(
                normalizedDraft.limitOverrides,
                field.path
            );
            if (!hasExplicitLimitOverride) {
                validateLimitRule(field.path, limits, errors, field, createError);
            }
            if (Number.isFinite(limits.min) && asNumber < limits.min) {
                errors.push(createError(
                    field.path,
                    'FIELD_NUMBER_BELOW_MIN',
                    `${field.path} liegt unter min (${asNumber} < ${limits.min}).`
                ));
            }
            if (Number.isFinite(limits.max) && asNumber > limits.max) {
                errors.push(createError(
                    field.path,
                    'FIELD_NUMBER_ABOVE_MAX',
                    `${field.path} liegt über max (${asNumber} > ${limits.max}).`
                ));
            }

            if (Number.isFinite(limits.step)
                && Number.isFinite(limits.min)
                && limits.step > 0) {
                const rawSteps = (asNumber - limits.min) / limits.step;
                const nearest = Math.round(rawSteps);
                const delta = Math.abs(rawSteps - nearest);
                if (delta > 1e-6) {
                    errors.push(createError(
                        field.path,
                        'FIELD_NUMBER_STEP_MISALIGN',
                        `${field.path} liegt nicht auf dem erwarteten step-Raster.`
                    ));
                }
            }

            if (limits.integer === true && !Number.isInteger(asNumber)) {
                errors.push(createError(
                    field.path,
                    'FIELD_INTEGER_REQUIRED',
                    `${field.path} erwartet eine ganze Zahl.`
                ));
            }
            if (field.options.length && !field.options.some((option) => option === asNumber)) {
                errors.push(createError(
                    field.path,
                    'FIELD_ENUM_INVALID',
                    `${field.path} enthält einen unbekannten Enum-Wert.`
                ));
            }
            continue;
        }

        if (field.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(createError(field.path, 'FIELD_BOOLEAN_INVALID', `Boolean erwartet für ${field.path}.`));
            continue;
        }

        if (field.type === 'string' && typeof value !== 'string') {
            errors.push(createError(field.path, 'FIELD_STRING_INVALID', `String erwartet für ${field.path}.`));
            continue;
        }

        if (field.type === 'string' && field.options.length && !field.options.includes(value)) {
            errors.push(createError(
                field.path,
                'FIELD_ENUM_INVALID',
                `${field.path} enthält einen unbekannten Enum-Wert.`
            ));
        }
    }

    if (!Array.isArray(normalizedDraft.fixedPresets)) {
        errors.push(createError('fixedPresets', 'FIELD_PRESETS_INVALID', 'fixedPresets muss ein Array sein.'));
        normalizedDraft.fixedPresets = deepCloneJson(createSettingsOverrideDraft().fixedPresets);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        normalizedDraft,
    };
}

export function applyLimitOverrideToDraft(draft, path, rule) {
    const source = isPlainObject(draft) ? deepCloneJson(draft) : createSettingsOverrideDraft();
    if (!isPlainObject(source.limitOverrides)) {
        source.limitOverrides = {};
    }

    const field = FIELD_REGISTRY_BY_PATH.get(path);
    if (!field || field.type !== 'number') {
        return {
            draft: source,
            result: {
                valid: false,
                errors: [createError(path, 'LIMIT_FIELD_UNKNOWN', `Limit-Override verweist auf unbekanntes Feld: ${path}.`)],
                warnings: [],
                normalizedDraft: source,
            },
        };
    }

    const normalizedOverride = normalizeLimitOverrides(
        { [path]: rule },
        FIELD_REGISTRY_BY_PATH,
        [],
        createError
    );
    source.limitOverrides[path] = normalizedOverride[path] || {};
    return {
        draft: source,
        result: validateSettingsOverrideDraft(source),
    };
}

export function setDraftValueByPath(draft, path, value) {
    const source = isPlainObject(draft) ? deepCloneJson(draft) : createSettingsOverrideDraft();
    writePathValue(source, path, value);
    return validateSettingsOverrideDraft(source);
}

export function classifyOverrideDraftMigration(rawDraft) {
    if (!isPlainObject(rawDraft)) {
        return { status: 'reject', code: SCHEMA_MIGRATION_CODES.REJECT, reason: 'Draft ist kein Objekt.' };
    }
    const schemaVersion = rawDraft.schemaVersion;
    if (!schemaVersion || typeof schemaVersion !== 'string' || !schemaVersion.trim()) {
        return { status: 'upgrade', code: SCHEMA_MIGRATION_CODES.UPGRADE, reason: 'Schema-Version fehlt; Upgrade auf aktuelle Version.' };
    }
    if (schemaVersion === SETTINGS_OVERRIDE_SCHEMA_VERSION) {
        return { status: 'current', code: SCHEMA_MIGRATION_CODES.CURRENT, reason: null };
    }
    if (UPGRADABLE_SCHEMA_VERSIONS.has(schemaVersion)) {
        return {
            status: 'upgrade',
            code: SCHEMA_MIGRATION_CODES.UPGRADE,
            reason: `Schema ${schemaVersion} wird verlustfrei auf ${SETTINGS_OVERRIDE_SCHEMA_VERSION} migriert.`,
        };
    }
    return { status: 'fallback', code: SCHEMA_MIGRATION_CODES.FALLBACK, reason: `Unbekannte Schema-Version: ${schemaVersion}. Standard-Werte werden verwendet.` };
}

function migrateHuntKillLimitIntoContractRange(draft) {
    const storedValue = readPathValue(draft, MIGRATED_KILL_LIMIT_PATH);
    if (storedValue === undefined || !isPlainObject(draft.baseSettings)) return draft;

    const fallbackValue = FIELD_REGISTRY_BY_PATH.get(MIGRATED_KILL_LIMIT_PATH)?.defaultValue;
    const clampedValue = clampSettingValue(
        storedValue,
        SETTINGS_LIMITS.hunt.deathmatchKillLimit,
        fallbackValue
    );
    if (clampedValue === storedValue) return draft;

    // Clone the branch we write into, so the stored draft the caller holds stays untouched.
    const migrated = { ...draft, baseSettings: deepCloneJson(draft.baseSettings) };
    writePathValue(migrated, MIGRATED_KILL_LIMIT_PATH, clampedValue);
    return migrated;
}

export function migrateOverrideDraft(rawDraft, migration) {
    if (!migration || migration.status === 'current') return rawDraft;
    if (migration.status === 'upgrade') {
        if (!isPlainObject(rawDraft)) return rawDraft;
        const migrated = { ...rawDraft, schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION };
        if (isPlainObject(rawDraft.limitOverrides)) {
            migrated.limitOverrides = {};
            for (const [path, rule] of Object.entries(rawDraft.limitOverrides)) {
                if (!isPlainObject(rule)) continue;
                const productLimits = FIELD_REGISTRY_BY_PATH.get(path)?.limits || {};
                const partialRule = {};
                for (const key of ['min', 'max', 'step']) {
                    const value = toFiniteNumber(rule[key], null);
                    if (Number.isFinite(value) && value !== productLimits[key]) {
                        partialRule[key] = value;
                    }
                }
                if (Object.keys(partialRule).length) {
                    migrated.limitOverrides[path] = partialRule;
                }
            }
        }
        return dropRetiredOverridePaths(migrateHuntKillLimitIntoContractRange(migrated));
    }
    return rawDraft;
}
