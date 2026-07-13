#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKS = Object.freeze({
  touchedStrict: {
    id: 'touched-strict',
    label: 'check:architecture:touched-strict',
    script: 'scripts/check-architecture-touched-strict.mjs',
    passTouchedFiles: true,
  },
  boundaries: {
    id: 'boundaries',
    label: 'check:architecture:boundaries',
    script: 'scripts/check-architecture-boundaries.mjs',
  },
  metrics: {
    id: 'metrics',
    label: 'check:architecture:metrics',
    script: 'scripts/check-architecture-metrics.mjs',
  },
  ratchet: {
    id: 'ratchet',
    label: 'check:architecture:ratchet',
    script: 'scripts/check-architecture-ratchet.mjs',
  },
});

function normalizePath(filePath) {
  return String(filePath || '').trim().replace(/\\/g, '/');
}

function parseNameOnly(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => normalizePath(line))
    .filter((line) => line.length > 0);
}

function collectStagedFiles() {
  const result = spawnSync('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMRTUXB',
    'HEAD',
    '--',
  ], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Unable to collect staged files.${detail ? ` ${detail}` : ''}`);
  }

  return Array.from(new Set(parseNameOnly(result.stdout)));
}

function isJavaScriptPath(filePath) {
  return /\.(?:c?js|mjs|ts|tsx)$/i.test(filePath);
}

function isArchitectureRelevant(filePath) {
  return (
    filePath.startsWith('src/')
    || filePath.startsWith('server/')
    || filePath.startsWith('electron/')
    || filePath.startsWith('scripts/architecture/')
    || /^scripts\/check-architecture-[^/]+\.mjs$/.test(filePath)
  );
}

function addCheck(checksById, check) {
  checksById.set(check.id, check);
}

export function selectArchitectureChecks(stagedFiles) {
  const normalizedFiles = Array.from(new Set(stagedFiles.map(normalizePath).filter(Boolean)));
  const relevantFiles = normalizedFiles.filter(isArchitectureRelevant);
  const checksById = new Map();
  const notes = [];

  const hasSrcFiles = relevantFiles.some((filePath) => filePath.startsWith('src/') && isJavaScriptPath(filePath));
  const hasArchitectureTooling = relevantFiles.some((filePath) => (
    filePath.startsWith('scripts/architecture/')
    || /^scripts\/check-architecture-[^/]+\.mjs$/.test(filePath)
  ));
  const hasApplicationBoundaryFiles = relevantFiles.some((filePath) => filePath.startsWith('src/application/'));
  const hasRuntimeContractFiles = relevantFiles.some((filePath) => (
    filePath.startsWith('src/shared/contracts/')
    || filePath.startsWith('src/shared/runtime/')
  ));
  const hasServerFiles = relevantFiles.some((filePath) => filePath.startsWith('server/'));
  const hasElectronOrPlatformFiles = relevantFiles.some((filePath) => (
    filePath.startsWith('electron/')
    || filePath.startsWith('src/platform/')
  ));

  if (hasSrcFiles) {
    addCheck(checksById, CHECKS.touchedStrict);
  }

  if (hasArchitectureTooling) {
    addCheck(checksById, CHECKS.boundaries);
    addCheck(checksById, CHECKS.metrics);
    addCheck(checksById, CHECKS.ratchet);
  }

  if (hasApplicationBoundaryFiles || hasRuntimeContractFiles || hasServerFiles) {
    addCheck(checksById, CHECKS.boundaries);
    addCheck(checksById, CHECKS.metrics);
    addCheck(checksById, CHECKS.ratchet);
  }

  if (hasElectronOrPlatformFiles) {
    addCheck(checksById, CHECKS.boundaries);
    addCheck(checksById, CHECKS.metrics);
    notes.push('electron/platform staged: Electron/Preload surface categories are reported by boundaries/metrics.');
  }

  if (hasApplicationBoundaryFiles) {
    notes.push('src/application staged: application -> ui/core categories are checked by boundaries/metrics/ratchet.');
  }

  return {
    stagedFiles: normalizedFiles,
    relevantFiles,
    checks: Array.from(checksById.values()),
    notes,
  };
}

function runCheck(check, stagedFiles, { dryRun = false } = {}) {
  const env = { ...process.env };
  if (check.passTouchedFiles) {
    env.ARCH_TOUCHED_FILES = stagedFiles.join('\n');
  }

  const command = `${process.execPath} ${check.script}`;
  console.log(`[architecture:staged] ${dryRun ? 'would run' : 'running'} ${check.label}`);
  if (dryRun) {
    console.log(`[architecture:staged] command: ${command}`);
    return 0;
  }

  const result = spawnSync(process.execPath, [check.script], {
    env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

export function formatRoutingSummary(selection) {
  const lines = [];
  lines.push(`staged files: ${selection.stagedFiles.length}`);
  lines.push(`architecture-relevant staged files: ${selection.relevantFiles.length}`);
  if (selection.relevantFiles.length > 0) {
    for (const filePath of selection.relevantFiles) {
      lines.push(`- ${filePath}`);
    }
  }
  if (selection.checks.length > 0) {
    lines.push(`selected checks: ${selection.checks.map((check) => check.label).join(', ')}`);
  }
  for (const note of selection.notes) {
    lines.push(`note: ${note}`);
  }
  return lines.join('\n');
}

export function runStagedArchitectureGuard({ stagedFiles = collectStagedFiles(), dryRun = false } = {}) {
  const selection = selectArchitectureChecks(stagedFiles);
  console.log('[architecture:staged] routing summary');
  console.log(formatRoutingSummary(selection));

  if (selection.relevantFiles.length === 0 || selection.checks.length === 0) {
    console.log('[architecture:staged] skipped (no architecture-relevant staged files).');
    return 0;
  }

  for (const check of selection.checks) {
    const status = runCheck(check, selection.relevantFiles, { dryRun });
    if (status !== 0) {
      console.error(`[architecture:staged] failed at ${check.label} (exit ${status})`);
      return status;
    }
  }

  console.log('[architecture:staged] passed.');
  return 0;
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntrypoint()) {
  const dryRun = process.argv.includes('--dry-run');
  try {
    process.exit(runStagedArchitectureGuard({ dryRun }));
  } catch (error) {
    console.error(`[architecture:staged] ${error.message}`);
    process.exit(1);
  }
}
