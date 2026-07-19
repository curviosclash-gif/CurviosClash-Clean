import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prototypeUrl = new URL('../prototypes/menu-designs/', import.meta.url);

test('menu design prototype exposes ten distinct, switchable concepts', async () => {
    const [html, css, js] = await Promise.all([
        readFile(new URL('index.html', prototypeUrl), 'utf8'),
        readFile(new URL('style.css', prototypeUrl), 'utf8'),
        readFile(new URL('main.js', prototypeUrl), 'utf8'),
    ]);
    const concepts = [
        'orbital', 'hangar', 'pilot', 'arcade', 'tactical',
        'matrix', 'grid72', 'avionics', 'broadcast', 'holobay',
    ];

    for (const concept of concepts) {
        assert.match(html, new RegExp(`data-concept-target="${concept}"`));
        assert.match(css, new RegExp(`data-concept="${concept}"`));
        assert.match(js, new RegExp(`\\b${concept}:`));
    }

    assert.equal((html.match(/data-concept-target=/g) || []).length, 10);
    assert.match(js, /document\.addEventListener\('keydown'/);
    assert.match(js, /1234567890/);
    assert.match(css, /perspective:/);
    assert.match(css, /@keyframes holoAirframe/);
});
