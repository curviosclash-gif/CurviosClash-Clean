import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    MARK_CLEARING_CONTEXT_METHODS,
    MARK_CLEARING_PAGE_METHODS,
    clearFreshBootMark,
    consumeFreshBootMark,
    installFreshBootGuards,
    isForceGotoEnv,
    isFreshBoot,
    markFreshBoot,
    shouldSkipInitialGoto,
} from './fresh-boot-mark.mjs';
import { loadGame } from './helpers.js';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://127.0.0.1:41234/';

function createFakeContext() {
    const context = new EventEmitter();
    context.calls = [];
    for (const methodName of MARK_CLEARING_CONTEXT_METHODS) {
        context[methodName] = async (...args) => {
            context.calls.push([methodName, ...args]);
        };
    }
    return context;
}

function createFakePage({ url = APP_URL, context = createFakeContext() } = {}) {
    const page = new EventEmitter();
    page.calls = [];
    page.currentUrl = url;
    page.url = () => page.currentUrl;
    page.isClosed = () => false;
    page.context = () => context;
    page.goto = async (target) => {
        page.calls.push(['goto', target]);
        page.currentUrl = target;
    };
    // loadGame only reads the menu/runtime snapshot through evaluate.
    page.evaluate = async () => ({ menuVisible: true, runtimeReady: true, visiblePanelId: null });
    page.waitForFunction = async () => {};
    page.waitForTimeout = async () => {};
    for (const methodName of MARK_CLEARING_PAGE_METHODS) {
        page[methodName] = async (...args) => {
            page.calls.push([methodName, ...args]);
        };
    }
    return page;
}

function createGuardedPage(options = {}) {
    const context = options.context || createFakeContext();
    const page = createFakePage({ ...options, context });
    installFreshBootGuards({ page, context });
    markFreshBoot(page);
    return { page, context };
}

function countGotos(page) {
    return page.calls.filter(([name]) => name === 'goto').length;
}

test('shouldSkipInitialGoto skips only for an untouched fresh boot on the same url', () => {
    const base = { fresh: true, currentUrl: APP_URL, targetUrl: APP_URL, forceReload: false, envForce: false };
    assert.equal(shouldSkipInitialGoto(base), true);
    assert.equal(shouldSkipInitialGoto({ ...base, fresh: false }), false);
    assert.equal(shouldSkipInitialGoto({ ...base, forceReload: true }), false);
    assert.equal(shouldSkipInitialGoto({ ...base, envForce: true }), false);
    assert.equal(shouldSkipInitialGoto({ ...base, forceReload: true, envForce: true }), false);
    assert.equal(shouldSkipInitialGoto(), false);
});

test('shouldSkipInitialGoto compares urls without trusting loose equality', () => {
    const fresh = { fresh: true, forceReload: false, envForce: false };
    assert.equal(shouldSkipInitialGoto({
        ...fresh,
        currentUrl: 'http://127.0.0.1:41234/',
        targetUrl: 'http://127.0.0.1:41234/#menu',
    }), true, 'a hash alone does not reload the document');
    assert.equal(shouldSkipInitialGoto({
        ...fresh,
        currentUrl: 'http://127.0.0.1:41234/index.html',
        targetUrl: APP_URL,
    }), false, 'a different path means a different document');
    assert.equal(shouldSkipInitialGoto({
        ...fresh,
        currentUrl: 'http://127.0.0.1:41235/',
        targetUrl: APP_URL,
    }), false, 'a different port means a different server');
    assert.equal(shouldSkipInitialGoto({ ...fresh, currentUrl: 'about:blank', targetUrl: APP_URL }), false);
    // browser-compat resolves a relative target and starts on about:blank.
    assert.equal(shouldSkipInitialGoto({ ...fresh, currentUrl: '/', targetUrl: '/' }), false);
    assert.equal(shouldSkipInitialGoto({ ...fresh, currentUrl: '', targetUrl: '' }), false);
});

test('the fresh boot mark is consumed exactly once', () => {
    const { page } = createGuardedPage();
    assert.equal(isFreshBoot(page), true);
    assert.equal(consumeFreshBootMark(page), true);
    assert.equal(consumeFreshBootMark(page), false);
    assert.equal(isFreshBoot(page), false);
});

test('page level navigation scoped calls drop the mark', () => {
    for (const methodName of ['addInitScript', 'route', 'setViewportSize', 'emulateMedia', 'exposeFunction']) {
        const { page } = createGuardedPage();
        page[methodName](() => {});
        assert.equal(isFreshBoot(page), false, `${methodName} must drop the mark`);
        assert.equal(page.calls.some(([name]) => name === methodName), true, `${methodName} must still run`);
    }
});

test('context level navigation scoped calls drop the mark of every page in the context', () => {
    for (const methodName of ['addInitScript', 'route', 'setExtraHTTPHeaders']) {
        const context = createFakeContext();
        const { page } = createGuardedPage({ context });
        page.context()[methodName](() => {});
        assert.equal(isFreshBoot(page), false, `context.${methodName} must drop the mark`);
        assert.equal(context.calls.some(([name]) => name === methodName), true, `context.${methodName} must still run`);
    }
});

test('a listener added after the harness counts as not fresh', () => {
    const { page } = createGuardedPage();
    page.on('pageerror', () => {});
    assert.equal(isFreshBoot(page), false);
});

test('a page without listener introspection never counts as fresh', () => {
    const page = createFakePage();
    page.eventNames = undefined;
    page.listenerCount = undefined;
    markFreshBoot(page);
    assert.equal(isFreshBoot(page), false);
});

test('isForceGotoEnv only reacts to the documented switch', () => {
    assert.equal(isForceGotoEnv({}), false);
    assert.equal(isForceGotoEnv({ PW_LOAD_GAME_FORCE_GOTO: '0' }), false);
    assert.equal(isForceGotoEnv({ PW_LOAD_GAME_FORCE_GOTO: ' 1 ' }), true);
});

test('loadGame skips the second boot of a freshly booted page', async () => {
    const { page } = createGuardedPage();
    await loadGame(page);
    assert.equal(countGotos(page), 0);
});

test('loadGame reloads on every further call in the same test', async () => {
    const { page } = createGuardedPage();
    await loadGame(page);
    await loadGame(page);
    assert.equal(countGotos(page), 1);
});

test('loadGame reloads after an init script, a route or a viewport change', async () => {
    for (const methodName of ['addInitScript', 'route', 'setViewportSize']) {
        const { page } = createGuardedPage();
        await page[methodName](() => {});
        await loadGame(page);
        assert.equal(countGotos(page), 1, `${methodName} must keep the reload`);
    }
});

test('loadGame reloads after a context init script', async () => {
    const { page } = createGuardedPage();
    await page.context().addInitScript(() => {});
    await loadGame(page);
    assert.equal(countGotos(page), 1);
});

test('loadGame reloads with forceReload and with the emergency switch', async () => {
    const forced = createGuardedPage();
    await loadGame(forced.page, { forceReload: true });
    assert.equal(countGotos(forced.page), 1);

    const previous = process.env.PW_LOAD_GAME_FORCE_GOTO;
    process.env.PW_LOAD_GAME_FORCE_GOTO = '1';
    try {
        const switched = createGuardedPage();
        await loadGame(switched.page);
        assert.equal(countGotos(switched.page), 1);
    } finally {
        if (previous === undefined) delete process.env.PW_LOAD_GAME_FORCE_GOTO;
        else process.env.PW_LOAD_GAME_FORCE_GOTO = previous;
    }
});

test('loadGame reloads a page that was never marked', async () => {
    const page = createFakePage();
    clearFreshBootMark(page);
    await loadGame(page);
    assert.equal(countGotos(page), 1);
});

test('the desktop harness marks the page and installs the guards', () => {
    const source = readFileSync(path.join(TESTS_DIR, 'helpers.desktop.js'), 'utf8');
    assert.equal(source.includes('installFreshBootGuards('), true, 'harness must wrap page and context');
    assert.equal(source.includes('markFreshBoot('), true, 'harness must mark the booted page');
    assert.equal(source.includes('mainFrameLoads'), true, 'harness must count main frame loads');
});

// --- static guard -----------------------------------------------------------
// The runtime wrappers only know the Playwright calls listed in
// fresh-boot-mark.mjs. This guard reads the specs and is built the other way
// round: before the first load of a block, *every* touch of the page, the context
// or the Electron app is a finding unless it is known to drop the mark. A false
// alarm costs one line in GUARD_EXCEPTIONS, a gap would let a test silently check
// something else.
const NAVIGATION_SCOPED_CANDIDATES = Object.freeze([
    ...new Set([
        ...MARK_CLEARING_PAGE_METHODS,
        ...MARK_CLEARING_CONTEXT_METHODS,
        'setContent',
        'addScriptTag',
        'addStyleTag',
    ]),
]);

// file:line -> reason. Only for sites that need a manual decision, never for
// something a wrapper already covers.
const GUARD_EXCEPTIONS = Object.freeze({});

const FIXTURE_RECEIVERS = Object.freeze(['page', 'context', 'electronApp', 'desktopHarness']);
// Subscribing adds a listener, and the listener baseline drops the mark for it. A second
// page never carries a mark and leaves the first one alone.
const LISTENER_METHODS = Object.freeze([
    'on', 'once', 'addListener', 'waitForEvent', 'waitForRequest', 'waitForResponse', 'newPage',
]);

// Net count of opened brackets, good enough to find the end of a multi line call.
function bracketBalance(text) {
    let balance = 0;
    for (const char of text) {
        if (char === '(' || char === '{' || char === '[') balance += 1;
        else if (char === ')' || char === '}' || char === ']') balance -= 1;
    }
    return balance;
}

function listTestSources(directory, matches) {
    const found = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...listTestSources(full, matches));
        else if (matches(entry.name)) found.push(full);
    }
    return found;
}

function listSpecFiles(directory) {
    return listTestSources(directory, (name) => name.endsWith('.spec.js'));
}

function findBlockStarts(lines) {
    // Only hooks that run *before* a test body can spoil its first load.
    const hookPattern = /^\s*test\.(beforeEach|beforeAll)\s*\(/;
    const afterHookPattern = /^\s*test\.(afterEach|afterAll)\s*\(/;
    // A test starts with a title. test.setTimeout(...), test.slow() or test.step(...)
    // inside a body must not cut the block in two.
    const testPattern = /^\s*test(\.(only|skip|fixme|fail))?\s*\(\s*['"`]/;
    const helperPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/;
    const starts = [];
    lines.forEach((line, index) => {
        const isHook = hookPattern.test(line);
        const helper = helperPattern.exec(line);
        if (isHook || afterHookPattern.test(line) || testPattern.test(line) || helper) {
            starts.push({ index, isHook, helperName: helper ? (helper[1] || helper[2]) : '' });
        }
    });
    return starts;
}

function buildLoaderPattern(loaderNames) {
    return new RegExp(`(?<![.\\w])(${[...loaderNames].join('|')})\\s*\\(`);
}

// loadGame hides behind helpers (startGame, loadGameWithRetry, ...). Every function in
// tests/ whose body reaches a known loader is a loader itself, up to the fixed point.
function resolveLoaderNames(directory) {
    const sources = listTestSources(directory, (name) => name.endsWith('.js'))
        .map((file) => readFileSync(file, 'utf8').split(/\r?\n/));
    const loaders = new Set(['loadGame']);
    let grew = true;
    while (grew) {
        grew = false;
        const loaderPattern = buildLoaderPattern(loaders);
        for (const lines of sources) {
            const starts = findBlockStarts(lines);
            for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
                const start = starts[blockIndex];
                if (!start.helperName || loaders.has(start.helperName)) continue;
                const to = blockIndex + 1 < starts.length ? starts[blockIndex + 1].index : lines.length;
                for (let line = start.index + 1; line < to; line += 1) {
                    if (loaderPattern.test(lines[line])) {
                        loaders.add(start.helperName);
                        grew = true;
                        break;
                    }
                }
            }
        }
    }
    return loaders;
}

function findUncoveredTouch(text, receivers, coveredMethods) {
    const receiverGroup = [...receivers].join('|');
    const methodGroup = [...coveredMethods, ...LISTENER_METHODS].join('|');
    const cleaned = text
        .replace(/\/\/.*$/, '')
        .replace(/\.\s*context\s*\(\s*\)/g, '.context')
        .replace(
            new RegExp(`(?<![.\\w])(${receiverGroup})(\\s*\\.\\s*context)?\\s*\\.\\s*(${methodGroup})\\s*\\(`, 'g'),
            ' covered('
        )
        .replace(new RegExp(`(?<![.\\w])(${receiverGroup})\\s*\\.\\s*context(?![\\w.(])`, 'g'), ' contextRef');
    const touch = new RegExp(`(?<![.\\w])(${receiverGroup})\\s*\\.\\s*\\w+`).exec(cleaned);
    return touch ? touch[0].replace(/\s+/g, '') : '';
}

function scanLinesForPreLoadCalls(lines, loaderNames) {
    const starts = findBlockStarts(lines);
    const loaderPattern = buildLoaderPattern(loaderNames);
    const callPattern = new RegExp(`\\.(${NAVIGATION_SCOPED_CANDIDATES.join('|')})\\s*\\(`);
    const covered = new Set([...MARK_CLEARING_PAGE_METHODS, ...MARK_CLEARING_CONTEXT_METHODS]);
    const findings = [];
    for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
        const from = starts[blockIndex].index;
        const to = blockIndex + 1 < starts.length ? starts[blockIndex + 1].index : lines.length;
        let loadLine = -1;
        let loadColumn = -1;
        for (let line = from + 1; line < to; line += 1) {
            const match = loaderPattern.exec(lines[line]);
            if (match) {
                loadLine = line;
                loadColumn = match.index;
                break;
            }
        }
        // A block without a load only matters when it runs before every test.
        if (loadLine === -1 && !starts[blockIndex].isHook) continue;
        const limit = loadLine === -1 ? to - 1 : loadLine;
        const receivers = new Set(FIXTURE_RECEIVERS);
        for (let line = from + 1; line <= limit; line += 1) {
            // The load line itself counts up to the call: "await x(); await loadGame(page);".
            const text = line === loadLine ? lines[line].slice(0, loadColumn) : lines[line];
            const alias = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]+\s*\.\s*context\s*\(\s*\)\s*;?\s*$/.exec(text);
            if (alias) receivers.add(alias[1]);
            const call = callPattern.exec(text);
            if (call && !covered.has(call[1])) {
                findings.push({ line: line + 1, kind: `call:${call[1]}`, text: text.trim() });
                continue;
            }
            if (call) {
                // The body of a covered call (an init script) runs in the page after the
                // reload it forces, so its lines are not touches of the fresh page.
                let balance = bracketBalance(text.slice(call.index));
                while (balance > 0 && line < limit) {
                    line += 1;
                    balance += bracketBalance(lines[line]);
                }
                continue;
            }
            if (/\bcollectErrors\s*\(/.test(text)) continue; // subscribes, the listener baseline drops the mark
            if (/\b(local|session)Storage\b|\bindexedDB\b/.test(text)) {
                findings.push({ line: line + 1, kind: 'storage', text: text.trim() });
                continue;
            }
            const touch = findUncoveredTouch(text, receivers, covered);
            if (touch) findings.push({ line: line + 1, kind: `touch:${touch}`, text: text.trim() });
        }
    }
    return findings;
}

const LOADER_NAMES = resolveLoaderNames(TESTS_DIR);

test('the guard follows loadGame through the start helpers', () => {
    for (const name of ['loadGame', 'startGame', 'startGameWithBots', 'startHuntGame', 'loadGameWithRetry']) {
        assert.equal(LOADER_NAMES.has(name), true, `${name} must count as a load`);
    }
});

test('everything that touches the page before the first load is covered', () => {
    const uncovered = [];
    for (const file of listSpecFiles(TESTS_DIR)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        for (const finding of scanLinesForPreLoadCalls(lines, LOADER_NAMES)) {
            const key = `${path.basename(file)}:${finding.line}`;
            if (GUARD_EXCEPTIONS[key]) continue;
            uncovered.push(`${key} ${finding.kind} -> ${finding.text}`);
        }
    }
    assert.deepEqual(
        uncovered,
        [],
        'Add a wrapper in fresh-boot-mark.mjs, pass loadGame(page, { forceReload: true }) '
        + 'or list the site in GUARD_EXCEPTIONS with a reason:\n'
        + uncovered.join('\n')
    );
});

function scanSnippet(bodyLines) {
    const lines = ["test('sample', async ({ page }) => {", ...bodyLines, '});'];
    return scanLinesForPreLoadCalls(lines, LOADER_NAMES).map((finding) => finding.kind);
}

test('the guard reports page state that is set before the load', () => {
    const cases = {
        'one line with the load': [
            "    await page.evaluate(() => localStorage.setItem('x', '1')); await loadGame(page);",
        ],
        'multi line evaluate': [
            '    await page.evaluate(() => {',
            "        localStorage.setItem('x', '1');",
            '    });',
            '    await loadGame(page);',
        ],
        'start helper instead of loadGame': [
            '    await page.evaluate(() => { window.__X = 1; });',
            '    await startGame(page);',
        ],
        'before test.setTimeout': [
            '    await page.evaluate(() => { window.__X = 1; });',
            '    test.setTimeout(60_000);',
            '    await loadGame(page);',
        ],
        'electron main process': [
            '    await electronApp.evaluate(() => { globalThis.__X = 1; });',
            '    await loadGame(page);',
        ],
        'unwrapped call through an alias': [
            '    const ctx = page.context();',
            '    await ctx.storageState();',
            '    await loadGame(page);',
        ],
    };
    for (const [name, body] of Object.entries(cases)) {
        assert.notDeepEqual(scanSnippet(body), [], `${name} must be reported`);
    }
});

test('the guard stays quiet for calls that drop the mark', () => {
    const cases = {
        'context init script': [
            '    await page.context().addInitScript(() => {',
            '        window.__X = 1;',
            '    });',
            '    await loadGame(page);',
        ],
        'alias of the context': [
            '    const ctx = page.context();',
            '    await ctx.routeWebSocket(/x/, () => {});',
            '    await loadGame(page);',
        ],
        'error collector and listener': [
            '    const errors = collectErrors(page);',
            "    page.on('console', () => {});",
            '    test.setTimeout(60_000);',
            '    await startGame(page);',
        ],
        'touch after the load': [
            '    await loadGame(page);',
            '    await page.evaluate(() => 1);',
        ],
    };
    for (const [name, body] of Object.entries(cases)) {
        assert.deepEqual(scanSnippet(body), [], `${name} must not be reported`);
    }
});
