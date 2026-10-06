// Playtest 06.10.2026 (convoy sector on the light storm bridge): the Arcade mission progress was
// 11px #aaa without any backing and the list ran under the fight HUD's rocket column, which sits
// 20px from the right edge and is 112px wide.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function declarations(selectorPattern) {
    return [...css.matchAll(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
}

test('Missionsfortschritt ist mindestens 12px, hell und vom Hintergrund abgesetzt', () => {
    const rules = declarations('#hud\\[data-hud-mode="arcade"\\] #arcade-mission-hud \\.arcade-mission-progress-text').join(';');
    const size = Number(rules.match(/font-size:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    assert.ok(size >= 12, `progress text is ${size}px`);
    assert.match(rules, /color:\s*var\(--hud-text/);
    assert.match(rules, /text-shadow:/);
});

test('Im Kampf-HUD steht die Missionsliste links neben der Raketenspalte', () => {
    const rules = declarations('#hud\\[data-hud-mode="arcade"\\]:has\\(#hunt-hud:not\\(\\.hidden\\)\\) #arcade-mission-hud').join(';');
    const right = Number(rules.match(/right:\s*(\d+)px/)?.[1]);
    assert.ok(right >= 20 + 112 + 8, `mission list right edge is ${right}px from the window edge`);
});
