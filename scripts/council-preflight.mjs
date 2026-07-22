import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const STATE_DIR = join(tmpdir(), 'opencode');
const REPORT_FILE = join(STATE_DIR, 'council-preflight-report.json');

try {
    const checks = {};
    let blocked = false;
    const warnings = [];

    // 1. Temp-Verzeichnis
    try {
        if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(join(STATE_DIR, '.write-test'), 'ok');
        checks.tempDir = 'OK';
    } catch {
        checks.tempDir = 'FAIL';
        blocked = true;
    }

    // 2. Git-Status
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        const lines = status.trim().split('\n').filter(Boolean);
        const conflicts = lines.filter((l) => l.startsWith('UU ') || l.startsWith('AA ') || l.startsWith('DD '));
        checks.git = {
            modified: lines.length,
            conflicts: conflicts.length,
            hasConflicts: conflicts.length > 0,
        };
        if (conflicts.length > 0) {
            blocked = true;
            checks.git.status = 'BLOCKED';
        } else if (lines.length > 0) {
            checks.git.status = 'DIRTY';
            warnings.push(`${lines.length} uncommittete Änderungen`);
        } else {
            checks.git.status = 'CLEAN';
        }
    } catch {
        checks.git = { status: 'UNKNOWN', error: 'git nicht verfügbar' };
    }

    // 3. Build-Status
    try {
        execSync('npm run build', { encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
        checks.build = 'PASSED';
    } catch (e) {
        checks.build = 'FAILED';
        blocked = true;
        const stderr = e.stderr?.toString() || e.message;
        checks.buildError = stderr.split('\n').slice(-5).join('\n');
    }

    // 4. Node-Version
    checks.node = process.version;

    // 5. Git-Branch
    try {
        checks.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
        checks.branch = 'unknown';
    }

    const report = {
        timestamp: new Date().toISOString(),
        verdict: blocked ? 'BLOCKED' : (warnings.length > 0 ? 'DEGRADED' : 'READY'),
        checks,
        warnings,
    };

    writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

    process.stdout.write(JSON.stringify(report, null, 2) + '\n');

    if (blocked) process.exit(1);
} catch (err) {
    process.stderr.write(`Preflight fehlgeschlagen: ${err.message}\n`);
    process.exit(2);
}
