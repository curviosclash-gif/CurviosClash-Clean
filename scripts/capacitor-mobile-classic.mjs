#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(repoRoot, 'tools', 'mobile-classic-app');
const androidRoot = path.join(repoRoot, 'android-classic');
const webDir = path.join(repoRoot, 'dist', 'mobile-classic');
const androidPublicDir = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'public');
const capacitorCli = path.join(repoRoot, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
const appId = 'de.curviosclash.classic';
const debugApkPath = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const androidGeneratedAssets = new Set(['cordova.js', 'cordova_plugins.js']);
const androidCopyActions = new Set(['copy', 'sync', 'apk', 'install', 'check-assets']);

const action = String(process.argv[2] || 'sync').trim().toLowerCase();
const defaultAndroidSdk = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
  : '';
const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultAndroidSdk;
const platformTools = androidSdk ? path.join(androidSdk, 'platform-tools') : '';
const commandEnv = {
  ...process.env,
  ...(androidSdk ? { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk } : {}),
  PATH: platformTools ? `${platformTools}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
};

async function runNodeScript(scriptRelativePath) {
  await execFile(process.execPath, [path.join(repoRoot, scriptRelativePath)], {
    cwd: repoRoot,
    env: commandEnv,
    windowsHide: true,
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function runCapacitor(args, timeout = 180_000) {
  await execFile(process.execPath, [capacitorCli, ...args], {
    cwd: appRoot,
    env: commandEnv,
    windowsHide: true,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function runGradle(args, timeout = 900_000) {
  const command = process.platform === 'win32' ? 'cmd.exe' : path.join(androidRoot, './gradlew');
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gradlew.bat', ...args]
    : args;
  await execFile(command, commandArgs, {
    cwd: androidRoot,
    env: commandEnv,
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function runAdb(args, timeout = 180_000) {
  const adbCommand = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const adbPath = platformTools ? path.join(platformTools, adbCommand) : adbCommand;
  await execFile(adbPath, args, {
    cwd: repoRoot,
    env: commandEnv,
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(rootDir) {
  const files = [];
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
      }
    }
  }
  await walk(rootDir);
  return files.sort();
}

async function cleanAndroidPublicAssets() {
  if (!await pathExists(androidPublicDir)) {
    return;
  }
  const files = await listFiles(androidPublicDir);
  await Promise.all(files
    .filter((file) => !androidGeneratedAssets.has(file))
    .map((file) => fs.rm(path.join(androidPublicDir, file), { force: true })));
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function verifyAndroidAssetsFresh() {
  const [webFiles, androidFiles] = await Promise.all([
    listFiles(webDir),
    listFiles(androidPublicDir),
  ]);
  const webFileSet = new Set(webFiles);
  const androidFileSet = new Set(androidFiles);
  const missing = webFiles.filter((file) => !androidFileSet.has(file));
  const extra = androidFiles.filter((file) => !webFileSet.has(file) && !androidGeneratedAssets.has(file));
  const mismatched = [];

  for (const file of webFiles) {
    if (!androidFileSet.has(file)) {
      continue;
    }
    const [webHash, androidHash] = await Promise.all([
      hashFile(path.join(webDir, file)),
      hashFile(path.join(androidPublicDir, file)),
    ]);
    if (webHash !== androidHash) {
      mismatched.push(file);
    }
  }

  if (missing.length > 0 || extra.length > 0 || mismatched.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing=${missing.slice(0, 8).join(', ')}`);
    if (extra.length > 0) parts.push(`extra=${extra.slice(0, 8).join(', ')}`);
    if (mismatched.length > 0) parts.push(`mismatched=${mismatched.slice(0, 8).join(', ')}`);
    throw new Error(`Android assets out of sync with dist/mobile-classic (${parts.join('; ')})`);
  }

  process.stdout.write(`mobile-classic-capacitor: assets fresh (${webFiles.length} files)\n`);
}

async function main() {
  if (!['add', 'sync', 'copy', 'open', 'apk', 'install', 'doctor', 'check-assets'].includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }

  if (action === 'doctor') {
    await runCapacitor(['doctor', 'android']);
    return;
  }

  if (action !== 'open') {
    await runNodeScript('scripts/build-mobile-classic-app.mjs');
  }

  if (androidCopyActions.has(action)) {
    await cleanAndroidPublicAssets();
  }

  if (action === 'add') {
    await runCapacitor(['add', 'android'], 240_000);
  } else if (action === 'check-assets') {
    await runCapacitor(['copy', 'android']);
    await verifyAndroidAssetsFresh();
  } else if (action === 'copy') {
    await runCapacitor(['copy', 'android']);
  } else if (action === 'sync') {
    await runCapacitor(['sync', 'android'], 240_000);
  } else if (action === 'open') {
    await runCapacitor(['open', 'android']);
  } else if (action === 'apk') {
    await runCapacitor(['sync', 'android'], 240_000);
    await runGradle(['assembleDebug', '--no-problems-report']);
  } else if (action === 'install') {
    await runCapacitor(['sync', 'android'], 240_000);
    await runGradle(['assembleDebug', '--no-problems-report']);
    await runAdb(['install', '-r', debugApkPath]);
    await runAdb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
}

main().catch((error) => {
  if (error.stdout) {
    process.stderr.write(`${error.stdout}\n`);
  }
  if (error.stderr) {
    process.stderr.write(`${error.stderr}\n`);
  }
  process.stderr.write(`mobile-classic-capacitor: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
