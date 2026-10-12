// The fight HUD corner vitals print health and shield as "100 / 100" under their label. The
// desktop playtest of 06.10.2026 measured those numbers at 9.9px and dimmed to 72 %, which is
// hard to read in the middle of a fight.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('Lebens- und Schildwerte im Kampf-HUD sind mindestens 12px und kaum abgedunkelt', () => {
    const rules = [...css.matchAll(/#hud:has\(#hunt-hud:not\(\.hidden\)\) \.hunt-meter-heading \.hunt-value\s*\{([^}]*)\}/g)]
        .map((match) => match[1]);
    assert.ok(rules.length > 0, 'the fight HUD vitals value rule exists');
    const last = rules.at(-1);
    const rem = Number(last.match(/font-size:\s*([\d.]+)rem/)?.[1]);
    assert.ok(rem * 16 >= 12, `vitals value is ${rem * 16}px`);
    const opacity = Number(last.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
    assert.ok(opacity >= 0.9, `vitals value opacity is ${opacity}`);
});
