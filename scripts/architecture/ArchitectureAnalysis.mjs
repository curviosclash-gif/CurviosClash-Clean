import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    ARCHITECTURE_SCORECARD_BUDGETS,
    ARCHITECTURE_SCORECARD_TARGETS,
    BOUNDARY_MATRIX,
    LEGACY_APPLICATION_TO_CORE_IMPORTS,
    LEGACY_APPLICATION_TO_UI_IMPORTS,
    LEGACY_CORE_TO_UI_IMPORTS,
    LEGACY_CONSTRUCTOR_GAME_ALLOWLIST,
    LEGACY_DOM_ACCESS_ALLOWLIST,
    LEGACY_ENTITIES_TO_CORE_IMPORTS,
    LEGACY_SHARED_CONTRACTS_TO_CORE_IMPORTS,
    LEGACY_STATE_TO_CORE_IMPORTS,
    LEGACY_STATE_TO_UI_IMPORTS,
    LEGACY_UI_TO_CORE_IMPORTS,
    LEGACY_UI_TO_STATE_IMPORTS,
    createEdgeKey,
} from './ArchitectureConfig.mjs';

const GUARD_MATRIX_PATH = 'scripts/architecture/legacy-surface-guard-matrix.json';

function loadGuardMatrix(rootDir) {
    const matrixPath = path.join(rootDir, GUARD_MATRIX_PATH);
    try {
        return JSON.parse(readFileSync(matrixPath, 'utf8'));
    } catch {
        return null;
    }
}

function collectLegacySurfaceFindings(filesByRelativePath, guardMatrix) {
    if (!guardMatrix?.surfaces) return [];
    const allFindings = [];
    for (const surface of guardMatrix.surfaces) {
        if (!surface.forbiddenForNewWork) continue;
        const allowedSet = new Set([
            ...(surface.allowedAdapters || []),
            ...(surface.allowedCallers || []),
        ]);
        const combinedPattern = surface.patterns
            .map((p) => `(?:${p})`)
            .join('|');
        const pattern = new RegExp(combinedPattern, 'g');
        for (const [relativePath, text] of filesByRelativePath.entries()) {
            if (!relativePath.startsWith('src/') && !relativePath.startsWith('electron/')) continue;
            const matches = [...text.matchAll(pattern)];
            if (matches.length === 0) continue;
            const allowed = allowedSet.has(relativePath);
            for (const match of matches) {
                const line = countLineNumber(text, match.index || 0);
                allFindings.push({
                    surfaceId: surface.id,
                    file: relativePath,
                    line,
                    match: match[0],
                    snippet: readLineAt(text, line),
                    allowed,
                    reason: allowed ? 'listed in guard-matrix allowedAdapters or allowedCallers' : null,
                });
            }
        }
    }
    return allFindings;
}

function summarizeLegacySurfaceScorecard(findings, guardMatrix) {
    if (!guardMatrix?.surfaces) return {};
    const scorecard = {};
    for (const surface of guardMatrix.surfaces) {
        if (!surface.forbiddenForNewWork) continue;
        const surfaceFindings = findings.filter((f) => f.surfaceId === surface.id);
        const filesUsing = [...new Set(surfaceFindings.map((f) => f.file))];
        const disallowedFiles = [...new Set(
            surfaceFindings.filter((f) => !f.allowed).map((f) => f.file)
        )];
        scorecard[surface.id] = {
            totalFiles: filesUsing.length,
            disallowedFiles: disallowedFiles.length,
            legacyFiles: filesUsing.filter((f) => !disallowedFiles.includes(f)),
        };
    }
    return scorecard;
}

const LOCAL_IMPORT_PATTERN = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const COMMONJS_REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM_PATTERN = /export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g;
const CONSTRUCTOR_GAME_PATTERN = /constructor\s*\(\s*game(?:\s*=|\s*[),])/g;
const THIS_GAME_EQUALS_GAME_PATTERN = /\bthis\.game\s*=\s*game\b/g;
const CONFIG_WRITE_PATTERN = /\bCONFIG(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])+\s*=/g;
const DOCUMENT_ACCESS_PATTERN = /\bdocument\.(?:body|hidden|readyState|createElement|getElementById|querySelector(?:All)?|addEventListener|removeEventListener|execCommand)\b/g;
const ELECTRON_CONTEXT_BRIDGE_EXPOSURE_PATTERN = /contextBridge\.exposeInMainWorld\(\s*['"]([^'"]+)['"]/g;
const ELECTRON_IPC_RENDERER_CHANNEL_PATTERN = /ipcRenderer\.(invoke|send|sendSync|on|once|removeListener|removeAllListeners)\(\s*['"]([^'"]+)['"]/g;
const ELECTRON_IPC_MAIN_CHANNEL_PATTERN = /ipcMain\.(handle|handleOnce|on|once|removeHandler|removeAllListeners)\(\s*['"]([^'"]+)['"]/g;

function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}

function isScannableSourceFile(fileName) {
    return /\.(?:cjs|mjs|js)$/i.test(fileName);
}

function getSourceFiles(rootDir) {
    const sourceRoots = ['src', 'server', 'electron', 'editor', 'prototypes/vehicle-lab']
        .map((relativePath) => path.join(rootDir, relativePath))
        .filter((absolutePath) => existsSync(absolutePath));
    const files = [];
    const walk = (currentDir) => {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === 'dist' || entry.name === 'node_modules') continue;
            const absolutePath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(absolutePath);
                continue;
            }
            if (entry.isFile() && isScannableSourceFile(entry.name)) {
                files.push(absolutePath);
            }
        }
    };
    for (const sourceRoot of sourceRoots) {
        walk(sourceRoot);
    }
    return files;
}

function countLineNumber(text, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (text.charCodeAt(i) === 10) line += 1;
    }
    return line;
}

function readLineAt(text, lineNumber) {
    const lines = text.split(/\r?\n/);
    return String(lines[Math.max(0, lineNumber - 1)] || '').trim();
}

function resolveImportTarget(rootDir, fromFile, specifier) {
    if (!specifier.startsWith('.')) return specifier;
    const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
    const candidatePaths = [
        resolvedBase,
        `${resolvedBase}.js`,
        `${resolvedBase}.mjs`,
        `${resolvedBase}.cjs`,
        path.join(resolvedBase, 'index.js'),
        path.join(resolvedBase, 'index.mjs'),
        path.join(resolvedBase, 'index.cjs'),
    ];
    const resolvedPath = candidatePaths.find((candidate) => existsSync(candidate)) || resolvedBase;
    return normalizePath(path.relative(rootDir, resolvedPath));
}

function resolveLayer(relativePath) {
    if (relativePath.startsWith('server/')) return 'server';
    if (relativePath.startsWith('editor/')) return 'editor';
    if (relativePath.startsWith('prototypes/vehicle-lab/')) return 'vehicle-lab';
    if (relativePath.startsWith('electron/')) {
        const baseName = path.basename(relativePath).toLowerCase();
        if (baseName.includes('preload')) return 'electron-preload';
        if (relativePath.includes('/ui/') || relativePath.includes('/tuning-console/')) return 'electron-renderer';
        return 'electron-main';
    }
    if (!relativePath.startsWith('src/')) return 'external';
    const [, layer = 'other'] = relativePath.split('/');
    return layer;
}

function collectImportEdges(rootDir, filesByRelativePath) {
    const edges = [];
    for (const [relativePath, text] of filesByRelativePath.entries()) {
        const absolutePath = path.join(rootDir, relativePath);
        for (const match of text.matchAll(LOCAL_IMPORT_PATTERN)) {
            const specifier = String(match[1] || '');
            if (!specifier.startsWith('.')) continue;
            const target = resolveImportTarget(rootDir, absolutePath, specifier);
            const line = countLineNumber(text, match.index || 0);
            edges.push({
                from: relativePath,
                to: target,
                specifier,
                line,
                kind: 'static',
                isDynamic: false,
                fromLayer: resolveLayer(relativePath),
                toLayer: resolveLayer(target),
            });
        }
        for (const match of text.matchAll(DYNAMIC_IMPORT_PATTERN)) {
            const specifier = String(match[1] || '');
            if (!specifier.startsWith('.')) continue;
            const target = resolveImportTarget(rootDir, absolutePath, specifier);
            const line = countLineNumber(text, match.index || 0);
            edges.push({
                from: relativePath,
                to: target,
                specifier,
                line,
                kind: 'dynamic',
                isDynamic: true,
                fromLayer: resolveLayer(relativePath),
                toLayer: resolveLayer(target),
            });
        }
        for (const match of text.matchAll(COMMONJS_REQUIRE_PATTERN)) {
            const specifier = String(match[1] || '');
            if (!specifier.startsWith('.')) continue;
            const target = resolveImportTarget(rootDir, absolutePath, specifier);
            const line = countLineNumber(text, match.index || 0);
            edges.push({
                from: relativePath,
                to: target,
                specifier,
                line,
                kind: 'require',
                isDynamic: false,
                fromLayer: resolveLayer(relativePath),
                toLayer: resolveLayer(target),
            });
        }
        for (const match of text.matchAll(EXPORT_FROM_PATTERN)) {
            const specifier = String(match[1] || '');
            if (!specifier.startsWith('.')) continue;
            const target = resolveImportTarget(rootDir, absolutePath, specifier);
            const line = countLineNumber(text, match.index || 0);
            edges.push({
                from: relativePath,
                to: target,
                specifier,
                line,
                kind: 're-export',
                isDynamic: false,
                fromLayer: resolveLayer(relativePath),
                toLayer: resolveLayer(target),
            });
        }
    }
    return edges;
}

function collectPatternMatches({
    filesByRelativePath,
    pattern,
    matcherName,
    allowFileMap = null,
    uiOnly = false,
    includeFile = null,
}) {
    const matches = [];
    for (const [relativePath, text] of filesByRelativePath.entries()) {
        if (includeFile && !includeFile(relativePath)) continue;
        if (uiOnly && relativePath.startsWith('src/ui/')) continue;
        for (const match of text.matchAll(pattern)) {
            const line = countLineNumber(text, match.index || 0);
            const allowedReason = allowFileMap?.get(relativePath) || null;
            matches.push({
                file: relativePath,
                line,
                match: match[0],
                kind: matcherName,
                allowed: !!allowedReason,
                reason: allowedReason,
                snippet: readLineAt(text, line),
            });
        }
    }
    return matches;
}

function collectConstructorGameMatches(filesByRelativePath) {
    const constructorMatches = collectPatternMatches({
        filesByRelativePath,
        pattern: CONSTRUCTOR_GAME_PATTERN,
        matcherName: 'constructor(game)',
        allowFileMap: LEGACY_CONSTRUCTOR_GAME_ALLOWLIST,
    });
    const assignmentMatches = collectPatternMatches({
        filesByRelativePath,
        pattern: THIS_GAME_EQUALS_GAME_PATTERN,
        matcherName: 'this.game = game',
        allowFileMap: LEGACY_CONSTRUCTOR_GAME_ALLOWLIST,
    });
    return [...constructorMatches, ...assignmentMatches].sort((left, right) => {
        if (left.file === right.file) return left.line - right.line;
        return left.file.localeCompare(right.file, 'en');
    });
}

function collectConfigWrites(filesByRelativePath) {
    return collectPatternMatches({
        filesByRelativePath,
        pattern: CONFIG_WRITE_PATTERN,
        matcherName: 'CONFIG write',
    });
}

function collectDomAccesses(filesByRelativePath) {
    return collectPatternMatches({
        filesByRelativePath,
        pattern: DOCUMENT_ACCESS_PATTERN,
        matcherName: 'document access',
        allowFileMap: LEGACY_DOM_ACCESS_ALLOWLIST,
        uiOnly: true,
        includeFile: (relativePath) => relativePath.startsWith('src/'),
    });
}

function collectElectronSurfaceMatches(filesByRelativePath) {
    const preloadExposures = [];
    const ipcRendererChannels = [];
    const ipcMainChannels = [];

    for (const [relativePath, text] of filesByRelativePath.entries()) {
        if (!relativePath.startsWith('electron/')) continue;

        for (const match of text.matchAll(ELECTRON_CONTEXT_BRIDGE_EXPOSURE_PATTERN)) {
            const line = countLineNumber(text, match.index || 0);
            preloadExposures.push({
                file: relativePath,
                line,
                kind: 'contextBridge.exposeInMainWorld',
                exposedName: String(match[1] || ''),
                snippet: readLineAt(text, line),
            });
        }

        for (const match of text.matchAll(ELECTRON_IPC_RENDERER_CHANNEL_PATTERN)) {
            const line = countLineNumber(text, match.index || 0);
            ipcRendererChannels.push({
                file: relativePath,
                line,
                kind: `ipcRenderer.${String(match[1] || '')}`,
                channel: String(match[2] || ''),
                snippet: readLineAt(text, line),
            });
        }

        for (const match of text.matchAll(ELECTRON_IPC_MAIN_CHANNEL_PATTERN)) {
            const line = countLineNumber(text, match.index || 0);
            ipcMainChannels.push({
                file: relativePath,
                line,
                kind: `ipcMain.${String(match[1] || '')}`,
                channel: String(match[2] || ''),
                snippet: readLineAt(text, line),
            });
        }
    }

    return {
        preloadExposures,
        ipcRendererChannels,
        ipcMainChannels,
    };
}

function classifyEdgeViolations(edges) {
    const coreToUiImports = [];
    const uiToCoreImports = [];
    const uiToStateImports = [];
    const stateToUiImports = [];
    const entitiesToCoreImports = [];
    const stateToCoreImports = [];
    const sharedContractsToCoreImports = [];
    const applicationToUiImports = [];
    const applicationToCoreImports = [];
    const applicationToPlatformImports = [];
    const sharedContractsToImplementationImports = [];
    const coreToUiCompositionImports = [];

    for (const edge of edges) {
        if (edge.from.startsWith('src/core/') && edge.to.startsWith('src/ui/')) {
            const reason = LEGACY_CORE_TO_UI_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            coreToUiImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/ui/') && edge.to.startsWith('src/core/')) {
            const reason = LEGACY_UI_TO_CORE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            uiToCoreImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/ui/') && edge.to.startsWith('src/state/')) {
            const reason = LEGACY_UI_TO_STATE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            uiToStateImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/state/') && edge.to.startsWith('src/ui/')) {
            const reason = LEGACY_STATE_TO_UI_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            stateToUiImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/entities/') && edge.to.startsWith('src/core/')) {
            const reason = LEGACY_ENTITIES_TO_CORE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            entitiesToCoreImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/state/') && edge.to.startsWith('src/core/')) {
            const reason = LEGACY_STATE_TO_CORE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            stateToCoreImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/shared/contracts/') && edge.to.startsWith('src/core/')) {
            const reason = LEGACY_SHARED_CONTRACTS_TO_CORE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            sharedContractsToCoreImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/application/') && edge.to.startsWith('src/ui/')) {
            const reason = LEGACY_APPLICATION_TO_UI_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            applicationToUiImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/application/') && edge.to.startsWith('src/core/')) {
            const reason = LEGACY_APPLICATION_TO_CORE_IMPORTS.get(createEdgeKey(edge.from, edge.to)) || null;
            applicationToCoreImports.push({
                ...edge,
                allowed: !!reason,
                reason,
            });
        }
        if (edge.from.startsWith('src/application/') && edge.to.startsWith('src/platform/')) {
            applicationToPlatformImports.push({
                ...edge,
                allowed: false,
                reason: null,
            });
        }
        if (
            edge.from.startsWith('src/shared/contracts/')
            && edge.to.startsWith('src/')
            && !edge.to.startsWith('src/shared/')
            && !edge.to.startsWith('src/utils/')
        ) {
            sharedContractsToImplementationImports.push({
                ...edge,
                allowed: false,
                reason: null,
            });
        }
        if (edge.from.startsWith('src/core/') && edge.to.startsWith('src/composition/core-ui/')) {
            coreToUiCompositionImports.push({
                ...edge,
                allowed: true,
                reason: 'tracked core-ui composition seam',
            });
        }
    }

    return {
        coreToUiImports,
        uiToCoreImports,
        uiToStateImports,
        stateToUiImports,
        entitiesToCoreImports,
        stateToCoreImports,
        sharedContractsToCoreImports,
        applicationToUiImports,
        applicationToCoreImports,
        applicationToPlatformImports,
        sharedContractsToImplementationImports,
        coreToUiCompositionImports,
    };
}

function collectFileSizes(filesByRelativePath) {
    const fileSizes = [];
    for (const [relativePath, text] of filesByRelativePath.entries()) {
        const lineCount = text.split(/\r?\n/).length;
        fileSizes.push({
            file: relativePath,
            lines: lineCount,
        });
    }
    fileSizes.sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file, 'en'));
    return fileSizes;
}

function summarizeFiles(entries) {
    return [...new Set(entries.map((entry) => entry.file))].sort((left, right) => left.localeCompare(right, 'en'));
}

function summarizeEdges(entries) {
    return [...new Set(entries.map((entry) => createEdgeKey(entry.from, entry.to)))].sort((left, right) => left.localeCompare(right, 'en'));
}

function summarizeValues(entries, key) {
    return [...new Set(entries.map((entry) => entry[key]).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'en'));
}

function buildLayerEdgeSummary(edges) {
    const summary = new Map();
    for (const edge of edges) {
        const key = `${edge.fromLayer} -> ${edge.toLayer}`;
        summary.set(key, (summary.get(key) || 0) + 1);
    }
    return [...summary.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
        .map(([pair, count]) => ({ pair, count }));
}

export function collectArchitectureReport(rootDir = process.cwd()) {
    const sourceFiles = getSourceFiles(rootDir);
    const filesByRelativePath = new Map(sourceFiles.map((absolutePath) => {
        const relativePath = normalizePath(path.relative(rootDir, absolutePath));
        return [relativePath, readFileSync(absolutePath, 'utf8')];
    }));

    const importEdges = collectImportEdges(rootDir, filesByRelativePath);
    const {
        coreToUiImports,
        uiToCoreImports,
        uiToStateImports,
        stateToUiImports,
        entitiesToCoreImports,
        stateToCoreImports,
        sharedContractsToCoreImports,
        applicationToUiImports,
        applicationToCoreImports,
        applicationToPlatformImports,
        sharedContractsToImplementationImports,
        coreToUiCompositionImports,
    } = classifyEdgeViolations(importEdges);
    const constructorGameMatches = collectConstructorGameMatches(filesByRelativePath);
    const configWrites = collectConfigWrites(filesByRelativePath);
    const domAccessesOutsideUi = collectDomAccesses(filesByRelativePath);
    const electronSurfaces = collectElectronSurfaceMatches(filesByRelativePath);
    const fileSizes = collectFileSizes(filesByRelativePath);
    const guardMatrix = loadGuardMatrix(rootDir);
    const legacySurfaceReads = collectLegacySurfaceFindings(filesByRelativePath, guardMatrix);

    const report = {
        generatedAt: new Date().toISOString(),
        sourceFileCount: sourceFiles.length,
        targets: ARCHITECTURE_SCORECARD_TARGETS,
        budgets: ARCHITECTURE_SCORECARD_BUDGETS,
        boundaryMatrix: BOUNDARY_MATRIX,
        findings: {
            configWrites,
            constructorGameMatches,
            domAccessesOutsideUi,
            coreToUiImports,
            uiToCoreImports,
            uiToStateImports,
            stateToUiImports,
            entitiesToCoreImports,
            stateToCoreImports,
            sharedContractsToCoreImports,
            applicationToUiImports,
            applicationToCoreImports,
            applicationToPlatformImports,
            sharedContractsToImplementationImports,
            coreToUiCompositionImports,
            legacySurfaceReads,
            electronPreloadExposures: electronSurfaces.preloadExposures,
            electronIpcRendererChannels: electronSurfaces.ipcRendererChannels,
            electronIpcMainChannels: electronSurfaces.ipcMainChannels,
        },
        importGraph: {
            localEdgeCount: importEdges.length,
            layerEdges: buildLayerEdgeSummary(importEdges),
        },
        fileSizes: {
            largestFiles: fileSizes.slice(0, 12),
            over500Lines: fileSizes.filter((entry) => entry.lines > 500),
        },
    };

    report.scorecard = {
        configWrites: {
            total: configWrites.length,
        },
        constructorGame: {
            totalOccurrences: constructorGameMatches.length,
            totalFiles: summarizeFiles(constructorGameMatches).length,
            disallowedOccurrences: constructorGameMatches.filter((entry) => !entry.allowed).length,
            disallowedFiles: summarizeFiles(constructorGameMatches.filter((entry) => !entry.allowed)).length,
            legacyFiles: summarizeFiles(constructorGameMatches.filter((entry) => entry.allowed)),
        },
        domAccessOutsideUi: {
            totalOccurrences: domAccessesOutsideUi.length,
            totalFiles: summarizeFiles(domAccessesOutsideUi).length,
            disallowedOccurrences: domAccessesOutsideUi.filter((entry) => !entry.allowed).length,
            disallowedFiles: summarizeFiles(domAccessesOutsideUi.filter((entry) => !entry.allowed)).length,
            legacyFiles: summarizeFiles(domAccessesOutsideUi.filter((entry) => entry.allowed)),
        },
        coreToUiImports: {
            totalEdges: coreToUiImports.length,
            disallowedEdges: coreToUiImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(coreToUiImports.filter((entry) => entry.allowed)),
        },
        uiToCoreImports: {
            totalEdges: uiToCoreImports.length,
            disallowedEdges: uiToCoreImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(uiToCoreImports.filter((entry) => entry.allowed)),
        },
        uiToStateImports: {
            totalEdges: uiToStateImports.length,
            disallowedEdges: uiToStateImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(uiToStateImports.filter((entry) => entry.allowed)),
        },
        stateToUiImports: {
            totalEdges: stateToUiImports.length,
            disallowedEdges: stateToUiImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(stateToUiImports.filter((entry) => entry.allowed)),
        },
        entitiesToCoreImports: {
            totalEdges: entitiesToCoreImports.length,
            disallowedEdges: entitiesToCoreImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(entitiesToCoreImports.filter((entry) => entry.allowed)),
        },
        stateToCoreImports: {
            totalEdges: stateToCoreImports.length,
            disallowedEdges: stateToCoreImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(stateToCoreImports.filter((entry) => entry.allowed)),
        },
        sharedContractsToCoreImports: {
            totalEdges: sharedContractsToCoreImports.length,
            disallowedEdges: sharedContractsToCoreImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(sharedContractsToCoreImports.filter((entry) => entry.allowed)),
        },
        applicationToUiImports: {
            totalEdges: applicationToUiImports.length,
            disallowedEdges: applicationToUiImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(applicationToUiImports.filter((entry) => entry.allowed)),
        },
        applicationToCoreImports: {
            totalEdges: applicationToCoreImports.length,
            disallowedEdges: applicationToCoreImports.filter((entry) => !entry.allowed).length,
            legacyEdges: summarizeEdges(applicationToCoreImports.filter((entry) => entry.allowed)),
        },
        applicationToPlatformImports: {
            totalEdges: applicationToPlatformImports.length,
            disallowedEdges: applicationToPlatformImports.length,
            legacyEdges: [],
        },
        sharedContractsToImplementationImports: {
            totalEdges: sharedContractsToImplementationImports.length,
            disallowedEdges: sharedContractsToImplementationImports.length,
            legacyEdges: [],
        },
        coreToUiCompositionImports: {
            totalEdges: coreToUiCompositionImports.length,
            disallowedEdges: 0,
            legacyEdges: summarizeEdges(coreToUiCompositionImports),
        },
        electronPreloadExposures: {
            totalOccurrences: electronSurfaces.preloadExposures.length,
            totalFiles: summarizeFiles(electronSurfaces.preloadExposures).length,
            exposedNames: summarizeValues(electronSurfaces.preloadExposures, 'exposedName'),
        },
        electronIpcRendererChannels: {
            totalOccurrences: electronSurfaces.ipcRendererChannels.length,
            totalFiles: summarizeFiles(electronSurfaces.ipcRendererChannels).length,
            channels: summarizeValues(electronSurfaces.ipcRendererChannels, 'channel'),
        },
        electronIpcMainChannels: {
            totalOccurrences: electronSurfaces.ipcMainChannels.length,
            totalFiles: summarizeFiles(electronSurfaces.ipcMainChannels).length,
            channels: summarizeValues(electronSurfaces.ipcMainChannels, 'channel'),
        },
        legacySurfaces: summarizeLegacySurfaceScorecard(legacySurfaceReads, guardMatrix),
    };

    return report;
}

function formatList(entries, formatter) {
    if (!entries || entries.length === 0) return '  - none';
    return entries.map((entry) => `  - ${formatter(entry)}`).join('\n');
}

export function formatArchitectureReport(report) {
    const lines = [];
    lines.push('Architecture Scorecard');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Source files: ${report.sourceFileCount}`);
    lines.push('');
    lines.push(`CONFIG writes: ${report.scorecard.configWrites.total} (target ${report.targets.configWrites})`);
    lines.push(`constructor(game)/this.game = game: ${report.scorecard.constructorGame.totalOccurrences} across ${report.scorecard.constructorGame.totalFiles} files (${report.scorecard.constructorGame.disallowedFiles} disallowed files)`);
    lines.push(`DOM outside src/ui: ${report.scorecard.domAccessOutsideUi.totalOccurrences} across ${report.scorecard.domAccessOutsideUi.totalFiles} files (${report.scorecard.domAccessOutsideUi.disallowedFiles} disallowed files)`);
    lines.push(`core -> ui imports: ${report.scorecard.coreToUiImports.totalEdges} edges (${report.scorecard.coreToUiImports.disallowedEdges} disallowed)`);
    lines.push(`ui -> core imports: ${report.scorecard.uiToCoreImports.totalEdges} edges (${report.scorecard.uiToCoreImports.disallowedEdges} disallowed)`);
    lines.push(`ui -> state imports: ${report.scorecard.uiToStateImports.totalEdges} edges (${report.scorecard.uiToStateImports.disallowedEdges} disallowed)`);
    lines.push(`state -> ui imports: ${report.scorecard.stateToUiImports.totalEdges} edges (${report.scorecard.stateToUiImports.disallowedEdges} disallowed)`);
    lines.push(`entities -> core imports: ${report.scorecard.entitiesToCoreImports.totalEdges} edges (${report.scorecard.entitiesToCoreImports.disallowedEdges} disallowed)`);
    lines.push(`state -> core imports: ${report.scorecard.stateToCoreImports.totalEdges} edges (${report.scorecard.stateToCoreImports.disallowedEdges} disallowed)`);
    lines.push(`shared/contracts -> core imports: ${report.scorecard.sharedContractsToCoreImports.totalEdges} edges (${report.scorecard.sharedContractsToCoreImports.disallowedEdges} disallowed)`);
    lines.push(`application -> ui imports: ${report.scorecard.applicationToUiImports.totalEdges} edges (${report.scorecard.applicationToUiImports.disallowedEdges} disallowed)`);
    lines.push(`application -> core imports: ${report.scorecard.applicationToCoreImports.totalEdges} edges (${report.scorecard.applicationToCoreImports.disallowedEdges} disallowed)`);
    lines.push(`application -> platform imports: ${report.scorecard.applicationToPlatformImports.totalEdges} edges (${report.scorecard.applicationToPlatformImports.disallowedEdges} disallowed)`);
    lines.push(`shared/contracts -> implementation imports: ${report.scorecard.sharedContractsToImplementationImports.totalEdges} edges (${report.scorecard.sharedContractsToImplementationImports.disallowedEdges} disallowed)`);
    lines.push(`core -> composition/core-ui imports: ${report.scorecard.coreToUiCompositionImports.totalEdges} tracked edges`);
    lines.push(`electron preload exposures: ${report.scorecard.electronPreloadExposures.totalOccurrences} across ${report.scorecard.electronPreloadExposures.totalFiles} files`);
    lines.push(`electron ipcRenderer channels: ${report.scorecard.electronIpcRendererChannels.totalOccurrences} across ${report.scorecard.electronIpcRendererChannels.totalFiles} files`);
    lines.push(`electron ipcMain channels: ${report.scorecard.electronIpcMainChannels.totalOccurrences} across ${report.scorecard.electronIpcMainChannels.totalFiles} files`);
    if (report.boundaryMatrix?.edgeDirections) {
        lines.push('');
        lines.push(`Boundary matrix (${report.boundaryMatrix.sourceBlock}):`);
        for (const direction of Object.values(report.boundaryMatrix.edgeDirections)) {
            lines.push(`  - ${direction.edge}: ${direction.status}; budget ${direction.currentBudgetKey}; target ${direction.targetPhase}`);
        }
    }
    if (report.scorecard.legacySurfaces && Object.keys(report.scorecard.legacySurfaces).length > 0) {
        lines.push('');
        lines.push('Legacy-surface usage (guard-matrix, forbiddenForNewWork):');
        for (const [surfaceId, data] of Object.entries(report.scorecard.legacySurfaces)) {
            const status = data.disallowedFiles > 0 ? 'VIOLATION' : 'OK';
            lines.push(`  - ${status}: ${surfaceId} = ${data.totalFiles} files (${data.disallowedFiles} disallowed)`);
        }
    }
    lines.push('');
    lines.push('Largest scanned files:');
    lines.push(formatList(report.fileSizes.largestFiles.slice(0, 8), (entry) => `${entry.file} (${entry.lines} lines)`));
    lines.push('');
    lines.push('Top local layer edges:');
    lines.push(formatList(report.importGraph.layerEdges.slice(0, 8), (entry) => `${entry.pair}: ${entry.count}`));
    return lines.join('\n');
}
