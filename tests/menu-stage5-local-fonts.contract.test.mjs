import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_CSS = 'src/ui/menu/MenuStage5.css';
const FONT_FILES = [
    'assets/fonts/menu/ChakraPetch-Regular.ttf',
    'assets/fonts/menu/ChakraPetch-Bold.ttf',
    'assets/fonts/menu/Barlow-Regular.ttf',
    'assets/fonts/menu/Barlow-SemiBold.ttf',
    'assets/fonts/menu/ChakraPetch-OFL.txt',
    'assets/fonts/menu/Barlow-OFL.txt',
];

test('stage 5 links local style Q typography after the menu foundation', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /MenuPause\.css">\s*<link rel="stylesheet" href="src\/ui\/menu\/MenuStage5\.css">/);
    const css = readFileSync(path.join(ROOT, STAGE_CSS), 'utf8');
    assert.match(css, /font-family: 'Chakra Petch'/);
    assert.match(css, /font-family: 'Barlow'/);
    assert.doesNotMatch(css, /https?:\/\//i);
});

test('stage 5 ships the font files and their SIL OFL notices', () => {
    for (const relativePath of FONT_FILES) {
        assert.ok(existsSync(path.join(ROOT, relativePath)), `${relativePath} is missing`);
    }
    for (const licensePath of FONT_FILES.filter((entry) => entry.endsWith('.txt'))) {
        assert.match(readFileSync(path.join(ROOT, licensePath), 'utf8'), /SIL Open Font License, Version 1\.1/i);
    }
});

test('stage 5 applies the existing Q tokens to live menu and result surfaces', () => {
    const css = readFileSync(path.join(ROOT, STAGE_CSS), 'utf8');
    for (const selector of ['#main-menu .menu-content', '#main-menu .start-btn', '#message-overlay']) {
        assert.ok(css.includes(selector), `${selector} must use the style Q layer`);
    }
    for (const token of ['--menu-font-display', '--menu-font-body', '--menu-surface-pattern', '--menu-accent']) {
        assert.ok(css.includes(token), `${token} must drive the stage 5 layer`);
    }
});
