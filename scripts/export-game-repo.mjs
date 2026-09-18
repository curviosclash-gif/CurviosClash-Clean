import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    GAME_EXPORT_FORBIDDEN_PATH_PATTERNS,
    GAME_EXPORT_SCHEMA_VERSION,
    GAME_EXPORT_TEMPLATE_MAPPINGS,
    isGameExportSourcePath,
} from './game-export-contract.mjs';

function readOption(name, fallback = '') {
    const prefix = `--${name}=`;
    const inline = process.argv.find((argument) => argument.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function git(args, options = {}) {
    return execFileSync('git', args, {
        cwd: process.cwd(),
        encoding: options.encoding ?? 'utf8',
        maxBuffer: 1024 * 1024 * 512,
        ...options,
    });
}

function replaceRequired(source, search, replacement, label) {
    assert.equal(source.includes(search), true, `Game export transform drifted: ${label}`);
    return source.replace(search, replacement);
}

function replacePatternRequired(source, pattern, replacement, label) {
    const result = source.replace(pattern, replacement);
    assert.notEqual(result, source, `Game export transform drifted: ${label}`);
    return result;
}

function transformCoreMain(source) {
    let result = source;
    result = replaceRequired(result, "from './PlaytestLaunchParams.js';", "from '../product/GameDistributionToolingAdapter.js';", 'playtest launch adapter');
    result = replaceRequired(result, "from './PlaytestReturnControl.js';", "from '../product/GameDistributionToolingAdapter.js';", 'playtest return adapter');
    result = replaceRequired(result, "from '../dev/tuning/TuningRuntimeIpcBridge.js';", "from '../product/GameDistributionToolingAdapter.js';", 'tuning adapter');
    assert.doesNotMatch(result, /(?:\.\.\/dev\/tuning|\.\/PlaytestLaunchParams|\.\/PlaytestReturnControl)/);
    return result;
}

function transformUiManager(source) {
    return replaceRequired(
        source,
        "from './menu/MenuDeveloperStateSync.js';",
        "from '../product/GameDistributionToolingAdapter.js';",
        'developer UI adapter'
    );
}

export function transformMenuDevPanelBindings(source) {
    const result = replaceRequired(
        source,
        "from './MenuDeveloperStateSync.js';",
        "from '../../product/GameDistributionToolingAdapter.js';",
        'developer menu binding adapter'
    );
    assert.doesNotMatch(result, /MenuDeveloperStateSync/);
    return result;
}

function transformSettingsManager(source) {
    return replaceRequired(
        source,
        "from '../state/AuthoringTelemetryStore.js';",
        "from '../product/GameDistributionToolingAdapter.js';",
        'authoring telemetry adapter'
    );
}

export function transformElectronMain(source) {
    let result = source;
    result = replaceRequired(result, ', globalShortcut, session', '', 'Electron authoring APIs');
    result = result.replace("const { createTuningWindowController } = require('./tuning-window.cjs');\n", '');
    result = result.replace("const { registerTuningIpc } = require('./tuning-ipc.cjs');\n", '');
    result = replacePatternRequired(
        result,
        /const \{\n    createEditorWindowOpenHandler,\n    createPlaytestWindowOpenHandler,\n    createSecureWindowWebPreferences,\n    isTrustedEditorUrl,\n\} = require\('\.\/window-security-options\.cjs'\);/,
        "const { createSecureWindowWebPreferences } = require('./window-security-options.cjs');",
        'editor window security imports'
    );
    result = replaceRequired(
        result,
        "const { installEditorDownloadTarget } = require('./editor-download-target.cjs');\n",
        '',
        'editor download target import'
    );
    result = replaceRequired(
        result,
        "const { installEditorUnloadGuard } = require('./editor-unload-guard.cjs');\n",
        '',
        'editor unload guard import'
    );
    result = replaceRequired(
        result,
        "const { createFocusScopedShortcut } = require('./focus-scoped-shortcut.cjs');\n",
        '',
        'focus scoped shortcut import'
    );
    result = replaceRequired(
        result,
        "const { createEditorVehicleStore } = require('./editor-vehicle-store.cjs');\n",
        '',
        'editor vehicle store import'
    );
    result = replaceRequired(
        result,
        "const { createEditorMapStore } = require('./editor-map-store.cjs');\n",
        '',
        'editor map store import'
    );
    result = replaceRequired(result, '    UNTRUSTED_IPC_SENDER_CODE,\n', '', 'editor sender error import');
    result = replacePatternRequired(
        result,
        /\n\/\/ Autorenfenster[\s\S]*?\nfunction withTrustedHangarWindowSender/,
        '\nfunction withTrustedHangarWindowSender',
        'editor window sender guard'
    );
    result = result.replace('let disposeTuningIpc = null;\n', '');
    result = result.replace(/const TUNING_CONSOLE_CAPABILITY_CONTRACT_VERSION[\s\S]*?const TUNING_CONSOLE_HOTKEY = 'F7';\n/, '');
    result = replacePatternRequired(
        result,
        /    installEditorDownloadTarget\(session\.defaultSession,[\s\S]*?    \}\);\n    await mainWindow\.loadURL/,
        "    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));\n    await mainWindow.loadURL",
        'editor and playtest window creation'
    );
    result = result.replace(/\nfunction resolveTuningConsoleCapabilityState\(\) \{[\s\S]*?\n\}\n\nfunction resolveSharedMenuDefaults/, '\nfunction resolveSharedMenuDefaults');
    result = result.replace(/\nconst tuningWindowShellCapability = createTuningWindowController\([\s\S]*?\n\}\);\nconst recordingVideoExportJob/, '\nconst recordingVideoExportJob');
    result = result.replace(/\n\/\/ The tuning hotkey is a system-wide accelerator[\s\S]*?\n\}\);\n\nfunction registerTuningShortcut/, '\nfunction registerTuningShortcut');
    result = result.replace(/\nfunction registerTuningShortcut\(\) \{[\s\S]*?\nasync function startDesktopShell\(\) \{\n    registerTuningBridgeIpc\(\);\n    await desktopWindowShellCapability\.start\(\);\n    createTray\(\);\n    registerTuningShortcut\(\);\n\}/, '\nasync function startDesktopShell() {\n    await desktopWindowShellCapability.start();\n    createTray();\n}');
    result = result.replace(/\n    unregisterTuningShortcut\(\);\n    tuningWindowShellCapability\.closeTuningWindow\(\);/g, '');
    result = result.replace(/\n    disposeTuningBridgeIpc\(\);/g, '');
    result = replacePatternRequired(
        result,
        /\nconst editorVehicleStore = createEditorVehicleStore\([\s\S]*?\n\}\)\);\n\nipcMain\.handle\('get-lan-server-status'/,
        "\nipcMain.handle('get-lan-server-status'",
        'editor vehicle store IPC'
    );
    assert.doesNotMatch(result, /editor|playtest|tuning|globalShortcut/i);
    return result;
}

function transformElectronPreload(source) {
    let result = source;
    result = result.replace("    tuningRuntime: 'preload.tuning-runtime.v1',\n", '');
    result = result.replace(/const TUNING_RUNTIME_REQUEST_CHANNEL[\s\S]*?const TUNING_RUNTIME_RESPONSE_CHANNEL = 'tuning-runtime:response';\n/, '');
    result = result.replace(/\nfunction createTuningRuntimeContract\(\) \{[\s\S]*?\n\}\n\nconst discoveryContract/, '\nconst discoveryContract');
    result = result.replace('const tuningRuntimeContract = createTuningRuntimeContract();\n', '');
    result = result.replace(/    tuningRuntime: tuningRuntimeContract,\n/g, '');
    assert.doesNotMatch(result, /tuning|TUNING/i);
    return result;
}

function transformIndexHtml(source) {
    let result = source;
    result = result.replace(/\s*<button type="button" id="btn-open-expert"[\s\S]*?<\/button>\s*<button type="button" id="btn-expert-lock-quick"[\s\S]*?<\/button>/, '');
    result = result.replace(/\s*<div class="btn-group secondary-btn-spaced">\s*<button type="button" id="btn-open-editor"[\s\S]*?<\/div>/, '');
    result = result.replace(/\s*<!-- ======= SUBMENU: EXPERT ======= -->[\s\S]*?<!-- ======= SUBMENU: BENUTZERDEFINIERT ======= -->/, '\n                <!-- ======= SUBMENU: BENUTZERDEFINIERT ======= -->');
    result = result.replace(/\s*<!-- ======= SUBMENU: DEBUG \/ INFO ======= -->[\s\S]*?(?=\s*<!-- ======= SUBMENU:)/, '');
    return result;
}

function transformGameFile(relativePath, source) {
    if (relativePath === 'src/core/main.js') return transformCoreMain(source);
    if (relativePath === 'src/ui/UIManager.js') return transformUiManager(source);
    if (relativePath === 'src/ui/menu/MenuDevPanelBindings.js') return transformMenuDevPanelBindings(source);
    if (relativePath === 'src/core/SettingsManager.js') return transformSettingsManager(source);
    if (relativePath === 'src/shared/storage/StorageKeys.js') {
        return source.replace(
            "../contracts/AuthoringTelemetryContract.js",
            '../../product/GameDistributionToolingAdapter.js'
        );
    }
    if (relativePath === 'electron/main.cjs') return transformElectronMain(source);
    if (relativePath === 'electron/preload.cjs') return transformElectronPreload(source);
    if (relativePath === 'index.html') return transformIndexHtml(source);
    if (relativePath === 'src/entities/runtime-modular-vehicle-mesh.js') {
        return source.replace("../shared/vehicle-lab/ModularVehicleMeshBridge.js", './ModularVehicleMesh.js');
    }
    return source;
}

async function assertEmptyOrMissing(directory) {
    if (!existsSync(directory)) return;
    const entries = await readdir(directory);
    assert.equal(entries.length, 0, `Export output must be empty: ${directory}`);
}

export async function exportGameRepository({ commit, outputDirectory }) {
    const resolvedCommit = git(['rev-parse', `${commit}^{commit}`]).trim();
    const trackedPaths = git(['ls-tree', '-r', '--name-only', resolvedCommit])
        .split(/\r?\n/)
        .filter(Boolean);
    const allowedPaths = trackedPaths.filter(isGameExportSourcePath);
    assert.ok(allowedPaths.length > 0, 'Game export allowlist selected no files.');

    const output = path.resolve(outputDirectory);
    await assertEmptyOrMissing(output);
    await mkdir(output, { recursive: true });

    const indexDirectory = await mkdtemp(path.join(os.tmpdir(), 'curvios-game-export-index-'));
    const temporaryIndex = path.join(indexDirectory, 'index');
    const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
    git(['read-tree', resolvedCommit], { env: environment });
    const disallowedPaths = trackedPaths.filter((trackedPath) => !allowedPaths.includes(trackedPath));
    const removeResult = spawnSync('git', ['update-index', '--force-remove', '-z', '--stdin'], {
        cwd: process.cwd(),
        env: environment,
        input: Buffer.from(`${disallowedPaths.join('\0')}\0`),
        maxBuffer: 1024 * 1024 * 64,
    });
    assert.equal(removeResult.status, 0, removeResult.stderr?.toString() || 'Unable to filter export index.');
    const prefix = `${output}${path.sep}`;
    git(['checkout-index', '--all', `--prefix=${prefix}`], { env: environment });

    for (const relativePath of allowedPaths) {
        if (!/\.(?:cjs|html|js|json|md|mjs|css)$/i.test(relativePath)) continue;
        const filePath = path.join(output, relativePath);
        const source = await readFile(filePath, 'utf8');
        const transformed = transformGameFile(relativePath, source);
        if (transformed !== source) await writeFile(filePath, transformed, 'utf8');
    }

    const modularVehicleSource = git(['show', `${resolvedCommit}:prototypes/vehicle-lab/src/ModularVehicleMesh.js`]);
    await writeFile(path.join(output, 'src/entities/ModularVehicleMesh.js'), modularVehicleSource, 'utf8');

    for (const [templatePath, destinationPath] of Object.entries(GAME_EXPORT_TEMPLATE_MAPPINGS)) {
        const content = git(['show', `${resolvedCommit}:${templatePath}`]);
        const destination = path.join(output, destinationPath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, 'utf8');
    }

    const metadata = {
        schemaVersion: GAME_EXPORT_SCHEMA_VERSION,
        sourceCommit: resolvedCommit,
        sourceRepository: 'curviosclash-gif/CurviosClash-Clean',
    };
    await writeFile(path.join(output, '.game-export.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    const files = [];
    async function visit(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name === '.git') continue;
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(entryPath);
            else files.push(path.relative(output, entryPath).replace(/\\/g, '/'));
        }
    }
    await visit(output);
    const forbiddenPath = files.find((candidate) => (
        GAME_EXPORT_FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(candidate))
    ));
    assert.equal(forbiddenPath, undefined, `Forbidden path reached game export: ${forbiddenPath}`);

    return { outputDirectory: output, sourceCommit: resolvedCommit, files };
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
    const commit = readOption('commit', 'HEAD');
    const outputDirectory = readOption('output');
    assert.ok(outputDirectory, 'Usage: npm run game:export -- --commit=<sha> --output=<empty-directory>');
    const result = await exportGameRepository({ commit, outputDirectory });
    console.log(JSON.stringify(result));
}
