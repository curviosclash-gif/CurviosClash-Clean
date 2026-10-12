import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = 'src/ui/menu/MenuTokens.css';

// Style Q "Schachbrett-Tunnel", chosen by the user on 2026-10-13.
const STYLE_Q_COLORS = Object.freeze({
    '--menu-bg': '#0a0d18',
    '--menu-bg-2': '#151b2e',
    '--menu-surface': '#161c2e',
    '--menu-surface-2': '#222b44',
    '--menu-line': '#46557a',
    '--menu-text': '#e9eef8',
    '--menu-muted': '#aab5cb',
    '--menu-accent': '#2fd6ff',
    '--menu-on-accent': '#04121c',
    '--menu-accent-2': '#ff7d34',
    '--menu-on-mode': '#0a0d18',
    '--menu-mode-classic': '#2fd6ff',
    '--menu-mode-arcade': '#ff7d34',
    '--menu-mode-fight': '#ff5d6c',
    '--menu-ok': '#5ee39a',
    '--menu-danger': '#ff6b6b',
    '--menu-focus': '#ffffff',
});

const REQUIRED_LAYOUT_TOKENS = Object.freeze([
    '--menu-focus-width', '--menu-focus-offset', '--menu-radius-s', '--menu-radius-m', '--menu-radius-l',
    '--menu-border', '--menu-font-display', '--menu-font-body', '--menu-surface-pattern',
    '--menu-primary-edge', '--menu-scale', '--menu-font-size-body', '--menu-font-size-button',
]);

function readTokens() {
    const css = readFileSync(path.join(ROOT, TOKENS_PATH), 'utf8');
    const tokens = new Map();
    for (const match of css.matchAll(/(--menu-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(match[1], match[2].trim());
    return { css, tokens };
}

function luminance(hex) {
    const channels = hex.replace('#', '').match(/../g).map((part) => parseInt(part, 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

test('the menu token stylesheet exists and is linked by the game page', () => {
    assert.ok(existsSync(path.join(ROOT, TOKENS_PATH)), `${TOKENS_PATH} is missing`);
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`<link rel="stylesheet" href="${TOKENS_PATH}">`));
});

test('the menu tokens carry the style Q values', () => {
    const { tokens } = readTokens();
    for (const [name, value] of Object.entries(STYLE_Q_COLORS)) {
        assert.equal(tokens.get(name)?.toLowerCase(), value, `${name} must be ${value}`);
    }
    for (const name of REQUIRED_LAYOUT_TOKENS) assert.ok(tokens.has(name), `${name} is missing`);
});

test('menu text sizes never drop below 16 px, even at a small menu scale', () => {
    const { tokens } = readTokens();
    for (const name of ['--menu-font-size-body', '--menu-font-size-button']) {
        assert.match(tokens.get(name) || '', /^max\(16px,\s*calc\(.*var\(--menu-scale\).*\)\)$/,
            `${name} must be max(16px, calc(... var(--menu-scale) ...))`);
    }
});

test('every text colour pair reaches WCAG AA contrast', () => {
    const c = STYLE_Q_COLORS;
    const pairs = [
        ['--menu-text', '--menu-bg'], ['--menu-text', '--menu-surface'], ['--menu-text', '--menu-surface-2'],
        ['--menu-muted', '--menu-bg'], ['--menu-muted', '--menu-surface'], ['--menu-muted', '--menu-surface-2'],
        ['--menu-on-accent', '--menu-accent'], ['--menu-on-mode', '--menu-mode-classic'],
        ['--menu-on-mode', '--menu-mode-arcade'], ['--menu-on-mode', '--menu-mode-fight'],
        ['--menu-accent', '--menu-bg'], ['--menu-ok', '--menu-surface'], ['--menu-danger', '--menu-surface'],
    ];
    for (const [fg, bg] of pairs) {
        const ratio = contrast(c[fg], c[bg]);
        assert.ok(ratio >= 4.5, `${fg} on ${bg} has contrast ${ratio.toFixed(2)}, needs 4.5`);
    }
});

test('the token stylesheet only declares variables, so the current menu looks unchanged', () => {
    const { css } = readTokens();
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...withoutComments.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
    assert.deepEqual(selectors, [':root'], 'only a :root block is allowed until new screens use the tokens');
});
