import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
} from './PlatformCapabilityData.js';
import { mergeBrowserDemoSurfacePolicyWithOverride } from './BrowserDemoSurfacePolicyOverrideContract.js';
import {
    isPlainObject,
    normalizeString,
    resolveRuntimeGlobal,
    sanitizeUniqueStringArray,
} from './PlatformCapabilityRegistryNormalization.js';
import { resolvePlatformProductSurfaceId } from './PlatformCapabilityRegistryRuntimeResolution.js';
import { resolveProductEntry } from './PlatformCapabilityRegistrySurfaceHelpers.js';

const BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS = Object.freeze({
    APPLIED: 'applied',
    SKIPPED: 'skipped',
    FALLBACK: 'fallback',
    REJECT: 'reject',
});
const BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES = Object.freeze({
    NOT_APPLICABLE: 'BROWSER_DEMO_OVERRIDE_NOT_APPLICABLE',
    SOURCE_UNAVAILABLE: 'BROWSER_DEMO_OVERRIDE_SOURCE_UNAVAILABLE',
    DRAFT_MISSING: 'BROWSER_DEMO_OVERRIDE_DRAFT_MISSING',
    DRAFT_INVALID: 'BROWSER_DEMO_OVERRIDE_DRAFT_INVALID',
    SNAPSHOT_INVALID: 'BROWSER_DEMO_OVERRIDE_SNAPSHOT_INVALID',
    READ_FAILED: 'BROWSER_DEMO_OVERRIDE_READ_FAILED',
    APPLIED: 'BROWSER_DEMO_OVERRIDE_APPLIED',
    FALLBACK_VERSION_UNKNOWN: 'BROWSER_DEMO_OVERRIDE_FALLBACK_VERSION_UNKNOWN',
    REJECTED: 'BROWSER_DEMO_OVERRIDE_REJECTED',
    VALIDATION_FAILED: 'BROWSER_DEMO_OVERRIDE_VALIDATION_FAILED',
});
/** @type {Set<string>} */
const VALID_BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS = new Set(
    Object.values(BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS)
);
const BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS = Object.freeze({
    PROVIDED: 'provided',
    SKIPPED: 'skipped',
    REJECT: 'reject',
});
/**
 * @typedef {typeof BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS[keyof typeof BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS]} BrowserDemoOverrideDraftResolutionStatus
 */
const BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION = 'browser-demo-surface-policy-export.v1';
const BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL = new URL(
    '../../../data/contracts/browser-demo-surface-policy.export.v1.json',
    import.meta.url
).href;
const BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT = 'build-artifact';
const BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE = new WeakMap();

function decodeBase64DataUrlPayload(payload, runtimeGlobal) {
    const atobFn = typeof runtimeGlobal?.atob === 'function'
        ? runtimeGlobal.atob.bind(runtimeGlobal)
        : (typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : null);
    if (!atobFn) return '';
    const binary = atobFn(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const TextDecoderCtor = typeof runtimeGlobal?.TextDecoder === 'function'
        ? runtimeGlobal.TextDecoder
        : (typeof globalThis.TextDecoder === 'function' ? globalThis.TextDecoder : null);
    return TextDecoderCtor ? new TextDecoderCtor('utf-8').decode(bytes) : binary;
}

function readBrowserDemoPolicyExportDataUrl(runtimeGlobal) {
    if (!BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL.startsWith('data:')) return null;
    const separatorIndex = BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL.indexOf(',');
    if (separatorIndex < 0) return '';
    const metadata = BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL.slice(5, separatorIndex).toLowerCase();
    const payload = BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL.slice(separatorIndex + 1);
    return metadata.split(';').includes('base64')
        ? decodeBase64DataUrlPayload(payload, runtimeGlobal)
        : decodeURIComponent(payload);
}

function readBrowserDemoPolicyExportWithXmlHttpRequest(runtimeGlobal, processResponse) {
    const XmlHttpRequestCtor = typeof runtimeGlobal?.XMLHttpRequest === 'function'
        ? runtimeGlobal.XMLHttpRequest
        : null;
    if (!XmlHttpRequestCtor) return null;

    try {
        const request = new XmlHttpRequestCtor();
        // Keep this fallback bound to the explicit runtime input; implicit globals would make desktop boot probe browser-demo artifacts.
        request.open('GET', BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL, false);
        request.send();
        return processResponse(Number(request.status) || 0, String(request.responseText || ''));
    } catch (error) {
        const readFailed = createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.READ_FAILED,
            reason: error instanceof Error ? error.message : String(error || 'build_artifact_read_failed'),
            source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
        });
        BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, readFailed);
        return readFailed;
    }
}

function sanitizeDiagnosticsCodeArray(values) {
    return sanitizeUniqueStringArray(values, normalizeString);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeBrowserDemoOverrideDiagnosticStatus(
    value,
    fallback = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT
) {
    const normalized = normalizeString(value, fallback).toLowerCase();
    return VALID_BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.has(normalized)
        ? normalized
        : fallback;
}

/**
 * @param {{
 *   status?: string,
 *   reasonCode?: string,
 *   reason?: string,
 *   source?: string,
 *   migrationCode?: string,
 *   errorCodes?: readonly string[],
 *   warningCodes?: readonly string[],
 * }} [options]
 * @returns {Readonly<{
 *   status: string,
 *   reasonCode: string,
 *   reason: string,
 *   source: string,
 *   migrationCode: string,
 *   errorCodes: readonly string[],
 *   warningCodes: readonly string[],
 * }>}
 */
function createBrowserDemoOverrideDiagnostics({
    status = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
    reasonCode = '',
    reason = '',
    source = 'none',
    migrationCode = '',
    errorCodes = [],
    warningCodes = [],
} = {}) {
    return Object.freeze({
        status: normalizeBrowserDemoOverrideDiagnosticStatus(status),
        reasonCode: normalizeString(reasonCode, ''),
        reason: normalizeString(reason, ''),
        source: normalizeString(source, 'none'),
        migrationCode: normalizeString(migrationCode, ''),
        errorCodes: sanitizeDiagnosticsCodeArray(errorCodes),
        warningCodes: sanitizeDiagnosticsCodeArray(warningCodes),
    });
}

/**
 * @param {{
 *   status?: BrowserDemoOverrideDraftResolutionStatus | string,
 *   reasonCode?: string,
 *   reason?: string,
 *   source?: string,
 *   draft?: unknown,
 * }} [options]
 * @returns {Readonly<{
 *   status: BrowserDemoOverrideDraftResolutionStatus,
 *   reasonCode: string,
 *   reason: string,
 *   source: string,
 *   draft: object | null,
 * }>}
 */
function createBrowserDemoOverrideDraftResolution({
    status = BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.SKIPPED,
    reasonCode = '',
    reason = '',
    source = 'none',
    draft = null,
} = {}) {
    const normalizedStatus = normalizeString(status, '').toLowerCase();
    /** @type {BrowserDemoOverrideDraftResolutionStatus} */
    const resolvedStatus = normalizedStatus === BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.PROVIDED
        ? BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.PROVIDED
        : (normalizedStatus === BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.REJECT
            ? BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.REJECT
            : BROWSER_DEMO_OVERRIDE_DRAFT_RESOLUTION_STATUS.SKIPPED);
    return Object.freeze({
        status: resolvedStatus,
        reasonCode: normalizeString(reasonCode, ''),
        reason: normalizeString(reason, ''),
        source: normalizeString(source, 'none'),
        draft: isPlainObject(draft) ? draft : null,
    });
}

function resolveBrowserDemoSurfacePolicyOverrideDraftFromBuildArtifact(runtimeGlobal) {
    if (!runtimeGlobal || typeof runtimeGlobal !== 'object') {
        return createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SOURCE_UNAVAILABLE,
            reason: 'Build-Artefakt-Quelle fuer Browser-Demo-Override ist nicht verfuegbar.',
            source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
        });
    }

    const cached = BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.get(runtimeGlobal);
    if (cached) {
        return cached;
    }

    const processResponse = (status, text) => {
        const hasHttpSuccess = status >= 200 && status < 300;
        const hasFileSuccess = status === 0 && text.trim().length > 0;
        if (!hasHttpSuccess && !hasFileSuccess) {
            const unavailable = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SOURCE_UNAVAILABLE,
                reason: `Build-Artefakt nicht verfuegbar (status: ${status}).`,
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, unavailable);
            return unavailable;
        }

        if (!text.trim()) {
            const missingDraft = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.DRAFT_MISSING,
                reason: 'Build-Artefakt fuer Browser-Demo-Override ist leer.',
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, missingDraft);
            return missingDraft;
        }

        let parsedArtifact = null;
        try {
            parsedArtifact = JSON.parse(text);
        } catch (error) {
            const invalidArtifact = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SNAPSHOT_INVALID,
                reason: error instanceof Error ? error.message : String(error || 'build_artifact_parse_failed'),
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, invalidArtifact);
            return invalidArtifact;
        }

        if (!isPlainObject(parsedArtifact)) {
            const invalidArtifact = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SNAPSHOT_INVALID,
                reason: 'Build-Artefakt fuer Browser-Demo-Override muss ein Objekt sein.',
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, invalidArtifact);
            return invalidArtifact;
        }

        const contractVersion = normalizeString(parsedArtifact.contractVersion, '');
        if (contractVersion !== BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION) {
            const invalidArtifact = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SNAPSHOT_INVALID,
                reason: `Build-Artefakt contractVersion ist ungueltig: ${contractVersion || '<missing>'}.`,
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, invalidArtifact);
            return invalidArtifact;
        }

        if (!isPlainObject(parsedArtifact.draft)) {
            const missingDraft = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.DRAFT_MISSING,
                reason: 'Build-Artefakt enthaelt keinen gueltigen Draft.',
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, missingDraft);
            return missingDraft;
        }

        const resolved = createBrowserDemoOverrideDraftResolution({
            status: 'provided',
            source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            draft: parsedArtifact.draft,
        });
        BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, resolved);
        return resolved;
    };

    try {
        const dataUrlResponseText = readBrowserDemoPolicyExportDataUrl(runtimeGlobal);
        if (dataUrlResponseText !== null) {
            return processResponse(200, dataUrlResponseText);
        } else {
            const pendingResolution = createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SOURCE_UNAVAILABLE,
                reason: 'Build-Artefakt wird asynchron geladen.',
                source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
            });
            BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, pendingResolution);

            const fetchFn = typeof runtimeGlobal.fetch === 'function'
                ? runtimeGlobal.fetch.bind(runtimeGlobal)
                : null;

            if (fetchFn) {
                fetchFn(BROWSER_DEMO_POLICY_EXPORT_ARTIFACT_URL)
                    .then(response => {
                        return response.text().then(text => ({ status: response.status, text }));
                    })
                    .then(({ status, text }) => {
                        processResponse(status, text);
                    })
                    .catch(error => {
                        const readFailed = createBrowserDemoOverrideDraftResolution({
                            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
                            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.READ_FAILED,
                            reason: error instanceof Error ? error.message : String(error || 'build_artifact_read_failed'),
                            source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
                        });
                        BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, readFailed);
                    });
            } else {
                const xmlHttpRequestResolution = readBrowserDemoPolicyExportWithXmlHttpRequest(runtimeGlobal, processResponse);
                if (xmlHttpRequestResolution) {
                    return xmlHttpRequestResolution;
                }
                const unavailable = createBrowserDemoOverrideDraftResolution({
                    status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                    reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SOURCE_UNAVAILABLE,
                    reason: 'Keine Fetch-API fuer den asynchronen Build-Artefakt-Lesepfad verfuegbar.',
                    source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
                });
                BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, unavailable);
                return unavailable;
            }
            return pendingResolution;
        }
    } catch (error) {
        const readFailed = createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.READ_FAILED,
            reason: error instanceof Error ? error.message : String(error || 'build_artifact_read_failed'),
            source: BROWSER_DEMO_OVERRIDE_SOURCE_BUILD_ARTIFACT,
        });
        BROWSER_DEMO_BUILD_ARTIFACT_RESOLUTION_CACHE.set(runtimeGlobal, readFailed);
        return readFailed;
    }
}

function resolveBrowserDemoSurfacePolicyOverrideDraft(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'browserDemoSurfacePolicyOverrideDraft')) {
        const draft = options.browserDemoSurfacePolicyOverrideDraft;
        if (!isPlainObject(draft)) {
            return createBrowserDemoOverrideDraftResolution({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.DRAFT_INVALID,
                reason: 'browserDemoSurfacePolicyOverrideDraft muss ein Objekt sein.',
                source: 'options',
            });
        }
        return createBrowserDemoOverrideDraftResolution({
            status: 'provided',
            source: 'options',
            draft,
        });
    }

    const platformRuntimeSnapshot = options.platformRuntimeSnapshot
        && typeof options.platformRuntimeSnapshot === 'object'
        ? options.platformRuntimeSnapshot
        : null;
    const browserDemoPolicyContract = platformRuntimeSnapshot?.browserDemoSurfacePolicyContract;
    const runtimeGlobal = Object.prototype.hasOwnProperty.call(options, 'runtimeGlobal')
        ? resolveRuntimeGlobal(options.runtimeGlobal)
        : null;
    if (!browserDemoPolicyContract || typeof browserDemoPolicyContract.getOverrideSnapshot !== 'function') {
        return resolveBrowserDemoSurfacePolicyOverrideDraftFromBuildArtifact(runtimeGlobal);
    }

    let snapshot = null;
    try {
        snapshot = browserDemoPolicyContract.getOverrideSnapshot();
    } catch (error) {
        return createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.READ_FAILED,
            reason: error instanceof Error ? error.message : String(error || 'override_read_failed'),
            source: 'runtime',
        });
    }

    if (!isPlainObject(snapshot)) {
        return createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.SNAPSHOT_INVALID,
            reason: 'Override-Snapshot muss ein Objekt sein.',
            source: 'runtime',
        });
    }

    const snapshotReadError = normalizeString(snapshot.readError, '');
    const snapshotParseError = normalizeString(snapshot.parseError, '');
    if (snapshotReadError || snapshotParseError) {
        return createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.READ_FAILED,
            reason: snapshotReadError || snapshotParseError,
            source: 'runtime',
        });
    }

    if (!isPlainObject(snapshot.draft)) {
        return createBrowserDemoOverrideDraftResolution({
            status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
            reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.DRAFT_MISSING,
            reason: 'Kein Browser-Demo-Override-Draft vorhanden.',
            source: 'runtime',
        });
    }

    return createBrowserDemoOverrideDraftResolution({
        status: 'provided',
        source: 'runtime',
        draft: snapshot.draft,
    });
}

function mapBrowserDemoMergeDiagnostics(mergeDiagnostics, source = 'none') {
    const status = normalizeBrowserDemoOverrideDiagnosticStatus(
        mergeDiagnostics?.status,
        BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT
    );
    const reason = normalizeString(mergeDiagnostics?.reason, '');
    const migrationCode = normalizeString(mergeDiagnostics?.migrationCode, '');
    /** @type {string} */
    let reasonCode = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.REJECTED;

    if (status === BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.APPLIED) {
        reasonCode = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.APPLIED;
    } else if (status === BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.FALLBACK) {
        reasonCode = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.FALLBACK_VERSION_UNKNOWN;
    } else if (
        status === BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.REJECT
        && reason === 'VALIDATION_FAILED'
    ) {
        reasonCode = BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.VALIDATION_FAILED;
    }

    return createBrowserDemoOverrideDiagnostics({
        status,
        reasonCode,
        reason,
        source,
        migrationCode,
        errorCodes: mergeDiagnostics?.errorCodes,
        warningCodes: mergeDiagnostics?.warningCodes,
    });
}

export function resolveSurfacePolicySource(options = {}) {
    const productSurfaceId = resolvePlatformProductSurfaceId(options);
    const productEntry = resolveProductEntry(productSurfaceId);
    const baseSurfacePolicy = productEntry?.surfacePolicy && typeof productEntry.surfacePolicy === 'object'
        ? productEntry.surfacePolicy
        : null;
    const baseCapabilities = productEntry?.capabilities && typeof productEntry.capabilities === 'object'
        ? productEntry.capabilities
        : {};

    if (productSurfaceId !== PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO) {
        return Object.freeze({
            productSurfaceId,
            productEntry,
            surfacePolicy: baseSurfacePolicy,
            capabilityFlags: null,
            browserDemoOverrideDiagnostics: createBrowserDemoOverrideDiagnostics({
                status: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_STATUS.SKIPPED,
                reasonCode: BROWSER_DEMO_OVERRIDE_DIAGNOSTIC_REASON_CODES.NOT_APPLICABLE,
                reason: 'Browser-Demo-Override ist nur fuer browser-demo relevant.',
                source: 'none',
            }),
        });
    }

    const overrideDraftResolution = resolveBrowserDemoSurfacePolicyOverrideDraft(options);
    if (overrideDraftResolution.status !== 'provided') {
        return Object.freeze({
            productSurfaceId,
            productEntry,
            surfacePolicy: baseSurfacePolicy,
            capabilityFlags: null,
            browserDemoOverrideDiagnostics: createBrowserDemoOverrideDiagnostics({
                status: overrideDraftResolution.status,
                reasonCode: overrideDraftResolution.reasonCode,
                reason: overrideDraftResolution.reason,
                source: overrideDraftResolution.source,
            }),
        });
    }

    const merged = mergeBrowserDemoSurfacePolicyWithOverride(
        baseSurfacePolicy,
        baseCapabilities,
        overrideDraftResolution.draft
    );
    return Object.freeze({
        productSurfaceId,
        productEntry,
        surfacePolicy: merged?.policy || baseSurfacePolicy,
        capabilityFlags: merged?.capabilityFlags || null,
        browserDemoOverrideDiagnostics: mapBrowserDemoMergeDiagnostics(
            merged?.diagnostics,
            overrideDraftResolution.source
        ),
    });
}
