#!/usr/bin/env node
// Maps changed paths to the verification commands CLAUDE.md declares mandatory.
//
// Why a script: that table is the only rule set in this repo that no tool enforces.
// Boundaries, ratchets and the commit format break the build by themselves; picking
// the right tests does not. Deriving it here keeps the choice reproducible instead of
// re-reasoned per task, and keeps `npm run quality` from becoming the lazy default.
//
// The output is split into three stages. The dividing line is the machine-wide Playwright
// lock: stage 1 never takes it and therefore fits into one agent turn, stage 2 takes it for
// a few minutes, stage 3 holds it for half an hour or more and belongs into the main session.
//
// Usage:
//   node select-verification.mjs                 # derive from git (warns about foreign changes)
//   node select-verification.mjs src/ui/Foo.js   # only the paths you actually touched
//   node select-verification.mjs --json          # machine readable
//   node select-verification.mjs --batch a b     # one stage-3 run for several branches (vs main)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    DESKTOP_E2E_CLUSTERS,
    DESKTOP_FLOWS_MAP_BOUND_SPECS,
} from '../../../../scripts/playwright-test-clusters.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PRESET_DIR = 'src/core/config/maps/presets/';
const CATALOG_FILE = 'src/core/config/maps/MapPresetCatalog.js';

/**
 * Which preset modules define each catalog map key, found by object identity: the catalog
 * imports every preset module, so a key belongs to every module whose export holds its object.
 * Null when the catalog cannot be loaded — callers then fall back to the whole cluster.
 */
async function loadCatalogOwners(repoRoot) {
    try {
        const catalogPath = path.join(repoRoot, CATALOG_FILE);
        const { MAP_PRESET_CATALOG } = await import(pathToFileURL(catalogPath).href);
        const source = fs.readFileSync(catalogPath, 'utf8');
        const owners = new Map();
        for (const match of source.matchAll(/import \{([^}]+)\} from '\.\/presets\/([^']+)'/g)) {
            const module = await import(pathToFileURL(path.join(repoRoot, PRESET_DIR, match[2])).href);
            const name = match[2].split('/')[0].replace(/\.js$/, '');
            for (const ident of match[1].split(',').map((entry) => entry.trim()).filter(Boolean)) {
                const value = module[ident];
                if (!value || typeof value !== 'object') continue;
                for (const [key, def] of Object.entries(MAP_PRESET_CATALOG)) {
                    if (def !== value && !Object.values(value).includes(def)) continue;
                    const set = owners.get(key) || new Set();
                    set.add(name);
                    owners.set(key, set);
                }
            }
        }
        return Object.keys(MAP_PRESET_CATALOG).every((key) => owners.has(key)) ? owners : null;
    } catch {
        return null;
    }
}

const CATALOG_OWNERS = await loadCatalogOwners(REPO_ROOT);

export const VERIFICATION_STAGES = Object.freeze({
    1: 'Stufe 1 — immer, im Agenten, vor jedem Commit (nimmt kein Playwright-Schloss)',
    2: 'Stufe 2 — gezielte Playwright-IDs des Bereichs, Richtwert unter 10 Minuten',
    3: 'Stufe 3 — ganze Cluster, nur in der Hauptsitzung, losgelöst gestartet',
});

/** Exit 75 (EX_TEMPFAIL) heißt: Schloss-Timeout, kein Testfehler. Später erneut starten. */
export const PLAYWRIGHT_LOCK_TIMEOUT_EXIT_CODE = 75;

// Lower rank runs first. Cheap and broad before slow and narrow, so a failure that
// invalidates everything else surfaces in seconds rather than after a Playwright run.
const RANK = {
    lint: 10,
    contractFast: 20,
    typecheck: 30,
    check: 40,
    coverage: 50,
    training: 60,
    council: 70,
    smoke: 80,
    clusters: 90,
    build: 100,
    dist: 110,
    packaged: 120,
    quality: 130,
};

const ALWAYS = [
    {
        command: 'node --test tests/<dein-test>.contract.test.mjs',
        rank: RANK.lint - 1,
        reason: 'der Test, der deine Änderung wirklich prüft — vor der Änderung rot, danach grün',
    },
    { command: 'npm run lint', rank: RANK.lint, reason: 'gilt immer (AGENTS.md 8)' },
    { command: 'npm run test:contract:fast', rank: RANK.contractFast, reason: 'Grundlast, gilt immer' },
];

// Stage 2 runs single tests by id instead of a whole cluster. The ids come from the spec
// files themselves; where a spec carries no ids, the spec path is named instead.
const SPEC_IDS = Object.freeze({
    physicsCore: { spec: 'tests/physics-core.spec.js', ids: ['T41', 'T42', 'T44', 'T46', 'T49'] },
    parcours: { spec: 'tests/physics-core.spec.js', ids: ['T60a', 'T60b', 'T60c', 'T60d', 'T60e', 'T60f'] },
    physicsHunt: { spec: 'tests/physics-hunt.spec.js', ids: ['T61', 'T83', 'T86'] },
    physicsPolicy: { spec: 'tests/physics-policy.spec.js', ids: ['T70', 'T72', 'T77'] },
    surface: { spec: 'tests/core-targeted-surface.spec.js', ids: ['T20kb', 'T20kc', 'T20kd', 'T20i', 'T20ha', 'T66a'] },
    // T20am2 moved to tests/arcade-run-regressions.contract.test.mjs (P3), so stage 2 names
    // T10b instead: it is the remaining test in this spec that plays a real match.
    runtime: { spec: 'tests/core-targeted-runtime.spec.js', ids: ['T20ab', 'T20ae3', 'T20ae4', 'T10b'] },
    shell: { spec: 'tests/core-targeted.spec.js', ids: ['T1', 'T4', 'T7', 'T10', 'T11'] },
    editor: { spec: 'tests/editor-map-ui.spec.js', ids: ['T65a', 'T65b', 'T65c', 'T65d'] },
    platform: { spec: 'tests/core-targeted-platform.spec.js', ids: [] },
    network: {
        spec: 'tests/network-adapter.spec.js',
        ids: [],
        note: 'Profil browser-compat: PowerShell $env:PW_RUN_PROFILE=\'browser-compat\' davorsetzen',
    },
    smoke: { spec: 'tests/core.spec.js', ids: [], note: 'kürzer als der Cluster: npm run test:desktop:smoke' },
});

/**
 * Every rule mirrors one row of the table in CLAUDE.md. `match` is deliberately
 * path-prefix based: it must stay obvious why a file triggered a command.
 */
const RULES = [
    {
        id: 'contracts',
        match: (p) => p.startsWith('src/shared/contracts/'),
        label: 'versionierte Datenverträge',
        commands: [{ command: 'npm run typecheck:contracts', rank: RANK.typecheck }],
    },
    {
        // Die Bereiche stehen in scripts/architecture/coverage-ratchet.json. Der Ratchet
        // misst sie alle gemeinsam, also kann auch eine Änderung in src/modes die Grenze
        // von src/shared/contracts nicht reißen — aber ihre eigene sehr wohl.
        id: 'coverage-areas',
        match: (p) => p.startsWith('src/shared/contracts/')
            || p.startsWith('src/state/')
            || p.startsWith('src/entities/systems/')
            || p.startsWith('src/modes/'),
        label: 'Bereich mit Coverage-Untergrenze',
        commands: [{
            command: 'npm run test:contract:coverage',
            rank: RANK.coverage,
            note: 'Untergrenzen je Bereich in scripts/architecture/coverage-ratchet.json',
        }],
    },
    {
        id: 'physics',
        match: (p) => p.startsWith('src/entities/') || p.startsWith('src/state/'),
        label: 'Kollision, Arena, Projektile, Rundenlogik',
        stage2: [SPEC_IDS.physicsCore, SPEC_IDS.physicsHunt, SPEC_IDS.physicsPolicy],
        clusters: ['physics-core', 'physics-hunt', 'physics-policy'],
    },
    {
        id: 'network',
        match: (p) => p.startsWith('src/network/') || p.startsWith('src/application/session-runtime/'),
        label: 'Netzwerk und Session-Runtime',
        commands: [{ command: 'npm run check:architecture', rank: RANK.check, note: 'Determinismus-Guard' }],
        stage2: [SPEC_IDS.network],
        clusters: ['network'],
    },
    {
        id: 'renderer',
        match: (p) => p.startsWith('src/core/renderer/')
            || p === 'src/entities/GLBMapLoader.js'
            || p.startsWith('src/core/config/maps/')
            || p.startsWith('assets/maps/'),
        label: 'Renderer, Map-Laden und Map-Presets',
        commands: [{ command: 'npm run test:desktop:smoke', rank: RANK.smoke, stage: 2 }],
        stage2: [SPEC_IDS.smoke],
        clusters: ['desktop-flows'],
        hint: 'Bei spürbarer Renderlast zusätzlich den Cluster gpu-stress.',
    },
    {
        id: 'parcours',
        match: (p) => p.startsWith('assets/maps/')
            || p.startsWith('data/maps/')
            || p === 'src/core/config/maps/MapPresetCatalog.js',
        label: 'Parcours-Maps und -Routen',
        commands: [{ command: 'npm run check:parcours', rank: RANK.check }],
        stage2: [SPEC_IDS.parcours],
    },
    {
        id: 'ui',
        match: (p) => p.startsWith('src/ui/'),
        label: 'DOM, HUD, Menü, Hangar',
        stage2: [SPEC_IDS.surface],
        clusters: ['core-surface', 'desktop-flows'],
        hint: 'Die Boundary-Regel ui→core schlägt hier zuerst zu; lint zuerst lesen.',
    },
    {
        id: 'modes',
        match: (p) => p.startsWith('src/modes/'),
        label: 'Spielmodi-Strategien',
        stage2: [SPEC_IDS.runtime],
        clusters: ['core-runtime', 'gameplay-smoke'],
    },
    {
        id: 'editor',
        match: (p) => p.startsWith('editor/'),
        label: 'Map- und Fahrzeug-Editor',
        commands: [{ command: 'npm run check:architecture', rank: RANK.check, note: 'Editor-Pfad-Drift' }],
        stage2: [SPEC_IDS.editor],
        clusters: ['editor'],
        hint: 'Alternativ zum Cluster: npm run test:editor-ui (eigene Playwright-Config).',
    },
    {
        id: 'electron',
        match: (p) => p.startsWith('electron/'),
        label: 'Desktop-Shell, Preload, IPC',
        commands: [
            { command: 'npm run build:app', rank: RANK.build },
            { command: 'npm run test:contract:dist', rank: RANK.dist },
        ],
        stage2: [SPEC_IDS.smoke, SPEC_IDS.shell],
    },
    {
        id: 'electron-package',
        match: (p) => p === 'electron/package.json'
            || p === 'electron/package-lock.json'
            || p.includes('electron-builder'),
        label: 'Electron-Paketdefinition',
        commands: [{ command: 'npm run app:package:verify', rank: RANK.packaged }],
    },
    {
        id: 'training',
        match: (p) => p.startsWith('dev/training/'),
        label: 'Bot-Training und Analyse',
        commands: [
            { command: 'npm run test:dev:training', rank: RANK.training },
            { command: 'npm run build', rank: RANK.build, note: 'prüft die Production-Training-Grenze' },
        ],
    },
    {
        id: 'mobile',
        match: (p) => p.startsWith('src/mobile-classic/') || p.startsWith('src/mobile-arcade/'),
        label: 'Mobile-Overrides',
        commands: [{ command: 'npm run app:android:check', rank: RANK.check }],
        stage2: [SPEC_IDS.platform],
    },
    {
        id: 'council',
        match: (p) => p.startsWith('.opencode/') || p.startsWith('scripts/council-'),
        label: 'Council-Infrastruktur',
        commands: [{ command: 'npm run council:validate', rank: RANK.council, note: 'Pflicht-Gate laut AGENTS.md 8' }],
    },
    {
        id: 'tooling',
        match: (p) => p.startsWith('scripts/architecture/')
            || p === 'eslint.config.js'
            || p === 'eslint.config.mjs'
            || /^tsconfig[.\w-]*\.json$/.test(p),
        label: 'Architektur- und Lint-Konfiguration',
        commands: [{ command: 'npm run quality', rank: RANK.quality, note: 'hier ausnahmsweise vollständig' }],
    },
];

function parseArgs(argv) {
    const paths = [];
    let json = false;
    let batch = false;
    let base = 'main';
    for (const raw of argv) {
        if (raw === '--json') json = true;
        else if (raw === '--batch') batch = true;
        else if (raw.startsWith('--base=')) base = raw.slice('--base='.length);
        else if (raw.startsWith('--')) continue;
        else paths.push(raw.replace(/\\/g, '/'));
    }
    return { paths, json, batch, base };
}

/** Paths a branch changed since it left `base` (three-dot diff: the branch side only). */
function changedOnBranch(base, branch) {
    const result = spawnSync('git', ['diff', '--name-only', `${base}...${branch}`], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
        throw new Error(`git diff ${base}...${branch} failed: ${String(result.stderr || '').trim()}`);
    }
    return result.stdout.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/\\/g, '/'));
}

function printBatchReport(base, plan) {
    const specCount = Object.keys(plan.suspectsBySpec).length;
    console.log(`Sammellauf gegen ${base}: ${plan.stage3Command ? `${plan.clusters.length} Cluster, ${specCount} einzelne desktop-flows-Specs` : 'kein Cluster nötig'}`);
    if (plan.stage3Command) {
        console.log(`\n${VERIFICATION_STAGES[3]} — einmal für alle Branches, im Integrations-Worktree, nacheinander`);
        for (const command of plan.stage3Command.split('\n')) console.log(`  ${command}`);
        console.log('  (losgelöst starten, CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS mindestens 7200000)');
        console.log('\nBei Rot kommen nur diese Branches in Frage:');
        for (const [target, branches] of [...Object.entries(plan.suspectsByCluster), ...Object.entries(plan.suspectsBySpec)]) {
            console.log(`  ${target}: ${branches.join(', ')}`);
        }
    }
    if (plan.withoutClusters.length > 0) {
        console.log(`\nOhne Cluster (Stufe 1+2 genügt): ${plan.withoutClusters.join(', ')}`);
    }
}

function changedFromGit() {
    const result = spawnSync('git', ['status', '--porcelain=v1', '-uall'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return [];
    return result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        // renames read as "old -> new"; the new path is what matters
        .map((entry) => (entry.includes(' -> ') ? entry.split(' -> ')[1] : entry))
        .map((entry) => entry.replace(/^"|"$/g, '').replace(/\\/g, '/'))
        .filter(Boolean);
}

/** One targeted Playwright call: ids become a --grep, a spec without ids is named as such. */
export function toStage2Command(target) {
    const ids = Array.isArray(target.ids) ? target.ids : [];
    const grep = ids.length > 0 ? ` --grep "${ids.map((id) => `${id}:`).join('|')}"` : '';
    return {
        command: `node scripts/run-playwright-targeted.mjs ${target.spec}${grep}`,
        rank: RANK.clusters - 1,
        stage: 2,
        reason: ids.length > 0
            ? `${ids.length} Test-IDs aus ${target.spec}`
            : `${target.spec} trägt keine Test-IDs — ganze Spec, nicht der Cluster`,
        note: target.note || '',
    };
}

function toStage3Command(clusters) {
    return `node scripts/run-playwright-targeted-clusters.mjs ${clusters.join(' ')} --skip-known`;
}

function toStage3SpecCommand(specs) {
    return `node scripts/run-playwright-targeted.mjs ${specs.join(' ')} --skip-known`;
}

/** `src/core/config/maps/presets/<name>(.js|/…)` → `<name>`, anything else → null. */
function presetNameOf(p) {
    if (!p.startsWith(PRESET_DIR)) return null;
    const first = p.slice(PRESET_DIR.length).split('/')[0];
    return first.replace(/\.js$/, '') || null;
}

function listFilesRecursive(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFilesRecursive(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const presetIndexCache = new Map();

/**
 * Reads the map presets once: which presets define each map key (from the catalog), which asset
 * packs each preset loads, and which other presets import it.
 */
export function collectPresetIndex(repoRoot = REPO_ROOT) {
    if (presetIndexCache.has(repoRoot)) return presetIndexCache.get(repoRoot);
    const presetRoot = path.join(repoRoot, PRESET_DIR);
    const presetNames = new Set();
    const keyToPresets = new Map([...(CATALOG_OWNERS || [])].map(([key, owners]) => [key, [...owners]]));
    const packToPresets = new Map();
    const importers = new Map();
    for (const file of listFilesRecursive(presetRoot)) {
        const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
        const name = presetNameOf(relative);
        presetNames.add(name);
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/assets\/maps\/([a-z0-9_]+)/g)) {
            const owners = packToPresets.get(match[1]) || new Set();
            owners.add(name);
            packToPresets.set(match[1], owners);
        }
        for (const match of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
            const target = presetNameOf(path.relative(repoRoot, path.resolve(path.dirname(file), match[1])).replace(/\\/g, '/'));
            if (!target || target === name) continue;
            const set = importers.get(target) || new Set();
            set.add(name);
            importers.set(target, set);
        }
    }
    const index = {
        catalogLoaded: CATALOG_OWNERS !== null,
        presetNames,
        keyToPresets,
        packToPresets: new Map([...packToPresets].map(([pack, owners]) => [pack, [...owners]])),
        importers,
    };
    presetIndexCache.set(repoRoot, index);
    return index;
}

const BOUND_PRESETS = new Set(Object.values(DESKTOP_FLOWS_MAP_BOUND_SPECS).flat());

/**
 * The presets a change to preset `name` reaches, or null when the change cannot be confined:
 * an unbound preset that defines maps, or an unbound preset that imports it.
 */
function presetsReachedBy(name, index) {
    const reached = new Set([name]);
    const queue = [name];
    while (queue.length > 0) {
        for (const importer of index.importers.get(queue.shift()) || []) {
            if (!reached.has(importer)) {
                reached.add(importer);
                queue.push(importer);
            }
        }
    }
    const definesMaps = [...index.keyToPresets.values()].some((owners) => owners.includes(name));
    const selfOk = BOUND_PRESETS.has(name) || (!definesMaps && reached.size > 1);
    const importersOk = [...reached].every((preset) => preset === name || BOUND_PRESETS.has(preset));
    return selfOk && importersOk ? reached : null;
}

/**
 * For paths that only pull in desktop-flows through map files: the bound specs of the reached
 * presets plus every unbound spec, in cluster order. Null means: run the whole cluster.
 */
export function resolveDesktopFlowsScope(paths, repoRoot = REPO_ROOT) {
    if (paths.length === 0) return null;
    const index = collectPresetIndex(repoRoot);
    if (!index.catalogLoaded) return null;
    const reached = new Set();
    for (const p of paths) {
        const preset = presetNameOf(p);
        const pack = /^assets\/maps\/([a-z0-9_]+)\//.exec(p)?.[1];
        const owners = preset ? [preset] : pack ? index.packToPresets.get(pack) || [] : [];
        if (owners.length === 0) return null;
        for (const owner of owners) {
            const presets = presetsReachedBy(owner, index);
            if (!presets) return null;
            for (const entry of presets) reached.add(entry);
        }
    }
    const specs = DESKTOP_E2E_CLUSTERS.find((cluster) => cluster.id === 'desktop-flows').specs;
    return specs.filter((spec) => {
        const bound = DESKTOP_FLOWS_MAP_BOUND_SPECS[spec];
        return !bound || bound.some((preset) => reached.has(preset));
    });
}

/**
 * Batch run: several finished branches share one stage-3 run on their merged state. Input maps
 * each branch to the paths it changed. The result is the cluster union (one run) and, per
 * cluster, the branches that can have turned it red — the suspects for small reruns.
 */
export function planBatch(changedPathsByBranch) {
    const suspectsByCluster = {};
    let suspectsBySpec = {};
    const withoutClusters = [];
    for (const [branch, paths] of Object.entries(changedPathsByBranch)) {
        const { clusters, desktopFlowsSpecs } = selectFor(paths);
        if (clusters.length === 0 && !desktopFlowsSpecs) withoutClusters.push(branch);
        for (const cluster of clusters) (suspectsByCluster[cluster] ||= []).push(branch);
        for (const spec of desktopFlowsSpecs || []) (suspectsBySpec[spec] ||= []).push(branch);
    }
    // One branch that needs the whole cluster covers every spec list; its suspects are all of them.
    if (suspectsByCluster['desktop-flows']) {
        const spread = new Set(Object.values(suspectsBySpec).flat());
        suspectsByCluster['desktop-flows'] = Object.keys(changedPathsByBranch)
            .filter((branch) => spread.has(branch) || suspectsByCluster['desktop-flows'].includes(branch));
        suspectsBySpec = {};
    }
    const clusters = Object.keys(suspectsByCluster);
    const specs = Object.keys(suspectsBySpec);
    const commands = [
        ...(clusters.length > 0 ? [toStage3Command(clusters)] : []),
        ...(specs.length > 0 ? [toStage3SpecCommand(orderLikeDesktopFlows(specs))] : []),
    ];
    return {
        clusters,
        suspectsByCluster,
        suspectsBySpec,
        withoutClusters,
        stage3Command: commands.length > 0 ? commands.join('\n') : null,
    };
}

function orderLikeDesktopFlows(specs) {
    const order = DESKTOP_E2E_CLUSTERS.find((cluster) => cluster.id === 'desktop-flows').specs;
    return [...specs].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function selectFor(paths) {
    const commands = new Map();
    const clusters = new Set();
    const matched = [];
    const hints = new Set();
    const stage2Targets = [];
    const desktopFlowsRules = new Set();

    for (const entry of ALWAYS) commands.set(entry.command, entry);

    for (const rule of RULES) {
        const files = paths.filter((p) => rule.match(p));
        if (files.length === 0) continue;
        matched.push({ id: rule.id, label: rule.label, files });
        for (const entry of rule.commands || []) {
            if (!commands.has(entry.command)) commands.set(entry.command, { ...entry, reason: rule.label });
        }
        for (const target of rule.stage2 || []) {
            if (!stage2Targets.some((existing) => existing.spec === target.spec && existing.ids === target.ids)) {
                stage2Targets.push(target);
            }
        }
        for (const cluster of rule.clusters || []) clusters.add(cluster);
        if (rule.clusters?.includes('desktop-flows')) desktopFlowsRules.add(rule.id);
        if (rule.hint) hints.add(rule.hint);
    }

    // Only map files pulled desktop-flows in: run the reached maps' specs instead of the cluster.
    let desktopFlowsSpecs = null;
    if (desktopFlowsRules.size === 1 && desktopFlowsRules.has('renderer')) {
        desktopFlowsSpecs = resolveDesktopFlowsScope(paths.filter((p) => RULES.find((rule) => rule.id === 'renderer').match(p)));
        if (desktopFlowsSpecs) clusters.delete('desktop-flows');
    }

    const list = [...commands.values()].map((entry) => ({ ...entry, stage: entry.stage || 1 }));
    for (const target of stage2Targets) list.push(toStage2Command(target));
    if (clusters.size > 0) {
        list.push({
            command: toStage3Command([...clusters]),
            rank: RANK.clusters,
            stage: 3,
            reason: 'Playwright-Cluster der betroffenen Bereiche',
            note: 'losgelöst starten, CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS mindestens 7200000',
        });
    }
    if (desktopFlowsSpecs) {
        list.push({
            command: toStage3SpecCommand(desktopFlowsSpecs),
            rank: RANK.clusters,
            stage: 3,
            reason: 'desktop-flows nur für die berührten Karten (plus alle ungebundenen Specs)',
            note: 'losgelöst starten, CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS mindestens 7200000',
        });
    }
    list.sort((a, b) => a.stage - b.stage || a.rank - b.rank);

    const byStage = { 1: [], 2: [], 3: [] };
    for (const entry of list) byStage[entry.stage].push(entry);
    return { list, byStage, matched, hints: [...hints], clusters: [...clusters], desktopFlowsSpecs };
}

function printReport({ paths, explicit, matched, byStage, hints }) {
    if (!explicit) {
        console.log('Quelle: git status (enthält womöglich fremde Änderungen).');
        console.log('Genauer wird es, wenn du die selbst berührten Pfade als Argumente übergibst.\n');
    }

    console.log(`Betrachtete Pfade: ${paths.length}`);
    for (const group of matched) {
        console.log(`  [${group.id}] ${group.label} — ${group.files.length} Datei(en)`);
        for (const file of group.files.slice(0, 6)) console.log(`      ${file}`);
        if (group.files.length > 6) console.log(`      ... und ${group.files.length - 6} weitere`);
    }
    if (matched.length === 0) console.log('  keine Bereichsregel getroffen — nur die Grundlast');

    for (const stage of [1, 2, 3]) {
        console.log(`\n${VERIFICATION_STAGES[stage]}`);
        if (byStage[stage].length === 0) {
            console.log('  (für diese Pfade nichts)');
            continue;
        }
        for (const entry of byStage[stage]) {
            const note = entry.note ? `  (${entry.note})` : '';
            console.log(`  ${entry.command}${note}`);
        }
    }

    console.log('\nStufenregeln:');
    console.log('  - Stufe 1 muss grün sein, bevor du committest. Subagenten hören hier auf.');
    console.log('  - Stufe 2 ersetzt den Cluster, solange du nur deinen Bereich belegen willst.');
    console.log('  - Stufe 3 läuft nur in der Hauptsitzung, losgelöst und mit UTF-8-Protokoll;');
    console.log('    Beleg ist die letzte Zeile [playwright:summary] passed=… didNotRun=… new=….');
    console.log(`  - Exit-Code ${PLAYWRIGHT_LOCK_TIMEOUT_EXIT_CODE} heißt Schloss-Timeout, nicht Testfehler: später erneut starten.`);

    if (hints.length > 0) {
        console.log('\nHinweise:');
        for (const hint of hints) console.log(`  - ${hint}`);
    }
}

function main(argv) {
    const { paths: argPaths, json, batch, base } = parseArgs(argv);
    if (batch) {
        if (argPaths.length === 0) {
            console.error('--batch braucht mindestens einen Branch-Namen.');
            process.exitCode = 1;
            return;
        }
        const plan = planBatch(Object.fromEntries(argPaths.map((branch) => [branch, changedOnBranch(base, branch)])));
        if (json) console.log(JSON.stringify({ base, ...plan }, null, 2));
        else printBatchReport(base, plan);
        return;
    }
    const explicit = argPaths.length > 0;
    const paths = explicit ? argPaths : changedFromGit();
    const { list, byStage, matched, hints, clusters } = selectFor(paths);

    if (json) {
        console.log(JSON.stringify({ explicit, paths, matched, clusters, hints, commands: list, byStage }, null, 2));
        return;
    }

    if (paths.length === 0) {
        console.log('Keine geänderten Pfade gefunden. Nichts zu prüfen.');
        return;
    }

    printReport({ paths, explicit, matched, byStage, hints });
}

function isDirectRun() {
    const entry = String(process.argv[1] || '');
    if (!entry) return false;
    try {
        return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isDirectRun()) {
    main(process.argv.slice(2));
}
