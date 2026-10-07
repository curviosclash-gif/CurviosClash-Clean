import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE_ROOTS = ['src', 'electron', 'server', 'editor'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

// Every existing write is approved by a source-level AST fingerprint, not by file,
// directory, or a count budget. Updating a policy requires reviewing its exact write.
const ALLOWED_HEALTH_WRITE_FINGERPRINTS = [
    ["src/core/arcade/ArcadeIntermissionEffects.js","restoreArcadeHumanVitals","player","hp","=","Math.max(0, Math.min(maxHp, toSafeNumber(saved.hp, maxHp)))","restore saved Arcade player vitals"],
    ["src/core/arcade/ArcadeIntermissionEffects.js","restoreArcadeHumanVitals","player","shieldHP","=","Math.max(0, Math.min(maxShieldHp, toSafeNumber(saved.shieldHP, 0)))","restore saved Arcade player vitals"],
    ["src/core/arcade/ArenaWavesRuntime.js","_applyHumanUpgrades","player","hp","=","player.maxHp","Arena Waves player upgrade or wave reset"],
    ["src/core/arcade/ArenaWavesRuntime.js","_activatePlannedWave","player","hp","=","player.maxHp","Arena Waves player upgrade or wave reset"],
    ["src/core/recording/CinematicReplayProjection.js","updateProjectionPlayer","out","hp","=","lerp( toFiniteNumber(left?.health, 100), toFiniteNumber(right?.health, toFiniteNumber(left?.health, 100)), alpha )","replay or recording projection state, not live gameplay health"],
    ["src/core/recording/CinematicReplayProjection.js","updateProjectionPlayer","out","shieldHP","=","Math.max(0, toFiniteNumber(discrete?.shieldHP, 0))","replay or recording projection state, not live gameplay health"],
    ["src/core/recording/CinematicReplayRenderRuntime.js","applyProjectionToPlayers","player","hp","=","Math.max(0, toFiniteNumber(projected.hp, player.hp))","replay or recording projection state, not live gameplay health"],
    ["src/core/recording/CinematicReplayRenderRuntime.js","applyProjectionToPlayers","player","shieldHP","=","Math.max(0, toFiniteNumber(projected.shieldHP, player.shieldHP))","replay or recording projection state, not live gameplay health"],
    ["src/core/recording/CinematicReplaySnapshotOps.js","interpolateSceneEntries","out","hp","=","THREE.MathUtils.lerp( toFiniteNumber(left?.hp, -1), toFiniteNumber(right?.hp, left?.hp), alpha )","replay or recording projection state, not live gameplay health"],
    ["src/core/renderer/RecordingCaptureCameraUpdateOps.js","updateCaptureCameraContext","playerState","hp","=","Number(player?.hp) || 0","derived camera or recording snapshot, not live gameplay health"],
    ["src/entities/combat/CombatPipeline.js","applyHit","target","shieldHP","=","0","central combat pipeline environmental shield consumption"],
    ["src/entities/endless/EndlessParcoursBotDirectorOps.js","promoteEndlessElite","player","hp","=","player.maxHp","endless-run player health reset"],
    ["src/entities/endless/EndlessParcoursSlotOps.js","tryActivateEndlessSlot","slotState.player","hp","=","slotState.player.maxHp","endless-run player health reset"],
    ["src/entities/EntityManagerLiveConfigOps.js","applyLiveRuntimeConfig","player","hp","=","Math.max(0, Math.min(hp, nextMaxHp))","live max-health configuration clamp"],
    ["src/entities/player/PlayerEffectOps.js","resetShieldState","player","shieldHP","=","0","player effect shield reset"],
    ["src/entities/Player.js","constructor","this","shieldHP","=","0","Player initial health state"],
    ["src/entities/Player.js","constructor","this","hp","=","1","Player initial health state"],
    ["src/entities/Player.js","kill","this","hp","=","0","Player death lifecycle"],
    ["src/entities/runtime/EntityCameraContext.js","updateEntityCameraContext","playerState","hp","=","Number(player?.hp) || 0","derived camera or recording snapshot, not live gameplay health"],
    ["src/entities/systems/FlagObjectiveSystem.js","applyNetworkState","flag","hp","=","Math.max(0, Math.min(flag.maxHp, Number(entry.hp) || 0))","flag-objective HP, not player health"],
    ["src/entities/systems/map-units/EscortMapUnitOps.js","updateEscortRecovery","unit","hp","=","Math.max(1, unit.maxHp * ESCORT_RECOVERY_DEFAULTS.reviveHpRatio)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/EscortMapUnitOps.js","updateEscortCheckpoints","unit","hp","=","Math.min( unit.maxHp, unit.hp + unit.maxHp * ESCORT_RECOVERY_DEFAULTS.checkpointRepairRatio, )","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/EscortMapUnitOps.js","createEscortObjectiveState","state","hp","=","Math.max(0, Number(unit.hp) || 0)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitDamageOps.js","applyMapUnitDamage","unit","hp","=","Math.max(0, hpBefore - requested)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitDamageOps.js","destroyMapUnit","unit","hp","=","0","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitNetworkOps.js","applyMapUnitsNetworkState","unit","hp","=","Math.max(0, Number(entry.hp) || 0)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitNetworkOps.js","applyMapUnitsNetworkState","member","hp","=","Math.max(0, Number(state.hp) || 0)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitNetworkOps.js","applyMapUnitsNetworkState","unit","hp","=","totalHp","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitSwarmOps.js","applySwarmMemberDamage","member","hp","=","Math.max(0, hpBefore - requested)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitSwarmOps.js","applySwarmMemberDamage","unit","hp","=","Math.max(0, unit.hp - hpApplied)","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitSwarmOps.js","applySwarmMemberDamage","unit","hp","=","0","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitSwarmOps.js","resetSwarmMembers","member","hp","=","member.maxHp","map-unit object HP, not player health"],
    ["src/entities/systems/map-units/MapUnitSwarmOps.js","resetSwarmMembers","unit","hp","=","totalHp","map-unit object HP, not player health"],
    ["src/entities/systems/MapDestructibleSystem.js","updateFeedback","segment","hp","=","Math.max(0.001, segment.maxHp * (1 - fire.heat))","map-destructible object HP, not player health"],
    ["src/entities/systems/MapDestructibleSystem.js","applySegmentHit","segment","hp","=","Math.max(0.001, segment.maxHp * (1 - fireSegment.heat))","map-destructible object HP, not player health"],
    ["src/entities/systems/MapDestructibleSystem.js","_syncTargets","target","hp","=","Math.max(0, Number(state?.hp) || 0)","map-destructible object HP, not player health"],
    ["src/entities/systems/MapHazardSystem.js","_applyHit","player","shieldHP","=","0","environmental hazard shield absorption"],
    ["src/entities/systems/MapUnitSystem.js","_respawn","unit","hp","=","unit.maxHp","map-unit object respawn HP, not player health"],
    ["src/entities/systems/projectile/RocketTrailSystem.js","clearOwner","ref.entry","hp","=","0","trail-segment object HP, not player health"],
    ["src/entities/systems/RepairDroneSystem.js","_applyDamage","drone","hp","=","Math.max(0, before - requested)","repair-drone object HP, not player health"],
    ["src/entities/systems/RepairDroneSystem.js","_destroyDrone","drone","hp","=","0","repair-drone object HP, not player health"],
    ["src/entities/systems/RepairDroneSystem.js","_healNearbyTanks","unit","hp","=","Math.min(Math.max(1, Number(unit.maxHp) || 1), before + amount)","map-unit object repair HP, not player health"],
    ["src/entities/systems/RepairDroneSystem.js","applyNetworkState","drone","hp","=","Math.max(0, Math.min(drone.maxHp, Number(state.hp) || 0))","repair-drone object HP, not player health"],
    ["src/entities/systems/static-turret/StaticTurretNetworkOps.js","applyTurretEntry","turret","hp","=","Number(entry.hp) >= 0 ? Math.max(0, Number(entry.hp)) : turret.maxHp","static-turret object HP, not player health"],
    ["src/entities/systems/StaticTurretSystem.js","damageTurret","turret","hp","=","Math.max(0, hpBefore - requested)","static-turret object HP, not player health"],
    ["src/entities/systems/trails/TrailSegmentRegistry.js","registerTrailSegment","entry","hp","=","Math.max(0, Number(data.hp) || entry.maxHp)","trail-segment object HP, not player health"],
    ["src/entities/systems/trails/TrailSegmentRegistry.js","damageTrailSegment","entry","hp","=","nextHp","trail-segment object HP, not player health"],
    ["src/entities/systems/trails/TrailSegmentRegistry.js","destroySegment","entry","hp","=","0","trail-segment object HP, not player health"],
    ["src/hunt/HealthSystem.js","applyShieldAndHpDamage","player","shieldHP","=","Math.max(0, player.shieldHP - absorbedByShield)","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","applyShieldAndHpDamage","player","hp","=","Math.max(0, toSafeNumber(player.hp, resolvedHpFallback) - remainingDamage)","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","applyCappedHealing","player","hp","=","Math.min(maxHp, before + amount)","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","resetPlayerHealth","player","hp","=","1","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","resetPlayerHealth","player","shieldHP","=","player.hasShield ? 1 : 0","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","resetPlayerHealth","player","hp","=","maxHp","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","resetPlayerHealth","player","shieldHP","=","player.maxShieldHp","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","resetPlayerHealth","player","shieldHP","=","0","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","applyDamage","player","hp","=","0","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","applyDamage","player","shieldHP","=","0","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","applyHealing","player","hp","=","1","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","updatePlayerHealthRegen","player","hp","=","Math.min(maxHp, player.hp + regenPerSecond * Math.max(0, dt))","strategyless low-level Player.update regeneration fallback"],
    ["src/hunt/HealthSystem.js","grantShield","player","shieldHP","=","1","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/HealthSystem.js","grantShield","player","shieldHP","=","player.maxShieldHp","shared health damage, healing, reset, regeneration, and shield primitive"],
    ["src/hunt/RespawnSystem.js","applyRespawnRecovery","player","shieldHP","=","Math.min(player.maxShieldHp || recoveryShieldHp, recoveryShieldHp)","respawn shield recovery"],
    ["src/modes/ArcadeEndlessVehicleBonusOps.js","resetArcadeEndlessPlayerHealth","player","hp","=","player.maxHp","endless-run player health reset"],
    ["src/modes/ArcadeEndlessVehicleBonusOps.js","resetArcadeEndlessPlayerHealth","player","hp","=","player.maxHp","endless-run player health reset"],
    ["src/modes/ArcadeModeStrategy.js","applyIntermissionHealing","player","shieldHP","=","targetShield","Arcade intermission shield spill policy"],
    ["src/modes/ArcadeModeStrategy.js","grantShield","player","shieldHP","=","player.maxShieldHp","Arcade mode shield grant"],
    ["src/modes/ArcadeVehicleStatOps.js","applyArcadeGauntletHealthReset","player","hp","=","player.maxHp","Arcade vehicle health reset"],
    ["src/modes/ArcadeVehicleStatOps.js","applyArcadeGauntletHealthReset","player","shieldHP","=","player.hasShield ? player.maxShieldHp : 0","Arcade vehicle health reset"],
    ["src/modes/ClassicModeStrategy.js","resetPlayerHealth","player","hp","=","1","Classic mode health reset"],
    ["src/modes/ClassicModeStrategy.js","resetPlayerHealth","player","shieldHP","=","player.hasShield ? 1 : 0","Classic mode health reset"],
    ["src/modes/ClassicModeStrategy.js","applyDamage","player","hp","=","0","Classic mode damage primitive"],
    ["src/modes/ClassicModeStrategy.js","applyDamage","player","shieldHP","=","0","Classic mode damage primitive"],
    ["src/modes/ClassicModeStrategy.js","applyHealing","player","hp","=","1","Classic mode heal primitive"],
    ["src/modes/ClassicModeStrategy.js","grantShield","player","shieldHP","=","1","Classic mode shield grant"],
    ["src/modes/HuntModeStrategy.js","resetPlayerHealth","player","hp","=","maxHp","Hunt mode spawn, reset, or shield policy"],
    ["src/modes/HuntModeStrategy.js","resetPlayerHealth","player","shieldHP","=","player.hasShield ? maxShieldHp : 0","Hunt mode spawn, reset, or shield policy"],
    ["src/modes/HuntModeStrategy.js","applySpawnStatBonuses","player","hp","=","player.maxHp","Hunt mode spawn, reset, or shield policy"],
    ["src/modes/HuntModeStrategy.js","grantShield","player","shieldHP","=","player.maxShieldHp","Hunt mode spawn, reset, or shield policy"],
    ["src/network/StateReconciler.js","_reconcileAuthoritativeFields","localPlayer","hp","=","health","authoritative network reconciliation"],
    ["src/network/StateReconciler.js","_reconcileAuthoritativeFields","localPlayer","shieldHP","=","shieldHP","authoritative network reconciliation"],
    ["src/shared/contracts/FlagObjectiveContract.js","damageFlagObjective","flag","hp","=","before - applied","flag-objective HP, not player health"],
    ["src/shared/contracts/FlagObjectiveContract.js","damageFlagObjective","flag","hp","=","Math.max(1, Number(flag.maxHp) || FLAG_OBJECTIVE_DEFAULTS.maxHp)","flag-objective HP, not player health"],
    ["src/shared/contracts/MapDestructibleContract.js","collapseScenePieces","segment","hp","=","0","map-destructible object HP, not player health"],
    ["src/shared/contracts/MapDestructibleContract.js","applyMapDestructibleDamage","segment","hp","=","Math.max(0, segment.hp - amount)","map-destructible object HP, not player health"],
    ["src/state/recorder/RoundSnapshotStore.js","copyTurretEntry","out","hp","=","src.hp","recorded turret snapshot output, not live player health"],
    ["src/state/recorder/RoundSnapshotStore.js","capture","out","hp","=","toFiniteNumber(turret.hp, -1)","recorded turret snapshot output, not live player health"],
];

export const ALLOWED_HEALTH_WRITES = ALLOWED_HEALTH_WRITE_FINGERPRINTS.map(([file, functionPath, receiver, property, operator, value, reason]) => ({
    file, functionPath, receiver, property, operator, value, reason,
}));

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function unwrapExpressionWrappers(node) {
    let current = node;
    while (current && (ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isSatisfiesExpression(current))) {
        current = current.expression;
    }
    return current;
}

function propertyWriteTarget(node, sourceFile) {
    const target = unwrapExpressionWrappers(node);
    if (ts.isPropertyAccessExpression(target)) {
        return { receiver: normalizeText(target.expression.getText(sourceFile)), property: target.name.text };
    }
    if (ts.isElementAccessExpression(target) && target.argumentExpression) {
        const key = unwrapExpressionWrappers(target.argumentExpression);
        if (ts.isStringLiteralLike(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
            return { receiver: normalizeText(target.expression.getText(sourceFile)), property: key.text };
        }
    }
    return null;
}

function functionName(node) {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) {
        return normalizeText(node.name.getText());
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const parent = node.parent;
        if (ts.isVariableDeclaration(parent)) return normalizeText(parent.name.getText());
        if (ts.isPropertyAssignment(parent)) return normalizeText(parent.name.getText());
    }
    return '<anonymous>';
}

function writeFingerprint(write) {
    return JSON.stringify([
        write.file,
        write.functionPath,
        write.receiver,
        write.property,
        write.operator,
        write.value,
    ]);
}

export function collectHealthWrites(source, filePath) {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const writes = [];
    const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => ({
        file: filePath,
        line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }));

    function visit(node, parents = []) {
        const functions = ts.isFunctionLike(node) ? [...parents, functionName(node)] : parents;
        const record = (targetNode, operator, value, statementNode = node) => {
            const target = propertyWriteTarget(targetNode, sourceFile);
            if (!target || (target.property !== 'hp' && target.property !== 'shieldHP')) return;
            writes.push({
                file: filePath,
                line: sourceFile.getLineAndCharacterOfPosition(targetNode.getStart(sourceFile)).line + 1,
                functionPath: functions.length ? functions.join(' > ') : '<module>',
                receiver: target.receiver,
                property: target.property,
                operator,
                value: normalizeText(value),
                statement: normalizeText(statementNode.getText(sourceFile)),
            });
        };

        const unwrapPattern = unwrapExpressionWrappers;
        const visitDestructuringTarget = (pattern, assignmentNode) => {
            const target = unwrapPattern(pattern);
            if (ts.isObjectLiteralExpression(target)) {
                for (const property of target.properties) {
                    if (ts.isPropertyAssignment(property)) {
                        visitDestructuringTarget(property.initializer, assignmentNode);
                    } else if (ts.isSpreadAssignment(property)) {
                        visitDestructuringTarget(property.expression, assignmentNode);
                    } else if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) {
                        visit(property.objectAssignmentInitializer, functions);
                    }
                }
                return;
            }
            if (ts.isArrayLiteralExpression(target)) {
                for (const element of target.elements) {
                    if (ts.isOmittedExpression(element)) continue;
                    visitDestructuringTarget(ts.isSpreadElement(element) ? element.expression : element, assignmentNode);
                }
                return;
            }
            if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                const nestedLeft = unwrapPattern(target.left);
                if (ts.isPropertyAccessExpression(nestedLeft) || ts.isElementAccessExpression(nestedLeft)) {
                    // The ordinary BinaryExpression visitor records this default target with its real RHS.
                    return;
                }
                visitDestructuringTarget(target.left, target);
                return;
            }
            if (propertyWriteTarget(target, sourceFile)) {
                record(target, '=', '<destructuring assignment>', assignmentNode);
            }
        };

        if (ts.isBinaryExpression(node)
            && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
            record(node.left, node.operatorToken.getText(sourceFile), node.right.getText(sourceFile));
            const left = unwrapPattern(node.left);
            if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left))) {
                visitDestructuringTarget(left, node);
            }
        } else if ((ts.isForOfStatement(node) || ts.isForInStatement(node))
            && !ts.isVariableDeclarationList(node.initializer)) {
            visitDestructuringTarget(node.initializer, node);
        } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            record(node.operand, ts.tokenToString(node.operator) || '', ts.tokenToString(node.operator) || '');
        }

        ts.forEachChild(node, (child) => visit(child, functions));
    }

    visit(sourceFile);
    return { writes, diagnostics };
}

function walkSourceFiles(directory) {
    if (!existsSync(directory)) return [];
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!['node_modules', 'dist', 'dist-app', '.git'].includes(entry.name)) files.push(...walkSourceFiles(absolutePath));
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(absolutePath);
        }
    }
    return files;
}

export function evaluateHealthWrites(writes, allowedWrites = ALLOWED_HEALTH_WRITES) {
    const expected = new Map();
    for (const allowed of allowedWrites) {
        const key = writeFingerprint(allowed);
        const entries = expected.get(key) || [];
        entries.push(allowed);
        expected.set(key, entries);
    }
    const observed = new Map();
    for (const write of writes) {
        const key = writeFingerprint(write);
        const entries = observed.get(key) || [];
        entries.push(write);
        observed.set(key, entries);
    }

    const violations = [];
    for (const write of writes) {
        const key = writeFingerprint(write);
        const approvals = expected.get(key) || [];
        const seen = observed.get(key) || [];
        const index = seen.indexOf(write);
        if (approvals.length === 0 || index >= approvals.length) {
            violations.push({ ...write, reason: 'unapproved player/object health write' });
        }
    }
    for (const [key, approvals] of expected) {
        const seen = observed.get(key) || [];
        if (seen.length < approvals.length) {
            violations.push({
                ...approvals[seen.length],
                line: null,
                reason: 'approved source fingerprint is missing or changed',
            });
        }
    }

    return violations;
}

export function scanPlayerHealthBoundary(root = process.cwd(), {
    allowedWrites = ALLOWED_HEALTH_WRITES,
    files = SOURCE_ROOTS.flatMap((directory) => walkSourceFiles(path.join(root, directory))),
} = {}) {
    const sources = files.map((absolutePath) => ({
        file: path.relative(root, absolutePath).split(path.sep).join('/'),
        source: readFileSync(absolutePath, 'utf8'),
    }));
    return scanPlayerHealthSources(sources, allowedWrites);
}

export function scanPlayerHealthSources(sources, allowedWrites = ALLOWED_HEALTH_WRITES) {
    const writes = [];
    const diagnostics = [];
    for (const entry of sources) {
        const result = collectHealthWrites(entry.source, entry.file);
        writes.push(...result.writes);
        diagnostics.push(...result.diagnostics);
    }
    return { writes, violations: evaluateHealthWrites(writes, allowedWrites), diagnostics };
}

export function hasHealthBoundaryErrors(result) {
    return result.diagnostics.length > 0 || result.violations.length > 0;
}

export function formatHealthBoundaryReport(result) {
    return result.violations.map((entry) => {
        const location = entry.line == null ? entry.file : `${entry.file}:${entry.line}`;
        return `${location} ${entry.functionPath} ${entry.receiver}.${entry.property} ${entry.operator} ${entry.value} (${entry.reason})`;
    });
}

function isMainModule(entryPath, moduleUrl) {
    if (!entryPath) return false;
    const resolvedEntry = path.resolve(entryPath).toLowerCase();
    const resolvedModule = fileURLToPath(moduleUrl).toLowerCase();
    return resolvedEntry === resolvedModule;
}

if (isMainModule(process.argv[1], import.meta.url)) {
    const root = process.cwd();
    const result = scanPlayerHealthBoundary(root);
    for (const diagnostic of result.diagnostics) {
        console.error(`${diagnostic.file}:${diagnostic.line} parse error: ${diagnostic.message}`);
    }
    for (const violation of formatHealthBoundaryReport(result)) console.error(violation);
    if (hasHealthBoundaryErrors(result)) {
        console.error(`Player health boundary failed: ${result.violations.length} write(s), ${result.diagnostics.length} parse error(s).`);
        process.exitCode = 1;
    } else {
        console.log(`Player health boundary passed (${result.writes.length} approved AST write(s)).`);
    }
}
