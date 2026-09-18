import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Decision 18.09.: the expert password stays, but the page must not show it as the placeholder.
test('the expert password field does not reveal the password', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const field = html.match(/<input[^>]*id="expert-password-input"[^>]*>/)?.[0] || '';
    assert.ok(field, 'password field exists');
    assert.doesNotMatch(field, /1307/);
    assert.match(field, /placeholder="Vierstelliger Code"/);
});
