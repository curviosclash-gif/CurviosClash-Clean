#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidSdk = process.env.ANDROID_HOME
  || process.env.ANDROID_SDK_ROOT
  || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
const platformTools = androidSdk ? path.join(androidSdk, 'platform-tools') : '';
const env = {
  ...process.env,
  ...(androidSdk ? { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk } : {}),
  PATH: platformTools ? `${platformTools}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
};

const mapToolsApk = path.join(repoRoot, 'android-map-tools', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const mobileClassicApk = path.join(repoRoot, 'android-classic', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apps = Object.freeze([
  {
    label: 'Map Tools',
    packageName: 'de.curviosclash.maps',
    apkPath: mapToolsApk,
  },
  {
    label: 'Curvios Clash',
    packageName: 'de.curviosclash.classic',
    apkPath: mobileClassicApk,
  },
]);
const watchPollIntervalMs = 1500;

function parseArgs(argv) {
  const options = {
    device: process.env.ANDROID_SERIAL || '',
    skipLaunch: false,
    watch: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--device') {
      options.device = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (arg.startsWith('--device=')) {
      options.device = arg.slice('--device='.length).trim();
    } else if (arg === '--no-launch') {
      options.skipLaunch = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
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

async function runNpmScript(scriptName) {
  await run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', 'run', scriptName]
    : ['run', scriptName]);
}

async function run(command, args, options = {}) {
  process.stdout.write(`[android:update] ${command} ${args.join(' ')}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

async function capture(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} failed with ${signal || `exit code ${code}`}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function createAdbCommand() {
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  return platformTools ? path.join(platformTools, adbName) : adbName;
}

function parseDevices(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => {
      const [serial = '', state = ''] = line.split(/\s+/);
      return { serial, state, raw: line };
    })
    .filter((device) => device.serial);
}

async function selectDevice(adbCommand, requestedDevice) {
  const result = await capture(adbCommand, ['devices', '-l']);
  const devices = parseDevices(result.stdout);
  if (devices.length === 0) {
    return {
      status: 'missing',
      message: 'Kein Android-Geraet per ADB gefunden. Handy entsperren, USB-Debugging erlauben und USB-Modus pruefen.',
    };
  }

  const usableDevices = devices.filter((device) => device.state === 'device');
  const blockedDevices = devices.filter((device) => device.state !== 'device');
  if (requestedDevice) {
    const match = devices.find((device) => device.serial === requestedDevice);
    if (!match) {
      return {
        status: 'missing',
        message: `Angefordertes Geraet nicht gefunden: ${requestedDevice}`,
      };
    }
    if (match.state !== 'device') {
      return {
        status: 'blocked',
        message: `Geraet ${match.serial} ist ${match.state}. Auf dem Handy USB-Debugging bestaetigen.`,
      };
    }
    return { status: 'ready', serial: match.serial };
  }

  if (usableDevices.length === 1) {
    return { status: 'ready', serial: usableDevices[0].serial };
  }
  if (usableDevices.length > 1) {
    return {
      status: 'multiple',
      message: `Mehrere ADB-Geraete gefunden: ${usableDevices.map((device) => device.serial).join(', ')}. Nutze --device <serial>.`,
    };
  }

  return {
    status: 'blocked',
    message: `ADB sieht Geraet(e), aber nicht installierbar: ${blockedDevices.map((device) => device.raw).join('; ')}`,
  };
}

async function ensureApks() {
  const missing = [];
  for (const app of apps) {
    if (!await pathExists(app.apkPath)) {
      missing.push(app.apkPath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`APK fehlt nach dem Build: ${missing.join(', ')}`);
  }
}

async function buildApks() {
  await runNpmScript('app:maps:android:sync');
  // Map Tools hat bewusst keinen separaten Install-Alias; der Debug-Build bleibt hier lokal gebuendelt.
  await run(process.platform === 'win32' ? 'cmd.exe' : './gradlew', process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gradlew.bat', 'assembleDebug', '--no-problems-report']
    : ['assembleDebug', '--no-problems-report'], {
    cwd: path.join(repoRoot, 'android-map-tools'),
  });
  await runNpmScript('app:android:apk');
  await ensureApks();
}

function adbArgs(serial, args) {
  return serial ? ['-s', serial, ...args] : args;
}

async function installAndLaunch(adbCommand, serial, skipLaunch) {
  for (const app of apps) {
    await run(adbCommand, adbArgs(serial, ['install', '-r', app.apkPath]));
    if (!skipLaunch) {
      await run(adbCommand, adbArgs(serial, [
        'shell',
        'monkey',
        '-p',
        app.packageName,
        '-c',
        'android.intent.category.LAUNCHER',
        '1',
      ]));
    }
  }
}

function printHelp() {
  process.stdout.write(`Usage: npm run android:update:phone -- [--device <serial>] [--no-launch] [--watch]\n`);
}

async function waitForDevice(adbCommand, requestedDevice) {
  let previousMessage = '';
  while (true) {
    const selected = await selectDevice(adbCommand, requestedDevice);
    if (selected.status === 'ready') {
      return selected.serial;
    }
    if (selected.message !== previousMessage) {
      process.stdout.write(`[android:update] ${selected.message}\n`);
      previousMessage = selected.message;
    }
    await delay(watchPollIntervalMs);
  }
}

async function waitForDisconnect(adbCommand, serial) {
  process.stdout.write(`[android:update] Warte auf Trennung von ${serial}.\n`);
  while (true) {
    const selected = await selectDevice(adbCommand, serial);
    if (selected.status !== 'ready') {
      return;
    }
    await delay(watchPollIntervalMs);
  }
}

async function watch(adbCommand, options) {
  process.stdout.write('[android:update] Watch-Modus aktiv. Motorola anschliessen oder erneut verbinden; Abbruch mit Strg+C.\n');
  while (true) {
    const serial = await waitForDevice(adbCommand, options.device);
    process.stdout.write(`[android:update] ${serial} erkannt. Baue die neuesten APKs.\n`);
    await buildApks();
    process.stdout.write(`[android:update] Installiere auf ${serial}.\n`);
    await installAndLaunch(adbCommand, serial, options.skipLaunch);
    process.stdout.write('[android:update] Fertig: Map Tools und Curvios Clash sind aktualisiert.\n');
    await waitForDisconnect(adbCommand, serial);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const adbCommand = createAdbCommand();
  if (options.watch) {
    await watch(adbCommand, options);
    return;
  }

  process.stdout.write('[android:update] Building Map Tools and Curvios Clash APKs.\n');
  await buildApks();

  const selected = await selectDevice(adbCommand, options.device);
  if (selected.status !== 'ready') {
    throw new Error(`${selected.message}\nAPKs wurden gebaut:\n- ${mapToolsApk}\n- ${mobileClassicApk}`);
  }

  process.stdout.write(`[android:update] Installing on ${selected.serial}.\n`);
  await installAndLaunch(adbCommand, selected.serial, options.skipLaunch);
  process.stdout.write('[android:update] Fertig: Map Tools und Curvios Clash sind aktualisiert.\n');
}

main().catch((error) => {
  if (error.stdout) {
    process.stderr.write(error.stdout);
  }
  if (error.stderr) {
    process.stderr.write(error.stderr);
  }
  process.stderr.write(`[android:update] ${error.message}\n`);
  process.exitCode = 1;
});
