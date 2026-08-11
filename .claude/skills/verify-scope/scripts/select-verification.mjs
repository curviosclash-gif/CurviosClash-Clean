#!/usr/bin/env node
// Maps changed paths to the verification commands CLAUDE.md declares mandatory.
//
// Why a script: that table is the only rule set in this repo that no tool enforces.
// Boundaries, ratchets and the commit format break the build by themselves; picking
// the right tests does not. Deriving it here keeps the choice reproducible instead of
// re-reasoned per task, and keeps `npm run quality` from becoming the lazy default.
//
// Usage:
//   node select-verification.mjs                 # derive from git (warns about foreign changes)
//   node select-verification.mjs src/ui/Foo.js   # only the paths you actually touched
//   node select-verification.mjs --json          # machine readable
import { spawnSync } from 'node:child_process';
import process from 'node:process';

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
    { command: 'npm run lint', rank: RANK.lint, reason: 'gilt immer (AGENTS.md 8)' },
    { command: 'npm run test:contract:fast', rank: RANK.contractFast, reason: 'Grundlast, gilt immer' },
];

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
        clusters: ['physics-core', 'physics-hunt', 'physics-policy'],
    },
    {
        id: 'network',
        match: (p) => p.startsWith('src/network/') || p.startsWith('src/application/session-runtime/'),
        label: 'Netzwerk und Session-Runtime',
        commands: [{ command: 'npm run check:architecture', rank: RANK.check, note: 'Determinismus-Guard' }],
        clusters: ['network'],
    },
    {
        id: 'renderer',
        match: (p) => p.startsWith('src/core/renderer/')
            || p === 'src/entities/GLBMapLoader.js'
            || p.startsWith('src/core/config/maps/')
            || p.startsWith('assets/maps/'),
        label: 'Renderer, Map-Laden und Map-Presets',
        commands: [{ command: 'npm run test:desktop:smoke', rank: RANK.smoke }],
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
    },
    {
        id: 'ui',
        match: (p) => p.startsWith('src/ui/'),
        label: 'DOM, HUD, Menü, Hangar',
        clusters: ['core-surface', 'desktop-flows'],
        hint: 'Die Boundary-Regel ui→core schlägt hier zuerst zu; lint zuerst lesen.',
    },
    {
        id: 'modes',
        match: (p) => p.startsWith('src/modes/'),
        label: 'Spielmodi-Strategien',
        clusters: ['core-runtime', 'gameplay-smoke'],
    },
    {
        id: 'editor',
        match: (p) => p.startsWith('editor/'),
        label: 'Map- und Fahrzeug-Editor',
        commands: [{ command: 'npm run check:architecture', rank: RANK.check, note: 'Editor-Pfad-Drift' }],
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

function selectFor(paths) {
    const commands = new Map();
    const clusters = new Set();
    const matched = [];
    const hints = new Set();

    for (const entry of ALWAYS) commands.set(entry.command, entry);

    for (const rule of RULES) {
        const files = paths.filter((p) => rule.match(p));
        if (files.length === 0) continue;
        matched.push({ id: rule.id, label: rule.label, files });
        for (const entry of rule.commands || []) {
            const existing = commands.get(entry.command);
            if (!existing) commands.set(entry.command, { ...entry, reason: rule.label });
        }
        for (const cluster of rule.clusters || []) clusters.add(cluster);
        if (rule.hint) hints.add(rule.hint);
    }

    const list = [...commands.values()];
    if (clusters.size > 0) {
        list.push({
            command: `node scripts/run-playwright-targeted-clusters.mjs ${[...clusters].join(' ')}`,
            rank: RANK.clusters,
            reason: 'Playwright-Cluster der betroffenen Bereiche',
        });
    }
    list.sort((a, b) => a.rank - b.rank);
    return { list, matched, hints: [...hints], clusters: [...clusters] };
}

const { paths: argPaths, json } = parseArgs(process.argv.slice(2));
const explicit = argPaths.length > 0;
const paths = explicit ? argPaths : changedFromGit();
const { list, matched, hints, clusters } = selectFor(paths);

if (json) {
    console.log(JSON.stringify({ explicit, paths, matched, clusters, hints, commands: list }, null, 2));
    process.exit(0);
}

if (paths.length === 0) {
    console.log('Keine geänderten Pfade gefunden. Nichts zu prüfen.');
    process.exit(0);
}

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

console.log('\nPflichtprüfung in dieser Reihenfolge:');
for (const entry of list) {
    const note = entry.note ? `  (${entry.note})` : '';
    console.log(`  ${entry.command}${note}`);
}

if (hints.length > 0) {
    console.log('\nHinweise:');
    for (const hint of hints) console.log(`  - ${hint}`);
}
