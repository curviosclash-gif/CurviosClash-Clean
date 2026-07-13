import {
    MENU_DEFAULT_EDITOR_SCHEMA_VERSION,
    createMenuDefaultsEditorConfigSnapshot,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { SETTINGS_LIMITS } from '../../shared/contracts/SettingsRuntimeContract.js';
import {
    collectPrimitiveLeafPaths,
    deepCloneJson,
    deepMergeKnownShape,
    isPlainObject,
    readPathValue,
    writePathValue,
} from './SettingsOverrideMergeOps.js';

export const SETTINGS_OVERRIDE_SCHEMA_VERSION = 'menu-defaults-override.v1';
export const SETTINGS_STUDIO_SCHEMA_CONTRACT_VERSION = 'settings-studio-schema.v1';

export const SCHEMA_MIGRATION_CODES = Object.freeze({
    CURRENT: 'SCHEMA_VERSION_CURRENT',
    UPGRADE: 'SCHEMA_VERSION_UPGRADE',
    FALLBACK: 'SCHEMA_VERSION_UNKNOWN',
    REJECT: 'SCHEMA_VERSION_CORRUPT',
});

const DEFAULT_LANGUAGE = 'de';
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);

const FIELD_HELP_METADATA = Object.freeze({
    'baseSettings.gameplay.trailLength': Object.freeze({ riskLevel: 'medium', unit: 'segments', example: '5000', help: { de: 'Maximale Segmentanzahl der Kursspur.', en: 'Maximum segment count of each flight trail.' }, impact: { de: 'Hoehere Werte verlaengern die Spur, erhoehen aber Speicher-, GPU- und Kollisionskosten.', en: 'Higher values make trails longer, but increase memory, GPU, and collision cost.' } }),
    'baseSettings.numBots': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Anzahl der KI-Gegner pro Match.', en: 'Number of AI opponents per match.' }, impact: { de: 'Mehr Bots erzeugen mehr Spielaktion, erhöhen aber den Rechenaufwand.', en: 'More bots create more action, but increase CPU load.' } }),
    'baseSettings.winsNeeded': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Rundensiege, die zum Matchgewinn benötigt werden.', en: 'Round wins needed to win the match.' }, impact: { de: 'Bestimmt die Matchlänge direkt.', en: 'Directly determines match length.' } }),
    'baseSettings.gameplay.speed': Object.freeze({ riskLevel: 'medium', unit: null, example: '21', help: { de: 'Grundgeschwindigkeit der Flugzeuge.', en: 'Base flight speed of the planes.' }, impact: { de: 'Beeinflusst Schwierigkeit und Reaktionszeit stark. Extreme Werte können das Spiel unspielbar machen.', en: 'Strongly affects difficulty and reaction time. Extreme values may make the game unplayable.' } }),
    'baseSettings.gameplay.turnSensitivity': Object.freeze({ riskLevel: 'medium', unit: null, example: '2.4', help: { de: 'Lenkempfindlichkeit der Flugzeuge.', en: 'Steering sensitivity of the planes.' }, impact: { de: 'Höhere Werte erlauben engere Kurven. Zu hohe Werte machen die Steuerung unbeherrschbar.', en: 'Higher values allow tighter turns. Too high makes control unpredictable.' } }),
    'baseSettings.gameplay.planeScale': Object.freeze({ riskLevel: 'low', unit: null, example: '1.0', help: { de: 'Skalierung der Flugzeug-Modelle.', en: 'Scale of the plane models.' }, impact: { de: 'Rein visuell; beeinflusst keine Spielmechanik.', en: 'Visual only; does not affect gameplay mechanics.' } }),
    'baseSettings.gameplay.trailWidth': Object.freeze({ riskLevel: 'low', unit: null, example: '0.15', help: { de: 'Breite der Kursspur jedes Flugzeugs.', en: "Width of each plane's flight trail." }, impact: { de: 'Breitere Spuren erhöhen die Kollisionswahrscheinlichkeit.', en: 'Wider trails increase collision probability.' } }),
    'baseSettings.gameplay.gapSize': Object.freeze({ riskLevel: 'medium', unit: null, example: '0.5', help: { de: 'Größe der Lücken in der Flugspur.', en: 'Size of gaps in the flight trail.' }, impact: { de: 'Größere Lücken erlauben Durchschlüpfen durch die eigene Spur.', en: 'Larger gaps allow passing through own trail.' } }),
    'baseSettings.gameplay.gapFrequency': Object.freeze({ riskLevel: 'low', unit: null, example: '0.05', help: { de: 'Häufigkeit der Lücken in der Flugspur.', en: 'Frequency of gaps in the flight trail.' }, impact: { de: 'Höhere Werte erzeugen mehr Lücken pro Zeiteinheit.', en: 'Higher values produce more gaps per time unit.' } }),
    'baseSettings.gameplay.itemAmount': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Max. Anzahl gleichzeitiger Power-ups auf dem Spielfeld.', en: 'Max. number of simultaneous power-ups on the field.' }, impact: { de: 'Mehr Items = häufigere Power-up-Gelegenheiten.', en: 'More items = more frequent power-up opportunities.' } }),
    'baseSettings.gameplay.fireRate': Object.freeze({ riskLevel: 'medium', unit: null, example: '0.15', help: { de: 'Schussrate der Bordkanone (Schüsse/s).', en: 'Machine gun fire rate (shots/s).' }, impact: { de: 'Höhere Werte ermöglichen schnelleres Schießen; beeinflusst Kampfbalance.', en: 'Higher values allow faster shooting; affects combat balance.' } }),
    'baseSettings.gameplay.lockOnAngle': Object.freeze({ riskLevel: 'low', unit: '°', example: '30', help: { de: 'Winkelbereich für automatisches Zielen.', en: 'Angle range for automatic lock-on targeting.' }, impact: { de: 'Größerer Winkel erleichtert das Zielen erheblich.', en: 'Larger angle makes aiming significantly easier.' } }),
    'baseSettings.gameplay.nextCheckpointGlowIntensity': Object.freeze({ riskLevel: 'low', unit: null, example: '1.35', help: { de: 'Leuchtstärke für den nächsten Parcours-Checkpoint-Ring.', en: 'Glow strength for the next parcours checkpoint ring.' }, impact: { de: 'Höhere Werte machen den nächsten Ring deutlicher sichtbar.', en: 'Higher values make the next ring more visually prominent.' } }),
    'baseSettings.gameplay.mgTrailAimRadius': Object.freeze({ riskLevel: 'low', unit: null, example: '0.15', help: { de: 'Trefferradius der Bordkanone auf der Spur.', en: 'Machine gun hit radius on the trail.' }, impact: { de: 'Größerer Radius = treffsicherer, aber ggf. weniger präzises Gefühl.', en: 'Larger radius = more accurate, but potentially less precise feel.' } }),
    'baseSettings.gameplay.fightPlayerHp': Object.freeze({ riskLevel: 'medium', unit: null, example: '100', help: { de: 'Trefferpunkte der Spieler im Kampfmodus.', en: 'Player hit points in fight mode.' }, impact: { de: 'Niedrigere Werte = kürzere Kämpfe. Sehr hohe Werte verlängern Matches stark.', en: 'Lower values = shorter fights. Very high values extend matches significantly.' } }),
    'baseSettings.gameplay.fightMgDamage': Object.freeze({ riskLevel: 'medium', unit: null, example: '10', help: { de: 'Schaden pro Bordkanonen-Treffer im Kampfmodus.', en: 'Damage per machine gun hit in fight mode.' }, impact: { de: 'Zusammen mit HP bestimmt dies die Kampfdauer. Nicht isoliert anpassen.', en: 'Together with HP determines fight duration. Do not adjust in isolation.' } }),
    'baseSettings.gameplay.portalCount': Object.freeze({ riskLevel: 'low', unit: null, example: '3', help: { de: 'Anzahl der Portale auf der Karte.', en: 'Number of portals on the map.' }, impact: { de: 'Mehr Portale erhöhen die Bewegungsvielfalt auf dem Spielfeld.', en: 'More portals increase movement variety on the field.' } }),
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
    return Object.freeze({ riskLevel: 'low', unit: null, example: null, help: null, impact: null });
}

const SECTION_DEFINITIONS = Object.freeze([
    { key: 'baseSettings', category: 'base' },
    { key: 'localSettings', category: 'local' },
    { key: 'level3Reset', category: 'level3' },
    { key: 'configShare', category: 'configShare' },
    { key: 'fixedPresets', category: 'presets' },
]);

const DEFAULT_FIELD_LIMITS = Object.freeze({
    'baseSettings.gameplay.trailLength': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailLength, step: 100 }),
    'configShare.gameplay.trailLength': Object.freeze({ ...SETTINGS_LIMITS.gameplay.trailLength, step: 100 }),
    'baseSettings.numBots': Object.freeze({ ...SETTINGS_LIMITS.session.numBots, step: 1 }),
    'baseSettings.winsNeeded': Object.freeze({ ...SETTINGS_LIMITS.session.winsNeeded, step: 1 }),
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
    'baseSettings.gameplay.portalCount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.portalCount, step: 1 }),
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
    'configShare.gameplay.portalCount': Object.freeze({ ...SETTINGS_LIMITS.gameplay.portalCount, step: 1 }),
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
            entries.push({
                path,
                section: section.key,
                category: resolveFieldCategory(path, section.category),
                type,
                labelKey: `settings.field.${path}`,
                defaultValue: deepCloneJson(value),
                limits,
                riskLevel: meta.riskLevel,
                unit: meta.unit,
                example: meta.example,
                help: meta.help,
                impact: meta.impact,
            });
        }
    }

    for (const path of Object.keys(DEFAULT_FIELD_LIMITS)) {
        if (pathSet.has(path)) continue;
        pathSet.add(path);
        const meta = resolveFieldHelpMetadata(path);
        entries.push({
            path,
            section: path.split('.')[0],
            category: resolveFieldCategory(path, 'gameplay'),
            type: 'number',
            labelKey: `settings.field.${path}`,
            defaultValue: deriveSeedDefaultValue(path, draft),
            limits: deepCloneJson(DEFAULT_FIELD_LIMITS[path]),
            riskLevel: meta.riskLevel,
            unit: meta.unit,
            example: meta.example,
            help: meta.help,
            impact: meta.impact,
        });
    }

    return Object.freeze(entries.sort((left, right) => left.path.localeCompare(right.path)));
}

const FIELD_REGISTRY = createSettingsOverrideFieldRegistry();
const FIELD_REGISTRY_BY_PATH = new Map(FIELD_REGISTRY.map((entry) => [entry.path, entry]));

function createLimitRule(rule, fallbackLimits = null) {
    const fallback = isPlainObject(fallbackLimits) ? fallbackLimits : {};
    const source = isPlainObject(rule) ? rule : {};
    const min = toFiniteNumber(source.min, toFiniteNumber(fallback.min, null));
    const max = toFiniteNumber(source.max, toFiniteNumber(fallback.max, null));
    const step = toFiniteNumber(source.step, toFiniteNumber(fallback.step, null));
    const integer = source.integer === true || fallback.integer === true;
    return {
        min,
        max,
        step,
        integer,
    };
}

function validateLimitRule(path, limits, errors) {
    if (!Number.isFinite(limits.min)) {
        errors.push(createError(path, 'LIMIT_MIN_INVALID', `Limit min ist ungueltig fuer ${path}.`));
    }
    if (!Number.isFinite(limits.max)) {
        errors.push(createError(path, 'LIMIT_MAX_INVALID', `Limit max ist ungueltig fuer ${path}.`));
    }
    if (!Number.isFinite(limits.step)) {
        errors.push(createError(path, 'LIMIT_STEP_INVALID', `Limit step ist ungueltig fuer ${path}.`));
    }
    if (Number.isFinite(limits.step) && limits.step <= 0) {
        errors.push(createError(path, 'LIMIT_STEP_NON_POSITIVE', `Limit step muss groesser als 0 sein fuer ${path}.`));
    }
    if (Number.isFinite(limits.min)
        && Number.isFinite(limits.max)
        && limits.min > limits.max) {
        errors.push(createError(path, 'LIMIT_RANGE_INVALID', `Limit min darf nicht groesser als max sein fuer ${path}.`));
    }
}

function normalizeLimitOverrides(rawLimitOverrides, errors) {
    const overrides = {};
    const source = isPlainObject(rawLimitOverrides) ? rawLimitOverrides : {};

    for (const [path, rawRule] of Object.entries(source)) {
        const field = FIELD_REGISTRY_BY_PATH.get(path);
        if (!field || field.type !== 'number') {
            errors.push(createError(path, 'LIMIT_FIELD_UNKNOWN', `Limit-Override verweist auf unbekanntes Feld: ${path}.`));
            continue;
        }

        const limits = createLimitRule(rawRule, field.limits || null);
        validateLimitRule(path, limits, errors);
        overrides[path] = limits;
    }

    return overrides;
}

function resolveEffectiveLimits(field, limitOverrides) {
    if (!field || field.type !== 'number') return null;
    const fallback = field.limits || null;
    const override = limitOverrides[field.path] || null;
    if (!fallback && !override) return null;
    return createLimitRule(override, fallback);
}

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
    const normalizedDraft = mergeDraftCandidate(candidateDraft);

    if (normalizedDraft.schemaVersion !== SETTINGS_OVERRIDE_SCHEMA_VERSION) {
        errors.push(createError(
            'schemaVersion',
            'SCHEMA_VERSION_MISMATCH',
            `schemaVersion muss ${SETTINGS_OVERRIDE_SCHEMA_VERSION} sein.`
        ));
    }

    normalizedDraft.limitOverrides = normalizeLimitOverrides(candidateDraft?.limitOverrides, errors);

    for (const field of FIELD_REGISTRY) {
        const value = readPathValue(normalizedDraft, field.path);
        if (value === undefined) {
            continue;
        }

        if (field.type === 'number') {
            const asNumber = toFiniteNumber(value, null);
            if (!Number.isFinite(asNumber)) {
                errors.push(createError(field.path, 'FIELD_NUMBER_INVALID', `Zahl erwartet fuer ${field.path}.`));
                continue;
            }

            const limits = resolveEffectiveLimits(field, normalizedDraft.limitOverrides);
            if (!limits) continue;

            const hasExplicitLimitOverride = Object.prototype.hasOwnProperty.call(
                normalizedDraft.limitOverrides,
                field.path
            );
            if (!hasExplicitLimitOverride) {
                validateLimitRule(field.path, limits, errors);
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
                    `${field.path} liegt ueber max (${asNumber} > ${limits.max}).`
                ));
            }

            if (Number.isFinite(limits.step)
                && Number.isFinite(limits.min)
                && limits.step > 0) {
                const rawSteps = (asNumber - limits.min) / limits.step;
                const nearest = Math.round(rawSteps);
                const delta = Math.abs(rawSteps - nearest);
                if (delta > 1e-6) {
                    warnings.push(createError(
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
            continue;
        }

        if (field.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(createError(field.path, 'FIELD_BOOLEAN_INVALID', `Boolean erwartet fuer ${field.path}.`));
            continue;
        }

        if (field.type === 'string' && typeof value !== 'string') {
            errors.push(createError(field.path, 'FIELD_STRING_INVALID', `String erwartet fuer ${field.path}.`));
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

    source.limitOverrides[path] = createLimitRule(rule, field.limits || null);
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
    return { status: 'fallback', code: SCHEMA_MIGRATION_CODES.FALLBACK, reason: `Unbekannte Schema-Version: ${schemaVersion}. Standard-Werte werden verwendet.` };
}

export function migrateOverrideDraft(rawDraft, migration) {
    if (!migration || migration.status === 'current') return rawDraft;
    if (migration.status === 'upgrade') {
        return isPlainObject(rawDraft)
            ? { ...rawDraft, schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION }
            : rawDraft;
    }
    return rawDraft;
}
