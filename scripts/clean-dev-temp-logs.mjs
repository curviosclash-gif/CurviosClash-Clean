import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DRY_RUN = process.argv.includes('--dry-run');

const ROOT_LOG_PATTERNS = Object.freeze([
  /^tmp-dev-\d+\.(out|err)\.log$/i,
  /^tmp-vite(?:-[^.\\/]+)*\.(out|err)\.log$/i,
]);

const DEV_LOG_DIRECTORY = path.resolve(process.cwd(), 'tmp', 'dev-logs');
const DEV_LOG_PATTERNS = Object.freeze([
  /^vite-dev-.*\.(out|err)\.log$/i,
  /^vite-dev-.*\.meta\.json$/i,
]);

function isTargetRootLog(filename) {
  return ROOT_LOG_PATTERNS.some((pattern) => pattern.test(filename));
}

function isTargetDevLog(filename) {
  return DEV_LOG_PATTERNS.some((pattern) => pattern.test(filename));
}

async function removeFile(filePath) {
  await rm(filePath, { force: true });
}

async function main() {
  const cwd = process.cwd();
  const rootEntries = await readdir(cwd, { withFileTypes: true });

  const rootTargets = rootEntries
    .filter((entry) => entry.isFile() && isTargetRootLog(entry.name))
    .map((entry) => path.resolve(cwd, entry.name))
    .sort();

  let devTargets = [];
  try {
    const devEntries = await readdir(DEV_LOG_DIRECTORY, { withFileTypes: true });
    devTargets = devEntries
      .filter((entry) => entry.isFile() && isTargetDevLog(entry.name))
      .map((entry) => path.resolve(DEV_LOG_DIRECTORY, entry.name))
      .sort();
  } catch {
    devTargets = [];
  }

  const allTargets = [...rootTargets, ...devTargets];

  process.stdout.write(`[logs:clean] mode=${DRY_RUN ? 'dry-run' : 'apply'}\n`);
  process.stdout.write(`[logs:clean] root_targets=${rootTargets.length}\n`);
  process.stdout.write(`[logs:clean] dev_log_targets=${devTargets.length}\n`);
  process.stdout.write(`[logs:clean] total_targets=${allTargets.length}\n`);

  for (const target of allTargets) {
    process.stdout.write(`[logs:clean] target ${path.basename(target)}\n`);
  }

  if (DRY_RUN) return;

  for (const target of allTargets) {
    await removeFile(target);
  }

  process.stdout.write(`[logs:clean] removed=${allTargets.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
