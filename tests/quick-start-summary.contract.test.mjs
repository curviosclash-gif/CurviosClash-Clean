import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';

test('the "Sofort spielen" summary keeps the concrete selection instead of a catalog text', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const summaryTag = /<span[^>]*id="quick-last-summary"[^>]*>/u.exec(html)?.[0] || '';
    assert.ok(summaryTag, 'the summary element exists');
    // A data-menu-text-id makes the menu text runtime rewrite the element with its fixed text
    // on every refresh, which wiped the live summary "Session · Spielstil · Karte · …".
    assert.doesNotMatch(summaryTag, /data-menu-text-id/);
    assert.equal(Object.hasOwn(MENU_TEXT_CATALOG, 'menu.level1.quick_last.summary'), false);
});
