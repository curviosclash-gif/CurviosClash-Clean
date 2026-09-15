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
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
    physicsPolicy: { spec: 'tests/physics-policy.spec.js', ids: ['T65', 'T73', 'T81'] },
    surface: { spec: 'tests/core-targeted-surface.spec.js', ids: ['T20kb', 'T20kc', 'T20kd', 'T20i', 'T20ha', 'T66a'] },
    runtime: { spec: 'tests/core-targeted-runtime.spec.js', ids: ['T20ab', 'T20ae3', 'T20ae4', 'T20am2'] },
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
    for (const raw of argv) {
        if (raw === '--json') json = true;
        else if (raw.startsWith('--')) continue;
        else paths.push(raw.replace(/\\/g, '/'));
    }
    return { paths, json };
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

export function selectFor(paths) {
    const commands = new Map();
    const clusters = new Set();
    const matched = [];
    const hints = new Set();
    const stage2Targets = [];

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
        if (rule.hint) hints.add(rule.hint);
    }

    const list = [...commands.values()].map((entry) => ({ ...entry, stage: entry.stage || 1 }));
    for (const target of stage2Targets) list.push(toStage2Command(target));
    if (clusters.size > 0) {
        list.push({
            command: `node scripts/run-playwright-targeted-clusters.mjs ${[...clusters].join(' ')} --skip-known`,
            rank: RANK.clusters,
            stage: 3,
            reason: 'Playwright-Cluster der betroffenen Bereiche',
            note: 'losgelöst starten, CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS mindestens 7200000',
        });
    }
    list.sort((a, b) => a.stage - b.stage || a.rank - b.rank);

    const byStage = { 1: [], 2: [], 3: [] };
    for (const entry of list) byStage[entry.stage].push(entry);
    return { list, byStage, matched, hints: [...hints], clusters: [...clusters] };
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
    const { paths: argPaths, json } = parseArgs(argv);
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
