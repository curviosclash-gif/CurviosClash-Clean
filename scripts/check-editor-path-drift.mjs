import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
    EDITOR_API_ROUTES,
    EDITOR_DATA_PATHS,
    EDITOR_VIEW_PATHS,
} from '../src/shared/contracts/EditorPathContract.js';

const REPO_ROOT = process.cwd();
const CONTRACT_FILE = 'src/shared/contracts/EditorPathContract.js';
const VEHICLE_LAB_BRIDGE_FILE = 'src/shared/vehicle-lab/ModularVehicleMeshBridge.js';
const SCAN_DIRECTORIES = Object.freeze([
    'src',
    'editor',
    'prototypes',
    'tests',
]);
const SCAN_FILE_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
]);
const EXPLICIT_SCAN_FILES = Object.freeze([
    'vite.config.js',
    'start_editor.bat',
    'start_editor_local.bat',
]);

const RULES = Object.freeze([
    {
        label: 'editor map view path',
        literal: EDITOR_VIEW_PATHS.MAP_EDITOR,
        allowedFiles: new Set([
            CONTRACT_FILE,
            'start_editor.bat',
            'start_editor_local.bat',
        ]),
    },
    {
        label: 'vehicle lab view path',
        literal: EDITOR_VIEW_PATHS.VEHICLE_LAB,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'save map disk api route',
        literal: EDITOR_API_ROUTES.SAVE_MAP_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'save vehicle disk api route',
        literal: EDITOR_API_ROUTES.SAVE_VEHICLE_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'list vehicles disk api route',
        literal: EDITOR_API_ROUTES.LIST_VEHICLES_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'get vehicle disk api route',
        literal: EDITOR_API_ROUTES.GET_VEHICLE_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'rename vehicle disk api route',
        literal: EDITOR_API_ROUTES.RENAME_VEHICLE_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'delete vehicle disk api route',
        literal: EDITOR_API_ROUTES.DELETE_VEHICLE_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'save video disk api route',
        literal: EDITOR_API_ROUTES.SAVE_VIDEO_DISK,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'maps data directory path',
        literal: EDITOR_DATA_PATHS.MAPS_DIR,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'vehicles data directory path',
        literal: EDITOR_DATA_PATHS.VEHICLES_DIR,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'generated local maps module path',
        literal: EDITOR_DATA_PATHS.GENERATED_LOCAL_MAPS_MODULE,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'generated vehicle configs module path',
        literal: EDITOR_DATA_PATHS.GENERATED_VEHICLE_CONFIGS_MODULE,
        allowedFiles: new Set([
            CONTRACT_FILE,
        ]),
    },
    {
        label: 'vehicle lab mesh module path',
        literal: 'prototypes/vehicle-lab/src/ModularVehicleMesh.js',
        allowedFiles: new Set([
            VEHICLE_LAB_BRIDGE_FILE,
        ]),
    },
]);

function normalizePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function collectFilesRecursively(relativeDirPath, outputFiles) {
    const absoluteDirPath = path.resolve(REPO_ROOT, relativeDirPath);
    const entries = readdirSync(absoluteDirPath, { withFileTypes: true });
    for (const entry of entries) {
        const absoluteEntryPath = path.join(absoluteDirPath, entry.name);
        const relativeEntryPath = normalizePath(path.relative(REPO_ROOT, absoluteEntryPath));
        if (entry.isDirectory()) {
            collectFilesRecursively(relativeEntryPath, outputFiles);
            continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!SCAN_FILE_EXTENSIONS.has(extension)) continue;
        outputFiles.add(relativeEntryPath);
    }
}

function resolveScanFiles() {
    const scanFiles = new Set();
    for (const directoryPath of SCAN_DIRECTORIES) {
        collectFilesRecursively(directoryPath, scanFiles);
    }
    for (const explicitFilePath of EXPLICIT_SCAN_FILES) {
        scanFiles.add(normalizePath(explicitFilePath));
    }
    return [...scanFiles].sort((left, right) => left.localeCompare(right));
}

function collectViolations(scanFiles) {
    const violations = [];
    for (const relativeFilePath of scanFiles) {
        const absoluteFilePath = path.resolve(REPO_ROOT, relativeFilePath);
        const sourceText = readFileSync(absoluteFilePath, 'utf8');
        for (const rule of RULES) {
            if (!sourceText.includes(rule.literal)) continue;
            if (rule.allowedFiles.has(relativeFilePath)) continue;
            violations.push({
                file: relativeFilePath,
                literal: rule.literal,
                label: rule.label,
            });
        }
    }
    return violations;
}

const scanFiles = resolveScanFiles();
const violations = collectViolations(scanFiles);

if (violations.length === 0) {
    console.log('Editor/game-area path drift guard passed.');
    console.log(`Scanned files: ${scanFiles.length}`);
    console.log(`Protected literals: ${RULES.length}`);
    process.exit(0);
}

console.error('Editor/game-area path drift guard failed.');
for (const violation of violations) {
    console.error(`- ${violation.label} leaked in ${violation.file}`);
    console.error(`  literal: ${violation.literal}`);
}
process.exit(1);
