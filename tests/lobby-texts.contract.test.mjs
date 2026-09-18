import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

// Every message text of the lobby and multiplayer path, as the player reads it.
const FILES = [
    ...readdirSync(new URL('../src/application/session-runtime/', import.meta.url)).map((name) => `application/session-runtime/${name}`),
    ...['LANMatchLobby.js', 'LANSignalingSupport.js', 'OnlineMatchLobby.js', 'OnlineSignalingSupport.js'].map((name) => `network/${name}`),
    'core/runtime/MenuRuntimeMultiplayerService.js',
    'core/runtime/MatchStartValidationService.js',
    'ui/start-setup/StartSetupMultiplayerUiSync.js',
].filter((file) => file.endsWith('.js'));

const TRANSLITERATED = /\b\w*(verfuegbar|benoetig|muess|ungueltig|moeglich|zurueck|geaender|ausgewaehl|unterstuetz|waehl|loesch)\w*\b|\b(fuer|ueber)\b/u;

function messageLiterals(source) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    return Array.from(withoutComments.matchAll(/'([^'\n]*[A-ZÄÖÜa-zäöüß][^'\n]*\s[^'\n]*)'|`([^`\n]*\s[^`\n]*)`/gu),
        (match) => match[1] ?? match[2]);
}

test('lobby messages use real umlauts and German words', () => {
    for (const file of FILES) {
        const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
        for (const text of messageLiterals(source)) {
            assert.doesNotMatch(text, TRANSLITERATED, `${file}: ${text}`);
            assert.doesNotMatch(text, /\bReady\b|\bstale\b|\bannouncen\b|\bJoin\b(?! fehlgeschlagen)/u, `${file}: ${text}`);
        }
    }
});
