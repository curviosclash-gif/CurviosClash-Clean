import { execSync } from 'node:child_process';

function normalizePath(filePath) {
    return String(filePath || '').trim().replace(/\\/g, '/');
}

function parseList(raw) {
    return String(raw || '')
        .split(/\r?\n/)
        .map((line) => normalizePath(line))
        .filter((line) => line.length > 0);
}

export function collectTouchedFiles({ baseRef = 'HEAD' } = {}) {
    const fromEnv = normalizePath(process.env.ARCH_TOUCHED_FILES || '');
    if (fromEnv) {
        return Array.from(new Set(parseList(fromEnv.replace(/;/g, '\n'))));
    }

    const fromCsv = normalizePath(process.env.ARCH_TOUCHED_FILES_CSV || '');
    if (fromCsv) {
        return Array.from(new Set(
            fromCsv
                .split(',')
                .map((entry) => normalizePath(entry))
                .filter((entry) => entry.length > 0)
        ));
    }

    const commands = [
        `git diff --name-only --diff-filter=ACMRTUXB ${baseRef}`,
        `git diff --name-only --cached --diff-filter=ACMRTUXB ${baseRef}`,
    ];

    const touched = [];
    for (const command of commands) {
        try {
            const output = execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
            touched.push(...parseList(output));
        } catch {
            // Ignore Git lookup errors and fallback to current list.
        }
    }

    return Array.from(new Set(touched));
}
