import { createHash } from 'node:crypto';
import path from 'node:path';

export const COUNCIL_SCOPES = Object.freeze(['arch', 'refactor', 'review', 'sec', 'test', 'perf']);
export const FINDING_SEVERITIES = Object.freeze(['🔴', '🟠', '🟡']);
export const VERIFY_RESULTS = Object.freeze(['TRUE', 'FALSE', 'UNCERTAIN']);
export const EVIDENCE_TYPES = Object.freeze(['test', 'reproduction', 'contract', 'invariant', 'static-rule']);
export const MAX_REPAIR_ROUNDS = 2;
export const MAX_ADDITIONAL_REPAIR_FILES = 5;

const ACTIONABLE_SEVERITIES = new Set(['🔴', '🟠']);
const SCOPE_SET = new Set(COUNCIL_SCOPES);
const SEVERITY_SET = new Set(FINDING_SEVERITIES);
const VERIFY_SET = new Set(VERIFY_RESULTS);
const EVIDENCE_SET = new Set(EVIDENCE_TYPES);

function assert(condition, message) {
    if (!condition) throw new TypeError(message);
}

function normalizeRepositoryPath(file, repositoryRoot) {
    assert(typeof file === 'string' && file.trim(), 'finding.file muss ein relativer Repository-Pfad sein.');
    const normalized = file.trim().replaceAll('\\', '/').replace(/^\.\//, '');
    assert(!path.posix.isAbsolute(normalized) && !path.win32.isAbsolute(normalized), `finding.file darf nicht absolut sein: ${file}`);
    assert(!normalized.split('/').includes('..'), `finding.file darf das Repository nicht verlassen: ${file}`);
    if (repositoryRoot) {
        const root = path.resolve(repositoryRoot);
        const resolved = path.resolve(root, normalized);
        assert(resolved === root || resolved.startsWith(`${root}${path.sep}`), `finding.file liegt außerhalb des Repositorys: ${file}`);
    }
    return normalized;
}

function stableFindingId(finding) {
    const fingerprint = [
        finding.scope,
        finding.file.toLowerCase(),
        finding.category.toLowerCase(),
        finding.symbol.toLowerCase(),
    ].join(':');
    const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 12);
    return `${finding.scope}:${finding.category}:${digest}`;
}

export function isConfirmedFinding(finding) {
    return finding.verifyRun1 === 'TRUE' && finding.verifyRun2 === 'TRUE';
}

export function validateFinding(input, { repositoryRoot } = {}) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'Jedes Finding muss ein Objekt sein.');
    assert(SEVERITY_SET.has(input.severity), `Ungültige Finding-Severity: ${input.severity ?? '<fehlt>'}`);
    assert(SCOPE_SET.has(input.scope), `Ungültiger Finding-Scope: ${input.scope ?? '<fehlt>'}`);

    const file = normalizeRepositoryPath(input.file, repositoryRoot);
    const line = Number(input.line);
    const endLine = input.endLine === undefined ? line : Number(input.endLine);
    assert(Number.isInteger(line) && line >= 1, 'finding.line muss eine positive Ganzzahl sein.');
    assert(Number.isInteger(endLine) && endLine >= line, 'finding.endLine muss mindestens finding.line entsprechen.');
    assert(typeof input.category === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(input.category), 'finding.category muss ein stabiler kebab-case Bezeichner sein.');
    assert(typeof input.symbol === 'string' && /^[a-zA-Z0-9_$.-]{1,128}$/.test(input.symbol), 'finding.symbol muss den stabilen Contract-, Funktions- oder Regelanker benennen.');
    assert(typeof input.problem === 'string' && input.problem.trim().length >= 8, 'finding.problem muss eine konkrete Beschreibung enthalten.');

    for (const field of ['verifyRun1', 'verifyRun2']) {
        assert(VERIFY_SET.has(input[field]), `${field} muss TRUE, FALSE oder UNCERTAIN sein.`);
    }

    const finding = {
        severity: input.severity,
        scope: input.scope,
        file,
        line,
        endLine,
        category: input.category,
        symbol: input.symbol,
        problem: input.problem.trim(),
        verifyRun1: input.verifyRun1,
        verifyRun2: input.verifyRun2,
    };

    if (ACTIONABLE_SEVERITIES.has(finding.severity) && isConfirmedFinding(finding)) {
        assert(input.evidence && typeof input.evidence === 'object', 'Bestätigte 🔴/🟠-Findings benötigen Ursachen-Evidence.');
        assert(EVIDENCE_SET.has(input.evidence.type), `Ungültiger Evidence-Typ: ${input.evidence.type ?? '<fehlt>'}`);
        assert(typeof input.evidence.detail === 'string' && input.evidence.detail.trim().length >= 8, 'Evidence benötigt ein konkretes Detail.');
        finding.evidence = { type: input.evidence.type, detail: input.evidence.detail.trim() };
    }

    const generatedId = stableFindingId(finding);
    if (input.id !== undefined) {
        assert(input.id === generatedId, `Finding-ID stimmt nicht mit dem stabilen Fingerprint überein; erwartet: ${generatedId}`);
    }
    finding.id = generatedId;
    return Object.freeze(finding);
}

export function parseFindingsJson(value, options) {
    if (!value) return [];
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new TypeError(`Ungültiges Findings JSON: ${error.message}`);
    }
    assert(Array.isArray(parsed), 'Findings JSON muss ein Array sein.');
    const findings = parsed.map((finding) => validateFinding(finding, options));
    const ids = new Set();
    for (const finding of findings) {
        assert(!ids.has(finding.id), `Doppelte Finding-ID: ${finding.id}`);
        ids.add(finding.id);
    }
    return findings;
}

export function confirmedActionableFindings(entry) {
    return (entry?.openFindings || []).filter((finding) =>
        ACTIONABLE_SEVERITIES.has(finding.severity) && isConfirmedFinding(finding));
}

function actionableIds(entry) {
    return new Set(confirmedActionableFindings(entry).map((finding) => finding.id));
}

export function detectFindingOscillation(history) {
    if (history.length < 3) return false;
    const before = actionableIds(history.at(-3));
    const middle = actionableIds(history.at(-2));
    const current = actionableIds(history.at(-1));
    return [...before].some((id) => !middle.has(id) && current.has(id));
}

export function classifyLoopState(history) {
    const current = history.at(-1);
    if (!current) return { exit: false, reason: '' };
    if (!current.buildPassed) return { exit: true, reason: 'build_failed' };
    if (!current.testsPassed) return { exit: true, reason: 'tests_failed' };
    if (current.budget?.passed === false) return { exit: true, reason: 'repair_budget_exceeded' };
    if (current.verificationDisagreed) return { exit: true, reason: 'verification_disagreed' };
    if (current.regressionIntroduced) return { exit: true, reason: 'regression_introduced' };
    if (detectFindingOscillation(history)) return { exit: true, reason: 'oscillation_detected' };

    const currentIds = actionableIds(current);
    if (currentIds.size === 0) return { exit: true, reason: 'passed' };
    if (history.length >= 2) {
        const previousIds = actionableIds(history.at(-2));
        const persistent = [...currentIds].some((id) => previousIds.has(id));
        if (persistent) return { exit: true, reason: 'finding_persisted' };
    }
    return { exit: false, reason: '' };
}

export function detectNewRegression(history, findings) {
    if (history.length === 0) return false;
    const previous = actionableIds(history.at(-1));
    return confirmedActionableFindings({ openFindings: findings }).some((finding) => !previous.has(finding.id));
}

export function selectRepairScopes(findings) {
    return [...new Set(confirmedActionableFindings({ openFindings: findings }).map((finding) => finding.scope))];
}

export function diffSnapshotFiles(baseline = {}, current = {}) {
    const files = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    return [...files].filter((file) => baseline[file] !== current[file]).sort();
}

export function evaluateRepairBudget({ iteration, findings, changedFiles, nameStatuses = [] }) {
    if (iteration <= 1) return { passed: true, violations: [] };
    const targetFiles = new Set(confirmedActionableFindings({ openFindings: findings }).map((finding) => finding.file));
    const additionalFiles = changedFiles.filter((file) => !targetFiles.has(file) && !file.startsWith('tests/'));
    const violations = [];
    if (additionalFiles.length > MAX_ADDITIONAL_REPAIR_FILES) violations.push(`additional_files:${additionalFiles.length}`);
    if (changedFiles.some((file) => file === 'package.json' || file.endsWith('package-lock.json'))) violations.push('dependency_change');
    if (changedFiles.some((file) => /(^|\/)contracts?\//i.test(file))) violations.push('public_contract_change');
    if (nameStatuses.some((entry) => /^[DR]/.test(entry.status) && changedFiles.includes(entry.file))) violations.push('delete_or_rename');
    return { passed: violations.length === 0, violations, additionalFiles };
}

export function selectGateCommands(files, { final = false } = {}) {
    const commands = new Map();
    const add = (kind, command) => commands.set(command, { kind, command });
    const matches = (pattern) => files.some((file) => pattern.test(file));

    if (matches(/^(\.opencode\/|scripts\/council-|tests\/council-runner)/)) {
        add('test', 'npm run council:check');
        add('test', 'npm run council:test');
    }
    if (matches(/^electron\//)) {
        add('build', 'npm run build:app');
        add('test', 'npm run test:contract:fast');
    }
    if (matches(/^server\//)) add('test', 'npm run test:contract:fast');
    if (matches(/^editor\//)) {
        add('build', 'npm run build:app');
        add('test', 'npm run test:editor-ui');
    }
    if (matches(/(^|\/)(physics|collision|camera)/i)) add('test', 'npm run test:physics');
    if (files.length > 0 && commands.size === 0) add('test', 'npm run test:contract:fast');
    if (final) {
        add('build', 'npm run build:app');
        add('test', 'npm run test:contract:fast');
    }
    return [...commands.values()];
}
