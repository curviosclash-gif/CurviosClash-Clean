import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Verzeichnisse statt Einzeldateien: die alte Liste hat fuenf Pfade geprueft und dabei
// eine Datei mitgezaehlt, die inzwischen nur noch ein Re-Export ist. Die eigentliche
// Lobby-Logik lag daneben und war ungeprueft.
export const SCAN_TARGETS = [
    'src/network',
    'src/application/session-runtime',
    'src/entities',
    'src/modes',
    'src/hunt',
    'src/state',
    'src/core/arcade',
    'src/core/runtime',
    'src/ui/menu/MenuMultiplayerBridge.js',
];

// Ausnahmen gelten nur fuer genau eine unveraenderte Quellzeile und eine feste Zahl
// direkter Verweise. Dadurch wird eine neue Verwendung in derselben Datei oder Zeile
// sichtbar, statt durch eine Datei-Ausnahme verdeckt zu werden.
const sourceException = (snippet, tokens, reason, expectedLines = 1) => ({
    snippet,
    tokens,
    expectedLines,
    reason,
});
const exception = (snippet, token, uses, reason, expectedLines = 1) =>
    sourceException(snippet, { [token]: uses }, reason, expectedLines);
export const SOURCE_EXCEPTIONS = {
// Visuelle Zufallsstreuung und Animationsphasen beeinflussen keinen Simulationszustand.
    'src/entities/Particles.js': [
        exception('                ? performance.now()', 'performance.now', 1, 'particle event timestamp is presentation telemetry'),
        exception('                : Date.now(),', 'Date.now', 1, 'particle event timestamp is presentation telemetry fallback'),
        exception('            const theta = Math.random() * Math.PI * 2;', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            const phi = Math.acos(2 * Math.random() - 1);', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            const r = speed * (0.5 + Math.random() * 0.5);', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            this.lifetimes[idx] = life * (0.8 + Math.random() * 0.4);', 'Math.random', 1, 'visual-only particle lifetime variation'),
        exception('            this.scales[idx] = size * (0.5 + Math.random() * 0.5);', 'Math.random', 1, 'visual-only particle size variation'),
        exception('            const angle = Math.random() * Math.PI * 2;', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            const radial = Math.random() * spread;', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            const forwardSpeed = speed * (0.65 + Math.random() * 0.6);', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            this._tmpVelocity.addScaledVector(this._tmpDirection, Math.random() * drift * speed);', 'Math.random', 1, 'visual-only particle scatter'),
        exception('            this.lifetimes[idx] = life * (0.85 + Math.random() * 0.35);', 'Math.random', 1, 'visual-only particle lifetime variation'),
        exception('            this.scales[idx] = size * (0.6 + Math.random() * 0.45);', 'Math.random', 1, 'visual-only particle size variation'),
    ],
    'src/entities/player/PlayerView.js': [
        exception('        this._tmpExhaustSample.addScaledVector(this._tmpExhaustDirection, Math.random() * jitter);', 'Math.random', 1, 'visual-only exhaust jitter'),
        exception('        this._tmpExhaustSample.x += (Math.random() - 0.5) * jitter;', 'Math.random', 1, 'visual-only exhaust jitter'),
        exception('        this._tmpExhaustSample.y += (Math.random() - 0.5) * jitter;', 'Math.random', 1, 'visual-only exhaust jitter'),
        exception('        this._tmpExhaustSample.z += (Math.random() - 0.5) * jitter;', 'Math.random', 1, 'visual-only exhaust jitter'),
    ],
    'src/entities/arena/ArenaBuilder.js': [
        exception('            positions[i * 3] = (Math.random() - 0.5) * sx;', 'Math.random', 1, 'visual-only decoration scatter'),
        exception('            positions[i * 3 + 1] = Math.random() * sy;', 'Math.random', 1, 'visual-only decoration scatter'),
        exception('            positions[i * 3 + 2] = (Math.random() - 0.5) * sz;', 'Math.random', 1, 'visual-only decoration scatter'),
    ],
    'src/entities/arena/portal/SpecialGateRuntime.js': [
        exception('        const time = performance.now() * 0.001;', 'performance.now', 1, 'visual-only gate animation phase'),
    ],
    'src/entities/arena/portal/PortalRuntimeSystem.js': [
        exception('        const time = performance.now() * 0.001;', 'performance.now', 1, 'visual-only portal animation phase'),
    ],
    'src/entities/runtime/EntitySetupOps.js': [
        exception('        return toMatchSeed(Math.floor(Math.random() * 0xffffffff)) || 1;', 'Math.random', 1, 'one-time match seed entropy when no seed is supplied'),
    ],

    // Echte Transportzeiten, Heartbeats, Throttling und Beobachtungs-Budgets.
    'src/network/LatencyMonitor.js': [
        exception('        peer.lastPingSent = performance.now();', 'performance.now', 1, 'measures real transport round-trip time'),
        exception('        const rtt = performance.now() - peer.lastPingSent;', 'performance.now', 1, 'measures real transport round-trip time'),
        exception('            const now = performance.now();', 'performance.now', 1, 'measures real transport round-trip time'),
        sourceException('                const pingId = `ping-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;', {
            'Date.now': 1,
            'Math.random': 1,
        }, 'transport ping identifier timestamp and entropy'),
    ],
    'src/network/PeerConnectionManager.js': [
        exception('        const hb = { lastPong: Date.now(), intervalId: null };', 'Date.now', 1, 'real heartbeat timeout origin'),
        exception('            if (Date.now() - hb.lastPong > HEARTBEAT_TIMEOUT) {', 'Date.now', 1, 'real heartbeat timeout'),
        exception('                    ts: Date.now(),', 'Date.now', 1, 'transport heartbeat timestamp'),
        exception('        hb.lastPong = Date.now();', 'Date.now', 1, 'real heartbeat response time'),
    ],
    'src/network/DataChannelManager.js': [
        exception('        const now = Date.now();', 'Date.now', 1, 'real data-channel timeout timing'),
    ],
    'src/network/LANSignalingClient.js': [
        exception('export async function waitForHostOffer({ signalingUrl, playerId, token, now = () => Date.now() }) {', 'Date.now', 1, 'injectable signaling timeout clock with wall-clock default'),
    ],
    'src/entities/ai/inference/WebSocketInferenceBridge.js': [
        exception('        this._now = typeof options.now === \'function\' ? options.now : () => Date.now();', 'Date.now', 1, 'injectable trainer transport clock default'),
    ],
    'src/entities/ai/ObservationBridgePolicy.js': [
        exception('        const now = Date.now();', 'Date.now', 1, 'real trainer bridge failure age'),
        exception('this._bridgeFailureState.updatedAt = Date.now();', 'Date.now', 1, 'trainer bridge health metadata', 3),
    ],
    'src/entities/systems/PlayerInputSystem.js': [
        exception('        return performance.now();', 'performance.now', 1, 'real observation reuse budget timing'),
        exception('    return Date.now();', 'Date.now', 1, 'real observation reuse budget fallback'),
        exception('        const now = Date.now();', 'Date.now', 1, 'input log throttling', 3),
    ],

    // Clockless score callers intentionally retain wall/performance fallback; this is
    // separate from the simulation-clock path used when an entity manager is present.
    'src/hunt/HuntTargetingPerf.js': [
        exception('        return performance.now();', 'performance.now', 1, 'targeting performance measurement'),
        exception('    return Date.now();', 'Date.now', 1, 'targeting performance fallback'),
    ],
    'src/hunt/HuntTargetingOps.js': [
        sourceException('        ? (typeof performance !== \'undefined\' && typeof performance.now === \'function\' ? performance.now() : Date.now())', {
            'performance.now': 1,
            'Date.now': 1,
        }, 'optional targeting profiler duration and fallback'),
    ],
    'src/hunt/HuntScoring.js': [
        exception('        return performance.now() * 0.001;', 'performance.now', 1, 'clockless hunt scoring fallback'),
        exception('    return Date.now() * 0.001;', 'Date.now', 1, 'clockless hunt scoring fallback'),
    ],
    'src/hunt/HealthSystem.js': [
        exception('        return performance.now() * 0.001;', 'performance.now', 1, 'clockless hunt health fallback'),
        exception('    return Date.now() * 0.001;', 'Date.now', 1, 'clockless hunt health fallback'),
    ],

    // Replay presentation time, input-lock UI time, and epoch/persistence timestamps.
    'src/state/RoundRecorder.js': [
        exception('        return this.roundStartTime > 0 ? (performance.now() - this.roundStartTime) / 1000 : 0;', 'performance.now', 1, 'real recording/replay presentation timeline'),
        exception('        this.roundStartTime = performance.now();', 'performance.now', 1, 'real recording/replay presentation timeline origin'),
    ],
    'src/state/RoundStateTickSystem.js': [
        exception('                ? performance.now() / 1000', 'performance.now', 1, 'monotonic post-match input-lock UI timer'),
    ],
    'src/state/telemetry/TelemetryHistoryEntry.js': [
        exception('        const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;', 'Date.now', 1, 'wall-clock telemetry history range'),
    ],
    'src/state/AuthoringTelemetrySession.js': [
        exception('    return `${startedAtMs.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;', 'Math.random', 1, 'telemetry identifier entropy'),
        exception('        this.now = typeof options.now === \'function\' ? options.now : () => Date.now();', 'Date.now', 1, 'injectable telemetry timestamp default'),
    ],
    'src/state/arcade/ArcadeMissionState.js': [
        exception('        id: `${typeId}-${Date.now().toString(36)}`,', 'Date.now', 1, 'mission instance identifier timestamp'),
        exception('                const nowMs = toSafeNumber(event.nowMs, Date.now());', 'Date.now', 1, 'clockless mission event fallback', 2),
    ],
    'src/state/MatchLifecycleSessionRuntimeState.js': [
        exception('            updatedAt: Date.now(),', 'Date.now', 1, 'persisted lifecycle epoch metadata', 3),
    ],
    'src/state/MatchLifecycleSessionOrchestrator.js': [
        exception('        this._sessionRuntimeState.finalize.updatedAt = Date.now();', 'Date.now', 1, 'persisted lifecycle epoch metadata'),
    ],

    // Arcade gameplay clocks are already dt/gameplayTimeMs based. These remaining
    // sources create epoch IDs, persisted results, profile/reward timestamps, or defaults.
    'src/core/arcade/WeaponRaceRuntime.js': [
        sourceException('    return Number(globalThis.performance?.now?.()) || Date.now();', {
            'performance.now': 1,
            'Date.now': 1,
        }, 'monotonic reward persistence retry window; race uses simulation clock'),
        exception('    constructor({ now = () => Date.now(), retryNow = monotonicNowMs, getRecordStore = () => null } = {}) {', 'Date.now', 1, 'epoch clock for profile awards; race uses simulation clock'),
    ],
    'src/core/arcade/ArenaWavesRuntime.js': [
        exception('    constructor({ now = () => Date.now(), getRecordStore = () => null, getPlayerRewardTarget = (_playerIndex) => null, requestMapTransition = null } = {}) {', 'Date.now', 1, 'epoch clock for persisted wave rewards'),
    ],
    'src/core/arcade/DemolitionComboOps.js': [
        exception('    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));', 'Date.now', 1, 'run metadata fallback; combo decay uses gameplayTimeMs'),
    ],
    'src/core/arcade/ArcadeRunRuntime.js': [
        exception('        this.now = typeof options.now === \'function\' ? options.now : () => Date.now();', 'Date.now', 1, 'injected epoch clock default'),
        exception('    _nextRunId(nowMs = Date.now()) {', 'Date.now', 1, 'epoch run identifier default'),
        exception('    _prepareIntermission(nowMs = Date.now()) {', 'Date.now', 1, 'epoch intermission metadata default'),
        exception('        const nowMs = Math.max(0, toSafeNumber(this.now(), Date.now()));', 'Date.now', 1, 'epoch run/intermission metadata fallback', 5),
        exception('    _recordSectorHistoryEntry(payload, nowMs = Date.now()) {', 'Date.now', 1, 'persisted sector history epoch default'),
        exception('            endedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),', 'Date.now', 1, 'persisted sector history epoch fallback'),
        exception('    _recordDailyResult(nowMs = Date.now()) { return recordArcadeDailyResult(this, nowMs); }', 'Date.now', 1, 'persisted reward epoch default'),
        exception('    _finalizeRun(nowMs = Date.now()) { return finalizeArcadeRun(this, nowMs); }', 'Date.now', 1, 'persisted run epoch default'),
    ],
    'src/core/arcade/ArcadeRunParcoursSectorOps.js': [
        exception('    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));', 'Date.now', 1, 'epoch sector completion metadata fallback'),
    ],
    'src/core/arcade/ArcadeRunRankingOps.js': [
        exception('        runtime.rankContext = createArcadeRankContext({ runId: `${Date.now()}-${config.arcade.seed || 0}`, runType,', 'Date.now', 1, 'ranking context identifier timestamp'),
    ],
    'src/core/arcade/ArcadeRunCompletionOps.js': [
        exception('export function recordArcadeDailyResult(runtime, nowMs = Date.now()) {', 'Date.now', 1, 'persisted daily result epoch default'),
        exception('export function finalizeArcadeRun(runtime, nowMs = Date.now()) {', 'Date.now', 1, 'persisted run epoch default'),
        exception('        generatedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),', 'Date.now', 1, 'persisted run epoch fallback'),
    ],
    'src/core/arcade/ArcadeIntermissionPlanOps.js': [
        exception('export function prepareArcadeIntermissionState(runtime, nowMs = Date.now()) {', 'Date.now', 1, 'persisted intermission epoch default'),
        exception('        generatedAtMs: Math.max(0, toSafeNumber(nowMs, Date.now())),', 'Date.now', 1, 'persisted intermission epoch fallback'),
    ],
    'src/state/arcade/EndlessParcoursSettlementStore.js': [
        exception('export function retryEndlessSettlements(store, nowMs = Date.now()) {', 'Date.now', 1, 'persisted settlement epoch default'),
    ],
    'src/state/arcade/ArcadeVehicleRewardBinding.js': [
        exception('export function awardBoundArcadeVehicleXp(profiles, binding, amount, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile reward epoch default'),
        exception('export function awardBoundArcadeVehicleXpInStore(store, binding, amount, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile reward epoch default'),
    ],
    'src/state/arcade/ArcadeVehicleProfileInternals.js': [
        exception('export function backupUnreadableProfileRecord(store, record, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile backup epoch default'),
        exception('    return new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString();', 'Date.now', 1, 'persisted profile epoch fallback'),
    ],
    'src/state/arcade/ArcadeVehicleProfile.js': [
        exception('export function createArcadeVehicleProfile(vehicleId, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
        exception('export function addXp(profile, amount, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
        exception('export function applyUpgrade(profile, slotName, tier, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
        exception('export function purchaseUpgrade(profile, slotName, targetTier, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
        exception('export function applyLoadoutPreset(profile, upgrades, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
        exception('export function getOrCreateProfile(profiles, vehicleId, nowMs = Date.now()) {', 'Date.now', 1, 'persisted profile epoch default'),
    ],
    'src/state/arcade/ArcadeRunState.js': [
        exception('    return new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString();', 'Date.now', 1, 'persisted run epoch fallback'),
        exception('    nowMs = Date.now(),', 'Date.now', 1, 'persisted run epoch default'),
        exception('export function setArcadeRunPhase(state, nextPhase, nowMs = Date.now()) {', 'Date.now', 1, 'persisted run epoch default'),
        exception('export function beginArcadeSector(state, nowMs = Date.now()) {', 'Date.now', 1, 'persisted run epoch default'),
        exception('export function completeArcadeSector(state, nowMs = Date.now()) {', 'Date.now', 1, 'persisted run epoch default'),
    ],
    'src/state/arcade/ArcadeRunRanking.js': [
        exception('export function settleArcadeRunRanking(runtime, result, nowMs = Date.now()) {', 'Date.now', 1, 'persisted ranking epoch default'),
    ],
    'src/state/arcade/ArcadeScoreOps.js': [
        exception('export function applyArcadeComboDecay(scoreState = null, config = null, nowMs = Date.now(), masteryPerks = null) {', 'Date.now', 1, 'clockless score helper epoch default'),
        exception('    const now = Math.max(0, toSafeNumber(nowMs, Date.now()));', 'Date.now', 1, 'score helper epoch fallback', 2),
        exception('    const nowMs = Math.max(0, toSafeNumber(event?.nowMs, Date.now()));', 'Date.now', 1, 'clockless score event epoch fallback'),
        exception('    nowMs = Date.now(),', 'Date.now', 1, 'clockless score helper epoch default'),
        exception('export function buildArcadeRunSummary(runState, { endedAtMs = Date.now(), replayId = \'\' } = {}) {', 'Date.now', 1, 'persisted summary epoch default'),
        exception('    const endedAtIso = new Date(Math.max(0, toSafeNumber(endedAtMs, Date.now()))).toISOString();', 'Date.now', 1, 'persisted summary epoch fallback'),
    ],
    'src/core/runtime/RuntimeSessionLifecycleService.js': [
        exception('    const startedAt = performance.now();', 'performance.now', 1, 'measures teardown duration'),
        exception('        const durationMs = Math.max(0, performance.now() - startedAt);', 'performance.now', 1, 'measures teardown duration'),
        exception('timestamp: Date.now(),', 'Date.now', 1, 'persisted lifecycle epoch metadata', 2),
    ],
    'src/core/runtime/MenuRuntimeQuickStartService.js': [
        exception('            random: typeof game?.random === \'function\' ? game.random : Math.random,', 'Math.random', 1, 'one-time match seed entropy fallback'),
    ],
    'src/core/runtime/GameRuntimeBundle.js': [
        exception('            updatedAt: Date.now(),', 'Date.now', 1, 'persisted lifecycle epoch metadata', 2),
        exception('        sessionRuntime.finalize.updatedAt = Date.now();', 'Date.now', 1, 'persisted lifecycle epoch metadata'),
        exception('        sessionRuntime.lifecycle.updatedAt = Date.now();', 'Date.now', 1, 'persisted lifecycle epoch metadata'),
    ],
    'src/core/runtime/GameRuntimeArcadeSupport.js': [
        exception('        this._nowMs = typeof nowMs === \'function\' ? nowMs : () => Date.now();', 'Date.now', 1, 'injectable epoch timestamp source default'),
    ],
    'src/shared/contracts/PickupRegistryContract.js': [
        exception('export function pickWeightedPickupType(types, modeType, random = Math.random, configuredTypes = null) {', 'Math.random', 1, 'clockless helper default; Classic and Arcade gameplay callers inject seeded _random'),
    ],
};

const toPosix = (value) => value.replace(/\\/g, '/');

function findViolationsInSourceFile(sourceFile) {
    const violations = [];
    const unwrapParentheses = (node) => {
        let current = node;
        while (current && ts.isParenthesizedExpression(current)) current = current.expression;
        return current;
    };
    const propertyAccess = (node) => {
        if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, name: node.name.text };
        if (ts.isElementAccessExpression(node) && node.argumentExpression) {
            const argument = unwrapParentheses(node.argumentExpression);
            if (ts.isStringLiteralLike(argument)) return { receiver: node.expression, name: argument.text };
        }
        return null;
    };
    const directGlobalName = (expression) => {
        const value = unwrapParentheses(expression);
        if (ts.isIdentifier(value) && ['Date', 'Math', 'performance'].includes(value.text)) return value.text;
        const access = propertyAccess(value);
        const root = access ? unwrapParentheses(access.receiver) : null;
        if (access && ['Date', 'Math', 'performance'].includes(access.name)
            && ts.isIdentifier(root) && ['globalThis', 'window', 'self', 'global'].includes(root.text)) {
            return access.name;
        }
        return null;
    };
    const staticObjectPropertyName = (name) => {
        if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
        if (ts.isComputedPropertyName(name)) {
            const expression = unwrapParentheses(name.expression);
            if (ts.isStringLiteralLike(expression)) return expression.text;
        }
        return null;
    };
    const patternPropertyNames = (pattern) => {
        if (ts.isObjectBindingPattern(pattern)) {
            return pattern.elements.map((element) => staticObjectPropertyName(element.propertyName || element.name));
        }
        if (ts.isObjectLiteralExpression(pattern)) {
            return pattern.properties.map((property) => {
                if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
                if (ts.isPropertyAssignment(property)) return staticObjectPropertyName(property.name);
                return null;
            });
        }
        return [];
    };
    const recordDestructuredReferences = (pattern, sourceExpression) => {
        if (!pattern || !sourceExpression) return;
        const globalName = directGlobalName(sourceExpression);
        if (!globalName) return;
        const memberName = globalName === 'Math' ? 'random' : 'now';
        for (const propertyName of patternPropertyNames(pattern)) {
            if (propertyName !== memberName) continue;
            const token = `${globalName}.${memberName}`;
            violations.push({
                line: sourceFile.getLineAndCharacterOfPosition(sourceExpression.getStart(sourceFile)).line + 1,
                token,
                detail: `${token} (handed on as a value)`,
            });
        }
    };
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const access = propertyAccess(node);
            const globalName = access && directGlobalName(access.receiver);
            const token = globalName && ((globalName === 'Math' && access.name === 'random')
                || (globalName !== 'Math' && access.name === 'now'))
                ? `${globalName}.${access.name}`
                : null;

            let referenceExpression = node;
            let parent = node.parent;
            while (parent && ts.isParenthesizedExpression(parent) && parent.expression === referenceExpression) {
                referenceExpression = parent;
                parent = parent.parent;
            }
            const isTypeofCapabilityCheck = parent && ts.isTypeOfExpression(parent) && parent.expression === referenceExpression;
            if (token && !isTypeofCapabilityCheck) {
                const isCall = parent && ts.isCallExpression(parent) && parent.expression === referenceExpression;
                violations.push({
                    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                    token,
                    detail: isCall ? `${token}(` : `${token} (handed on as a value)`,
                });
            }
        }
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer && ts.isObjectBindingPattern(node.name)) {
            recordDestructuredReferences(node.name, node.initializer);
        } else if (ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isObjectLiteralExpression(unwrapParentheses(node.left))) {
            recordDestructuredReferences(unwrapParentheses(node.left), node.right);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return violations;
}

export function findDeterminismViolations(text) {
    const sourceFile = ts.createSourceFile('runtime-determinism-source.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return findViolationsInSourceFile(sourceFile);
}

function exceptionFailure(filePath, detail, line = 1) {
    return { filePath, line, detail: `source_exception_${detail}` };
}

// Pure helper so the exact-line allowlist can be exercised without creating or
// mutating repository fixture files.
export function applySourceExceptions(filePath, text, violations, exceptionMap = SOURCE_EXCEPTIONS) {
    const entries = exceptionMap[filePath] || [];
    const failures = [];
    const authorizedLines = new Set();
    const seenSnippets = new Set();
    const lines = text.split(/\r?\n/);

    for (const entry of entries) {
        if (!entry || typeof entry.snippet !== 'string' || !entry.snippet.trim()) {
            failures.push(exceptionFailure(filePath, 'invalid_snippet'));
            continue;
        }
        const snippet = entry.snippet.trim();
        if (seenSnippets.has(snippet)) {
            failures.push(exceptionFailure(filePath, 'duplicate_snippet'));
            continue;
        }
        seenSnippets.add(snippet);

        const expectedLines = entry.expectedLines ?? 1;
        if (!Number.isInteger(expectedLines) || expectedLines < 1) {
            failures.push(exceptionFailure(filePath, 'invalid_line_count'));
            continue;
        }
        if (!entry.reason || typeof entry.reason !== 'string') {
            failures.push(exceptionFailure(filePath, 'missing_reason'));
            continue;
        }
        if (!entry.tokens || typeof entry.tokens !== 'object' || Array.isArray(entry.tokens)) {
            failures.push(exceptionFailure(filePath, 'invalid_token_counts'));
            continue;
        }

        const matchingLines = [];
        lines.forEach((line, index) => {
            if (line.trim() === snippet) matchingLines.push(index + 1);
        });
        if (matchingLines.length !== expectedLines) {
            failures.push(exceptionFailure(
                filePath,
                matchingLines.length === 0 ? 'stale_snippet' : 'snippet_line_count_mismatch',
                matchingLines[0] || 1
            ));
            continue;
        }

        let valid = true;
        for (const [token, uses] of Object.entries(entry.tokens)) {
            if (!['Date.now', 'Math.random', 'performance.now'].includes(token) || !Number.isInteger(uses) || uses < 1) {
                failures.push(exceptionFailure(filePath, 'invalid_token_counts', matchingLines[0]));
                valid = false;
                continue;
            }
            for (const lineNumber of matchingLines) {
                const actualUses = violations.filter((violation) => violation.line === lineNumber && violation.token === token).length;
                if (actualUses !== uses) {
                    failures.push(exceptionFailure(filePath, `use_count_mismatch:${token}:expected=${uses}:actual=${actualUses}`, lineNumber));
                    valid = false;
                }
            }
        }
        if (Object.keys(entry.tokens).length === 0) {
            failures.push(exceptionFailure(filePath, 'empty_token_counts', matchingLines[0]));
            valid = false;
        }
        if (valid) {
            for (const lineNumber of matchingLines) {
                for (const token of Object.keys(entry.tokens)) authorizedLines.add(`${lineNumber}:${token}`);
            }
        }
    }

    const remaining = failures.length > 0
        ? violations
        : violations.filter((violation) => !authorizedLines.has(`${violation.line}:${violation.token}`));
    return { failures, violations: remaining, matchedExceptionCount: authorizedLines.size };
}

// Zeilenweise statt mit einem Gesamt-Regex: eine verschachtelte Alternative ueber die
// ganze Datei laeuft auf grossen Quellen in katastrophales Backtracking.
function inspectReExports(sourceFile) {
    const targets = [];
    let pure = sourceFile.statements.length > 0;
    const failures = sourceFile.parseDiagnostics.length > 0 ? ['reexport_module_parse_error'] : [];

    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement)) {
            pure = false;
            continue;
        }
        if (!statement.moduleSpecifier) {
            pure = false;
            continue;
        }
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) {
            pure = false;
            failures.push('reexport_target_invalid_specifier');
            continue;
        }
        targets.push(statement.moduleSpecifier.text);
    }

    return { targets, pure: pure && targets.length > 0, failures };
}

export function extractPureReExportTargets(text) {
    const sourceFile = ts.createSourceFile('runtime-determinism-source.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const info = inspectReExports(sourceFile);
    return info.pure ? info.targets : null;
}

export function resolveLocalReExportTarget(fromPath, specifier, availablePaths) {
    if (typeof specifier !== 'string' || !specifier.startsWith('.') || specifier.includes('\\') || /[?#]/.test(specifier)) {
        return { path: null, failure: 'reexport_target_not_local' };
    }
    const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
    if (!basePath.startsWith('src/') || basePath === 'src') {
        return { path: null, failure: 'reexport_target_outside_src' };
    }

    const hasExtension = /\.(?:cjs|mjs|js)$/i.test(basePath);
    const candidates = hasExtension
        ? [basePath]
        : [`${basePath}.js`, `${basePath}.mjs`, `${basePath}.cjs`, `${basePath}/index.js`, `${basePath}/index.mjs`, `${basePath}/index.cjs`];
    const matches = candidates.filter((candidate) => availablePaths.has(candidate));
    if (matches.length === 0) return { path: null, failure: 'reexport_target_missing' };
    if (matches.length > 1) return { path: null, failure: 'reexport_target_ambiguous' };
    return { path: matches[0], failure: null };
}

// Pure graph planner: callers supply module source and available local paths, so cycles,
// out-of-scope targets, and missing edges can be tested without touching the filesystem.
export function buildReExportScanPlan(initialPaths, sources, availablePaths = new Set(sources.keys()), analysisCache = new Map()) {
    const files = new Set();
    const shells = new Set();
    const edges = new Map();
    const failures = [];
    const unloadedTargets = new Set();
    const pending = [...initialPaths];

    while (pending.length > 0) {
        const filePath = pending.pop();
        if (files.has(filePath)) continue;
        files.add(filePath);
        if (!sources.has(filePath)) {
            failures.push({ filePath, detail: 'reexport_source_missing' });
            continue;
        }

        let analysis = analysisCache.get(filePath);
        if (!analysis) {
            const sourceFile = ts.createSourceFile('runtime-determinism-source.js', sources.get(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
            analysis = { sourceFile, violations: findViolationsInSourceFile(sourceFile), reExports: inspectReExports(sourceFile) };
            analysisCache.set(filePath, analysis);
        }
        const reExports = analysis.reExports;
        for (const detail of reExports.failures) failures.push({ filePath, detail });
        if (reExports.targets.length === 0) continue;
        if (reExports.pure) shells.add(filePath);
        const resolvedEdges = [];
        edges.set(filePath, resolvedEdges);
        for (const specifier of reExports.targets) {
            const resolved = resolveLocalReExportTarget(filePath, specifier, availablePaths);
            if (resolved.failure) {
                failures.push({ filePath, target: specifier, detail: resolved.failure });
                continue;
            }
            resolvedEdges.push(resolved.path);
            if (!sources.has(resolved.path)) unloadedTargets.add(resolved.path);
            else pending.push(resolved.path);
        }
    }

    const state = new Map();
    const visit = (filePath, chain) => {
        state.set(filePath, 1);
        for (const target of edges.get(filePath) || []) {
            if (!edges.has(target)) continue;
            if (state.get(target) === 1) {
                failures.push({ filePath, target, detail: `reexport_cycle:${[...chain, target].join('->')}` });
            } else if (!state.has(target)) {
                visit(target, [...chain, target]);
            }
        }
        state.set(filePath, 2);
    };
    for (const filePath of edges.keys()) {
        if (!state.has(filePath)) visit(filePath, [filePath]);
    }

    return {
        files: [...files],
        shells: [...shells],
        unloadedTargets: [...unloadedTargets],
        failures,
    };
}

function collectJsFiles(target) {
    const collected = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            const absolutePath = path.join(current, entry.name);
            if (entry.isDirectory()) walk(absolutePath);
            else if (entry.isFile() && /\.(?:cjs|mjs|js)$/i.test(entry.name)) collected.push(toPosix(absolutePath));
        }
    };
    if (statSync(target).isDirectory()) walk(target);
    else collected.push(toPosix(target));
    return collected;
}

export function runDeterminismGuard() {
    const failures = [];
    const notes = [];
    const scannedFiles = [];
    const exceptedFiles = new Set();
    const targetsSeen = new Set();

    for (const target of SCAN_TARGETS) {
        if (targetsSeen.has(target)) failures.push({ filePath: target, line: 1, detail: 'duplicate_scan_target' });
        targetsSeen.add(target);
        if (!existsSync(target)) failures.push({ filePath: target, line: 1, detail: 'scan_target_not_found' });
    }

    const initialFiles = new Set();
    for (const target of SCAN_TARGETS) {
        if (!existsSync(target)) continue;
        for (const filePath of collectJsFiles(target)) initialFiles.add(filePath);
    }

    const availablePaths = new Set(collectJsFiles('src'));
    const sourceTexts = new Map([...initialFiles].map((filePath) => [filePath, readFileSync(filePath, 'utf8')]));
    const sourceAnalysisCache = new Map();
    let scanPlan = buildReExportScanPlan(initialFiles, sourceTexts, availablePaths, sourceAnalysisCache);
    while (scanPlan.unloadedTargets.length > 0) {
        let loadedTarget = false;
        for (const target of scanPlan.unloadedTargets) {
            if (!existsSync(target)) {
                failures.push({ filePath: target, line: 1, detail: 'reexport_target_disappeared' });
                continue;
            }
            sourceTexts.set(target, readFileSync(target, 'utf8'));
            loadedTarget = true;
        }
        if (!loadedTarget) break;
        scanPlan = buildReExportScanPlan(initialFiles, sourceTexts, availablePaths, sourceAnalysisCache);
    }
    for (const graphFailure of scanPlan.failures) {
        failures.push({ filePath: graphFailure.filePath, line: 1, detail: graphFailure.detail });
    }

    const scanFiles = new Set(scanPlan.files);
    for (const exceptionPath of Object.keys(SOURCE_EXCEPTIONS)) {
        if (!existsSync(exceptionPath)) {
            failures.push({ filePath: exceptionPath, line: 1, detail: 'source_exception_target_not_found' });
        } else if (!scanFiles.has(exceptionPath)) {
            failures.push({ filePath: exceptionPath, line: 1, detail: 'source_exception_target_not_scanned' });
        }
    }

    const shellPaths = new Set(scanPlan.shells);
    for (const filePath of scanPlan.files) {
        if (shellPaths.has(filePath)) {
            notes.push(`${filePath}: pure re-export shell targets resolved and recursively scanned`);
            continue;
        }

        const text = sourceTexts.get(filePath);
        if (typeof text !== 'string') {
            failures.push({ filePath, line: 1, detail: 'reexport_source_missing' });
            continue;
        }
        scannedFiles.push(filePath);
        const analysis = sourceAnalysisCache.get(filePath);
        const checked = applySourceExceptions(filePath, text, analysis?.violations || []);
        failures.push(...checked.failures);
        for (const violation of checked.violations) {
            failures.push({ filePath, line: violation.line, detail: violation.detail });
        }
        if (checked.matchedExceptionCount > 0) exceptedFiles.add(filePath);
    }

    if (failures.length > 0) {
        console.error('Runtime determinism guard failed.');
        for (const failure of failures) console.error(`- ${failure.filePath}:${failure.line} ${failure.detail}`);
        return { status: 1, failures, scannedFiles, exceptedFiles: [...exceptedFiles], notes };
    }

    console.log('Runtime determinism guard passed.');
    console.log(`Files checked: ${scannedFiles.length} (files with exact source exceptions: ${exceptedFiles.size})`);
    for (const note of notes) console.log(`- note: ${note}`);
    return { status: 0, failures, scannedFiles, exceptedFiles: [...exceptedFiles], notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(runDeterminismGuard().status);
}
