import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// A test or script that writes into the system temp folder must clean up after itself. Without
// that, every run leaves another copy behind: 2.5k curvios-editor-map-store-* folders and a
// storm-dam-breach-*.png per run had piled up on drive C. Playwright specs do not need the temp
// folder at all, testInfo.outputPath(...) already gives them a per-run folder.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const SOURCE_FILE = /\.(?:m?js|cjs)$/;
const SCAN_ROOTS = ['tests', 'dev/training/tests', 'scripts', 'dev/training/scripts'];
// Test roots also get the "writes into tmpdir()" check; script roots only the mkdtemp check.
const TEST_ROOTS = new Set(['tests', 'dev/training/tests']);

// Files that may keep a system-temp write without cleanup. Every entry needs a reason and is
// dropped from this list as soon as the file stops needing it.
const ALLOWED = {};

const TMP_MKDTEMP = /\bmkdtemp(?:Sync)?\(\s*(?:path\.)?join\(\s*(?:os\.)?tmpdir\(\)/g;
const REMOVE_CALL = /\b(?:rm|rmSync)\(/g;
const TMP_LITERAL = /\btmpdir\(\)/;
const TMP_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:path\.)?(?:join|resolve)\(([^;]*)\)/g;
const WRITE_CALL = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|rename|renameSync)\(\s*([^,)]+)/g;
const SCREENSHOT_PATH = /\.screenshot\(\s*\{[^}]*?\bpath\s*:\s*([^,}]+)/g;

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function findTempWrites(source) {
    const tempNames = new Set();
    const bindings = [...source.matchAll(TMP_BINDING)].map((match) => ({ name: match[1], args: match[2] }));
    let grew = true;
    while (grew) {
        grew = false;
        for (const { name, args } of bindings) {
            if (tempNames.has(name)) continue;
            const firstArg = args.split(',')[0] || '';
            const derived = [...tempNames].some((known) => new RegExp(`^\\s*${known}\\b`).test(firstArg));
            if (TMP_LITERAL.test(firstArg) || derived) {
                tempNames.add(name);
                grew = true;
            }
        }
    }
    const targetsTemp = (expression) => TMP_LITERAL.test(expression)
        || [...tempNames].some((name) => new RegExp(`\\b${name}\\b`).test(expression));
    return [...source.matchAll(WRITE_CALL), ...source.matchAll(SCREENSHOT_PATH)]
        .filter((match) => targetsTemp(match[1]))
        .map((match) => match[0].trim());
}

/** Returns what is wrong with one file, as short readable reasons. */
function findTempProblems(source, { isSpec = false, isTestRoot = false } = {}) {
    const code = stripComments(source);
    const problems = [];
    if (isSpec && TMP_LITERAL.test(code)) {
        problems.push('Playwright spec uses tmpdir(); write to testInfo.outputPath(...) instead');
        return problems;
    }
    const created = [...code.matchAll(TMP_MKDTEMP)].length;
    const removed = [...code.matchAll(REMOVE_CALL)].length;
    if (created > removed) problems.push(`${created} mkdtemp(tmpdir()) but only ${removed} rm/rmSync; remove the folder in finally or t.after`);
    const removesAnything = removed > 0 || /\b(?:unlink|unlinkSync)\(/.test(code);
    if (isTestRoot && !removesAnything) {
        const [firstHit] = findTempWrites(code);
        if (firstHit) problems.push(`writes into tmpdir() and the file never removes anything: ${firstHit.replace(/\s+/g, ' ')}`);
    }
    return problems;
}

function listSourceFiles(relativeRoot) {
    const start = path.join(ROOT, relativeRoot);
    const found = [];
    const visit = (directory) => {
        let entries;
        try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name === 'node_modules') continue;
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            else if (SOURCE_FILE.test(entry.name)) found.push(entryPath);
        }
    };
    visit(start);
    return found;
}

function scanRepository() {
    const results = [];
    for (const scanRoot of SCAN_ROOTS) {
        for (const file of listSourceFiles(scanRoot)) {
            const relative = path.relative(ROOT, file).replace(/\\/g, '/');
            if (relative === SELF) continue;
            const problems = findTempProblems(readFileSync(file, 'utf8'), {
                isSpec: /\.spec\.js$/.test(relative),
                isTestRoot: TEST_ROOTS.has(scanRoot),
            });
            results.push({ relative, problems });
        }
    }
    return results;
}

test('detector flags temp leaks and accepts cleaned-up or outputPath use', () => {
    const bad = [
        ["const dir = await mkdtemp(path.join(os.tmpdir(), 'x-'));\nawait writeFile(path.join(dir, 'a'), 'b');", {}],
        ["const dir = mkdtempSync(join(tmpdir(), 'x-'));", {}],
        ["const shot = path.join(tmpdir(), `a-${Date.now()}.png`);\nawait writeFile(shot, data);", { isTestRoot: true }],
        ["const base = path.join(os.tmpdir(), 'x');\nconst file = path.join(base, 'a.png');\nawait page.screenshot({ path: file });", { isTestRoot: true }],
        ["import { tmpdir } from 'node:os';\nconst x = path.join(tmpdir(), 'a');", { isSpec: true }],
    ];
    const good = [
        ["const dir = mkdtempSync(path.join(tmpdir(), 'x-'));\ntry { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }", {}],
        ["const dir = await mkdtemp(path.join(os.tmpdir(), 'x-'));\nt.after(() => rm(dir, { recursive: true, force: true }));", { isTestRoot: true }],
        ["await writeFile(testInfo.outputPath('a.png'), data);", { isSpec: true, isTestRoot: true }],
        ["// mkdtemp(path.join(tmpdir(), 'x-')) in a comment\nconst y = 1;", {}],
        ["assert.equal(resolve(path.join(tmpdir(), 'curvios-absent')), 'x');", { isTestRoot: true }],
    ];
    for (const [source, options] of bad) assert.notDeepEqual(findTempProblems(source, options), [], source);
    for (const [source, options] of good) assert.deepEqual(findTempProblems(source, options), [], source);
});

test('no test or script leaves files in the system temp folder', () => {
    const offenders = scanRepository()
        .filter(({ relative, problems }) => problems.length > 0 && !(relative in ALLOWED))
        .flatMap(({ relative, problems }) => problems.map((problem) => `${relative}: ${problem}`));
    assert.deepEqual(offenders, [], 'Clean up in finally/t.after, or use testInfo.outputPath(...) in Playwright specs.');
});

test('every temp-hygiene exception has a reason and still applies', () => {
    const byFile = new Map(scanRepository().map(({ relative, problems }) => [relative, problems]));
    for (const [relative, reason] of Object.entries(ALLOWED)) {
        assert.ok(String(reason).trim().length > 10, `${relative}: an exception needs a real reason`);
        assert.ok((byFile.get(relative) || []).length > 0, `${relative}: exception is stale, remove it from ALLOWED`);
    }
});
