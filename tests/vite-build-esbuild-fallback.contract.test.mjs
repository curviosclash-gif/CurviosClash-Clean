import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runner = new URL('../scripts/vite-build.mjs', import.meta.url);

// esbuild hands inputs over 1 MiB to esbuild.exe through a temp file it must delete again, which
// fails on some Windows machines. Every production Vite build has to go through the stream fallback.
test('every production vite build goes through the esbuild stream fallback', () => {
    for (const name of ['build', 'build:web', 'build:game']) {
        const script = pkg.scripts[name];
        assert.doesNotMatch(script, /(^|&&\s*)vite build/, `${name} calls vite build directly`);
        assert.match(script, /node scripts\/vite-build\.mjs/, `${name} must use scripts/vite-build.mjs`);
    }
});

test('vite build runner preloads the fallback and forwards its arguments', () => {
    const source = fs.readFileSync(runner, 'utf8');
    assert.match(source, /esbuild-stream-fallback\.cjs/);
    assert.match(source, /'build', \.\.\.process\.argv\.slice\(2\)/);
});
