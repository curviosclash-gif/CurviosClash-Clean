import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const launcher = read('../../../start-bot-trainingsloop.ps1');
const consumers = [
    read('../scripts/heuristic-improvement-loop.mjs'),
    read('../scripts/heuristic-improvement-match.mjs'),
    read('../scripts/heuristic-improvement-runner.mjs'),
].join('\n');

test('trainingsloop launcher only sets environment variables the search actually reads', () => {
    const names = [...launcher.matchAll(/\$env:([A-Z0-9_]+)\s*=/g)].map((match) => match[1]);
    assert.ok(names.length > 0);
    for (const name of names) {
        assert.ok(consumers.includes(name), `${name} is set by start-bot-trainingsloop.ps1 but read by no script`);
    }
});

test('trainingsloop launcher starts the serial runner and promises no report file', () => {
    assert.match(launcher, /heuristic-improvement-runner\.mjs/);
    assert.doesNotMatch(launcher, /\.md\b|Bericht/i);
});
