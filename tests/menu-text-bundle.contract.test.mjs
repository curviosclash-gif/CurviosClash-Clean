import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the start-page reset button and feedback name only the fields they reset', () => {
    assert.equal(MENU_TEXT_CATALOG['menu.level3.reset.label'], 'Karte & Flugzeug zurücksetzen');
    assert.match(html, /id="btn-level3-reset"[^>]*[\s\S]*?>Karte &amp; Flugzeug zurücksetzen<\/button>/u);
    const runtime = readFileSync(new URL('../src/core/runtime/MenuRuntimeSessionService.js', import.meta.url), 'utf8');
    assert.match(runtime, /_showStatusToast\('Karte und Flugzeug zurückgesetzt'/u);
});

test('the menu context and breadcrumb labels come from the text catalog', () => {
    const source = readFileSync(new URL('../src/ui/UINavigationLifecycleController.js', import.meta.url), 'utf8');
    for (const literal of ["'Geteilter Bildschirm'", "'Erweiterte Optionen'", "'Grafik & Kamera'", "'Match vorbereiten'"]) {
        const bare = new RegExp(`(?<!resolveMenuCatalogText\\('[^']+',\\s*)${literal}`, 'u');
        assert.doesNotMatch(source, bare, `${literal} still hard-wired`);
    }
    const ids = Array.from(source.matchAll(/resolveMenuCatalogText\('([^']+)'/gu), (match) => match[1]);
    assert.ok(ids.length >= 10);
    ids.forEach((textId) => assert.ok(Object.hasOwn(MENU_TEXT_CATALOG, textId), textId));
});
