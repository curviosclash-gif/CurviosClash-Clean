import { readFileSync } from 'node:fs';

const CRITICAL_FILES = [
    'src/network/SessionAdapterBase.js',
    'src/network/LANSessionAdapter.js',
    'src/network/OnlineSessionAdapter.js',
    'src/ui/menu/MenuMultiplayerBridge.js',
    'src/core/runtime/MenuRuntimeSessionService.js',
];

const DIRECT_TIME_OR_RNG_PATTERN = /\b(?:Date\.now|Math\.random|performance\.now)\s*\(/g;

const failures = [];

for (const filePath of CRITICAL_FILES) {
    let text = '';
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        failures.push({
            filePath,
            line: 1,
            detail: 'file_not_readable',
        });
        continue;
    }
    for (const match of text.matchAll(DIRECT_TIME_OR_RNG_PATTERN)) {
        const offset = Number(match.index || 0);
        const line = text.slice(0, offset).split(/\r?\n/).length;
        failures.push({
            filePath,
            line,
            detail: String(match[0]),
        });
    }
}

if (failures.length === 0) {
    console.log('Runtime determinism guard passed.');
    console.log(`Critical files checked: ${CRITICAL_FILES.length}`);
    process.exit(0);
}

console.error('Runtime determinism guard failed.');
for (const failure of failures) {
    console.error(`- ${failure.filePath}:${failure.line} ${failure.detail}`);
}
process.exit(1);
