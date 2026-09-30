import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Tests may read checked-in assets, but must write screenshots and reports to
// testInfo.outputPath(...) or a temp folder, never into versioned assets/.
const TESTS_DIR = path.resolve('tests');
const SELF = path.basename(new URL(import.meta.url).pathname);
const ASSET_LITERAL = /^\s*['"`](?:\.\/)?assets[/\\'"`]/;
const ASSET_LITERAL_ANYWHERE = /['"`](?:\.\/)?assets[/\\'"`]/;
const ASSET_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:resolve|join)\(([^;]*)\)/g;
const WRITE_CALL = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|rm|rmSync|rename|renameSync)\(\s*([^,)]+)/g;
const SCREENSHOT_PATH = /\.screenshot\(\s*\{[^}]*?\bpath\s*:\s*([^,}]+)/g;

function findAssetWrites(source) {
    const assetNames = new Set();
    const bindings = [...source.matchAll(ASSET_BINDING)].map((match) => ({ name: match[1], args: match[2] }));
    let grew = true;
    while (grew) {
        grew = false;
        for (const { name, args } of bindings) {
            if (assetNames.has(name)) continue;
            const firstArg = args.split(',').find((arg) => !/^\s*(?:ROOT|process\.cwd\(\))\s*$/.test(arg)) || '';
            const derived = [...assetNames].some((known) => new RegExp(`^\\s*${known}\\b`).test(firstArg));
            if (ASSET_LITERAL.test(firstArg) || derived) {
                assetNames.add(name);
                grew = true;
            }
        }
    }
    const targetsAssets = (expression) => ASSET_LITERAL_ANYWHERE.test(expression)
        || [...assetNames].some((name) => new RegExp(`\\b${name}\\b`).test(expression));
    const hits = [];
    for (const match of [...source.matchAll(WRITE_CALL), ...source.matchAll(SCREENSHOT_PATH)]) {
        if (targetsAssets(match[1])) hits.push(match[0].trim());
    }
    return hits;
}

test('detector flags writes into assets/ and ignores reads and output paths', () => {
    const bad = [
        "const DIR = path.resolve('assets/models/x/previews');\nconst file = path.join(DIR, 'a.png');\nawait writeFile(file, data);",
        "await page.screenshot({ path: path.resolve('assets/maps/x/shot.png') });",
        "const OUT = path.join(ROOT, 'assets', 'models');\nwriteFileSync(path.join(OUT, 'x.json'), '{}');",
    ];
    const good = [
        "const GLB = path.resolve('assets/models/x/model.glb');\nconst size = (await stat(GLB)).size;\nawait writeFile(testInfo.outputPath('a.png'), data);",
        "await page.screenshot({ path: testInfo.outputPath('shot.png') });",
        "const SHOT_DIR = path.resolve('test-results/x');\nawait mkdir(SHOT_DIR, { recursive: true });",
    ];
    for (const source of bad) assert.notDeepEqual(findAssetWrites(source), [], source);
    for (const source of good) assert.deepEqual(findAssetWrites(source), [], source);
});

test('no test file writes screenshots or reports into versioned assets/', () => {
    const offenders = readdirSync(TESTS_DIR)
        .filter((name) => /\.(?:m?js|cjs)$/.test(name) && name !== SELF)
        .flatMap((name) => findAssetWrites(readFileSync(path.join(TESTS_DIR, name), 'utf8'))
            .map((hit) => `${name}: ${hit}`));
    assert.deepEqual(offenders, [], 'Write test artifacts to testInfo.outputPath(...) instead of assets/.');
});
