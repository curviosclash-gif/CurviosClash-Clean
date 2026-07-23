import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BENCHMARK_MANIFEST_VERSION = '1.0.0';
export const BENCHMARK_TASK_TYPES = Object.freeze([
    'production-bug-detection',
    'production-bug-repair',
    'faulty-test-detection',
    'faulty-test-repair',
    'test-smell-classification',
    'flaky-test-detection',
    'clean-negative-control',
]);
export const BENCHMARK_ERROR_CODES = Object.freeze([
    'INFRASTRUCTURE_ERROR',
    'CORPUS_UNAVAILABLE',
    'INVALID_OUTPUT',
    'MODEL_TIMEOUT',
    'HARNESS_ERROR',
    'WORKTREE_CHANGED_EXTERNALLY',
]);

const TASK_TYPE_SET = new Set(BENCHMARK_TASK_TYPES);
const CLASSIFICATION_SET = new Set(['BUG', 'DEFENSIVE', 'INTENTIONAL', 'FALSE', 'UNCERTAIN']);
const SCOPE_SET = new Set(['review', 'repair']);
const DIFFICULTY_SET = new Set(['easy', 'medium', 'hard']);
const SPLIT_SET = new Set(['development', 'validation', 'holdout']);
const PRIVATE_FIELDS = new Set([
    'fixedRevision',
    'expectedClassification',
    'expectedFiles',
    'expectedSymbols',
    'hiddenTestCommands',
    'fixedFiles',
    'goldPatch',
    'gold',
]);

function assert(condition, message) {
    if (!condition) throw new TypeError(message);
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBenchmarkPath(value, field = 'path') {
    assert(typeof value === 'string' && value.trim(), `${field} must be a non-empty relative path.`);
    assert(!/[\0\r\n]/.test(value), `${field} contains a forbidden control character.`);
    const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    assert(!path.posix.isAbsolute(normalized) && !path.win32.isAbsolute(normalized), `${field} must be relative: ${value}`);
    assert(!normalized.split('/').includes('..'), `${field} may not traverse outside its root: ${value}`);
    assert(!normalized.split('/').includes('.git'), `${field} may not reference .git: ${value}`);
    return normalized;
}

function validateStringArray(value, field, { paths = false, allowEmpty = true } = {}) {
    assert(Array.isArray(value) && (allowEmpty || value.length > 0), `${field} must be an array${allowEmpty ? '' : ' with at least one item'}.`);
    return value.map((entry, index) => {
        assert(typeof entry === 'string' && entry.trim(), `${field}[${index}] must be a non-empty string.`);
        assert(!/[\r\n\0]/.test(entry), `${field}[${index}] contains a forbidden control character.`);
        return paths ? normalizeBenchmarkPath(entry, `${field}[${index}]`) : entry.trim();
    });
}

function validateFileMappings(value, field) {
    assert(Array.isArray(value) && value.length > 0, `${field} must contain at least one file mapping.`);
    const targets = new Set();
    return value.map((entry, index) => {
        assert(isRecord(entry), `${field}[${index}] must be an object.`);
        const source = normalizeBenchmarkPath(entry.source, `${field}[${index}].source`);
        const target = normalizeBenchmarkPath(entry.target, `${field}[${index}].target`);
        assert(!targets.has(target), `${field} contains duplicate target ${target}.`);
        targets.add(target);
        assert(/^[a-f0-9]{64}$/.test(entry.sha256), `${field}[${index}].sha256 must be a SHA-256 digest.`);
        return { source, target, sha256: entry.sha256 };
    });
}

function validateRevision(value, field) {
    assert(typeof value === 'string' && (/^[a-f0-9]{40}$/.test(value) || /^sha256:[a-f0-9]{64}$/.test(value)), `${field} must be a pinned git or SHA-256 revision.`);
    return value;
}

export function validateBenchmarkCase(input) {
    assert(isRecord(input), 'Each benchmark case must be an object.');
    assert(typeof input.id === 'string' && /^[a-z0-9][a-z0-9-]{2,79}$/.test(input.id), 'case.id must be a stable kebab-case identifier.');
    for (const field of ['corpus', 'corpusVersion', 'license', 'language', 'problemStatement', 'groupId']) {
        assert(typeof input[field] === 'string' && input[field].trim(), `case.${field} is required.`);
    }
    assert(/^[a-f0-9]{64}$/.test(input.integrityHash), 'case.integrityHash must be a SHA-256 digest.');
    assert(SCOPE_SET.has(input.scope), `Unsupported case.scope: ${input.scope ?? '<missing>'}`);
    assert(TASK_TYPE_SET.has(input.taskType), `Unsupported case.taskType: ${input.taskType ?? '<missing>'}`);
    assert(CLASSIFICATION_SET.has(input.expectedClassification), 'case.expectedClassification is invalid.');
    assert(DIFFICULTY_SET.has(input.difficulty), 'case.difficulty is invalid.');
    assert(SPLIT_SET.has(input.split), 'case.split is invalid.');
    assert(typeof input.negativeControl === 'boolean', 'case.negativeControl must be boolean.');
    assert(Number.isInteger(input.timeoutSeconds) && input.timeoutSeconds >= 1 && input.timeoutSeconds <= 3600, 'case.timeoutSeconds must be between 1 and 3600.');

    const visibleTestCommands = validateStringArray(input.visibleTestCommands, 'case.visibleTestCommands', { allowEmpty: false });
    const hiddenTestCommands = validateStringArray(input.hiddenTestCommands, 'case.hiddenTestCommands', { allowEmpty: false });
    assert(!visibleTestCommands.some((command) => hiddenTestCommands.includes(command)), 'Visible and hidden test commands may not overlap.');

    const visibleFiles = validateFileMappings(input.visibleFiles, 'case.visibleFiles');
    const fixedFiles = validateFileMappings(input.fixedFiles, 'case.fixedFiles');
    if (visibleFiles.length === 1) {
        assert(input.integrityHash === visibleFiles[0].sha256, 'case.integrityHash must match its single visible file.');
        assert(input.buggyRevision === `sha256:${visibleFiles[0].sha256}`, 'case.buggyRevision must match its single visible file.');
    }
    if (fixedFiles.length === 1) {
        assert(input.fixedRevision === `sha256:${fixedFiles[0].sha256}`, 'case.fixedRevision must match its single fixed file.');
    }
    const allowedChanges = validateStringArray(input.allowedChanges, 'case.allowedChanges', { paths: true, allowEmpty: false });
    const forbiddenChanges = validateStringArray(input.forbiddenChanges, 'case.forbiddenChanges', { paths: true, allowEmpty: false });
    assert(!allowedChanges.some((file) => forbiddenChanges.includes(file)), 'Allowed and forbidden changes may not overlap.');

    const result = {
        ...input,
        corpus: input.corpus.trim(),
        corpusVersion: input.corpusVersion.trim(),
        license: input.license.trim(),
        language: input.language.trim(),
        problemStatement: input.problemStatement.trim(),
        groupId: input.groupId.trim(),
        buggyRevision: validateRevision(input.buggyRevision, 'case.buggyRevision'),
        fixedRevision: validateRevision(input.fixedRevision, 'case.fixedRevision'),
        expectedFiles: validateStringArray(input.expectedFiles, 'case.expectedFiles', { paths: true }),
        expectedSymbols: validateStringArray(input.expectedSymbols, 'case.expectedSymbols'),
        requiredEvidence: validateStringArray(input.requiredEvidence, 'case.requiredEvidence', { allowEmpty: false }),
        visibleTestCommands,
        hiddenTestCommands,
        allowedChanges,
        forbiddenChanges,
        visibleFiles,
        fixedFiles,
    };
    if (result.negativeControl) {
        assert(result.taskType === 'clean-negative-control', 'Negative controls must use clean-negative-control.');
        assert(result.expectedFiles.length === 0 && result.expectedSymbols.length === 0, 'Negative controls may not encode expected bug locations.');
    }
    return Object.freeze(result);
}

export function validateBenchmarkManifest(input) {
    assert(isRecord(input), 'Benchmark manifest must be an object.');
    assert(input.schemaVersion === BENCHMARK_MANIFEST_VERSION, `Unsupported benchmark manifest version: ${input.schemaVersion ?? '<missing>'}`);
    assert(typeof input.splitSeed === 'string' && input.splitSeed.trim(), 'manifest.splitSeed is required.');
    assert(Array.isArray(input.cases) && input.cases.length > 0, 'manifest.cases must not be empty.');
    const cases = input.cases.map(validateBenchmarkCase);
    const ids = new Set();
    const groups = new Map();
    for (const benchmarkCase of cases) {
        assert(!ids.has(benchmarkCase.id), `Duplicate benchmark case id: ${benchmarkCase.id}`);
        ids.add(benchmarkCase.id);
        const priorSplit = groups.get(benchmarkCase.groupId);
        assert(!priorSplit || priorSplit === benchmarkCase.split, `Group ${benchmarkCase.groupId} crosses split boundaries.`);
        groups.set(benchmarkCase.groupId, benchmarkCase.split);
    }
    return Object.freeze({ schemaVersion: input.schemaVersion, splitSeed: input.splitSeed.trim(), cases: Object.freeze(cases) });
}

export function createPublicBenchmarkCase(input) {
    const benchmarkCase = validateBenchmarkCase(input);
    const publicCase = {
        schemaVersion: BENCHMARK_MANIFEST_VERSION,
        id: benchmarkCase.id,
        corpus: benchmarkCase.corpus,
        corpusVersion: benchmarkCase.corpusVersion,
        integrityHash: benchmarkCase.integrityHash,
        license: benchmarkCase.license,
        language: benchmarkCase.language,
        scope: benchmarkCase.scope,
        taskType: benchmarkCase.taskType,
        buggyRevision: benchmarkCase.buggyRevision,
        problemStatement: benchmarkCase.problemStatement,
        requiredEvidence: [...benchmarkCase.requiredEvidence],
        visibleTestCommands: [...benchmarkCase.visibleTestCommands],
        allowedChanges: [...benchmarkCase.allowedChanges],
        forbiddenChanges: [...benchmarkCase.forbiddenChanges],
        timeoutSeconds: benchmarkCase.timeoutSeconds,
        difficulty: benchmarkCase.difficulty,
        split: benchmarkCase.split,
        negativeControl: benchmarkCase.negativeControl,
        files: benchmarkCase.visibleFiles.map(({ target, sha256 }) => ({ path: target, sha256 })),
    };
    assertPublicBenchmarkCase(publicCase);
    return Object.freeze(publicCase);
}

export function assertPublicBenchmarkCase(publicCase) {
    assert(isRecord(publicCase), 'Public benchmark case must be an object.');
    const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!isRecord(value)) return;
        for (const [key, child] of Object.entries(value)) {
            assert(!PRIVATE_FIELDS.has(key), `Private benchmark field leaked into public view: ${key}`);
            visit(child);
        }
    };
    visit(publicCase);
    return true;
}

async function assertFileIntegrity(repositoryRoot, mapping, field) {
    const repositoryReal = await realpath(repositoryRoot);
    const source = path.resolve(repositoryReal, mapping.source);
    const relative = path.relative(repositoryReal, source);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${field} escaped the repository.`);
    const sourceStat = await lstat(source);
    assert(sourceStat.isFile() && !sourceStat.isSymbolicLink(), `${field} must be a regular non-symlink file.`);
    const sourceReal = await realpath(source);
    const realRelative = path.relative(repositoryReal, sourceReal);
    assert(!realRelative.startsWith('..') && !path.isAbsolute(realRelative), `${field} resolves outside the repository.`);
    const content = await readFile(sourceReal);
    const digest = createHash('sha256').update(content).digest('hex');
    assert(digest === mapping.sha256, `${field} failed its integrity check.`);
    return sourceReal;
}

async function listSnapshotFiles(root, current = root) {
    const files = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        assert(!entry.isSymbolicLink(), `Snapshot contains a symlink or junction: ${relative}`);
        assert(!relative.split('/').includes('.git'), `Snapshot contains .git data: ${relative}`);
        assert(!/\.(?:patch|diff)$/i.test(entry.name), `Snapshot contains a dataset patch: ${relative}`);
        assert(!/(?:private|gold|fixed-revision)/i.test(entry.name), `Snapshot contains private evaluator metadata: ${relative}`);
        if (entry.isDirectory()) files.push(...await listSnapshotFiles(root, absolute));
        else if (entry.isFile()) files.push(relative);
    }
    return files.sort();
}

export async function hashBenchmarkSnapshot(snapshotRoot) {
    const files = await listSnapshotFiles(snapshotRoot);
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file).update('\0').update(await readFile(path.join(snapshotRoot, file))).update('\0');
    }
    return { digest: hash.digest('hex'), files };
}

export async function createBenchmarkSnapshot({ benchmarkCase: input, repositoryRoot, tempRoot, arm }) {
    const benchmarkCase = validateBenchmarkCase(input);
    assert(typeof arm === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(arm), 'Snapshot arm must be a stable kebab-case label.');
    const base = path.resolve(tempRoot);
    const snapshotRoot = path.join(base, 'snapshots', benchmarkCase.id, `${arm}-${randomUUID()}`);
    const relative = path.relative(base, snapshotRoot);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Snapshot root escaped the configured temporary directory.');
    await mkdir(snapshotRoot, { recursive: true });

    for (const [index, mapping] of benchmarkCase.visibleFiles.entries()) {
        const source = await assertFileIntegrity(repositoryRoot, mapping, `case.visibleFiles[${index}]`);
        const target = path.resolve(snapshotRoot, mapping.target);
        const targetRelative = path.relative(snapshotRoot, target);
        assert(targetRelative && !targetRelative.startsWith('..') && !path.isAbsolute(targetRelative), `Snapshot target escaped its root: ${mapping.target}`);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
    }

    const publicCase = createPublicBenchmarkCase(benchmarkCase);
    await writeFile(path.join(snapshotRoot, 'case.public.json'), `${JSON.stringify(publicCase, null, 2)}\n`, 'utf8');
    const snapshot = await hashBenchmarkSnapshot(snapshotRoot);
    return Object.freeze({ arm, root: snapshotRoot, digest: snapshot.digest, files: Object.freeze(snapshot.files), publicCase });
}

export async function validateManifestSources(manifest, repositoryRoot) {
    const validated = validateBenchmarkManifest(manifest);
    for (const benchmarkCase of validated.cases) {
        for (const [index, mapping] of benchmarkCase.visibleFiles.entries()) {
            await assertFileIntegrity(repositoryRoot, mapping, `${benchmarkCase.id}.visibleFiles[${index}]`);
        }
        for (const [index, mapping] of benchmarkCase.fixedFiles.entries()) {
            await assertFileIntegrity(repositoryRoot, mapping, `${benchmarkCase.id}.fixedFiles[${index}]`);
        }
    }
    return validated;
}
