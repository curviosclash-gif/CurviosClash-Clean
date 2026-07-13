#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createMobileClassicGithubUpdateConfig,
  normalizeMobileClassicGithubRepository,
} from '../src/mobile-classic/MobileClassicUpdateConfig.js';
import {
  ARCADE_GHOST_DUEL_MODES,
} from '../src/shared/contracts/ArcadeGhostDuelContract.js';
import {
  listMobileArcadeRouteAllowlist,
  MOBILE_ARCADE_DEFAULT_MAP_KEY,
} from '../src/mobile-arcade/MobileArcadeApp.js';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(repoRoot, 'dist', 'mobile-classic');
const currentScriptPath = fileURLToPath(import.meta.url);

process.env.VITE_APP_MODE = 'app';
process.env.VITE_APP_TARGET = 'mobile-classic';

async function detectGithubRepository() {
  if (process.env.CURVIOS_CLASSIC_APP_GITHUB_REPOSITORY) {
    return normalizeMobileClassicGithubRepository(process.env.CURVIOS_CLASSIC_APP_GITHUB_REPOSITORY);
  }
  try {
    const { stdout } = await execFile('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return normalizeMobileClassicGithubRepository(stdout);
  } catch {
    return normalizeMobileClassicGithubRepository();
  }
}

async function writeManifest() {
  const githubRepository = await detectGithubRepository();
  const routeAllowlist = listMobileArcadeRouteAllowlist();
  const manifest = {
    contract: 'curvios.mobile-android-app.v1',
    generatedAt: new Date().toISOString(),
    app: {
      id: 'de.curviosclash.classic',
      name: 'Curvios Clash',
      target: 'mobile-classic',
    },
    modeScope: {
      sessionType: 'single',
      modePaths: ['normal', 'arcade'],
      defaultModePath: 'normal',
      gameMode: 'CLASSIC',
      arcade: {
        defaultMapKey: MOBILE_ARCADE_DEFAULT_MAP_KEY,
        routeAllowlist,
        ghostDuelMode: ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST,
        ghostTrailCollisionEnabled: false,
      },
    },
    updates: createMobileClassicGithubUpdateConfig(githubRepository),
    webDir: 'dist/mobile-classic',
  };
  await fs.writeFile(
    path.join(webDir, 'mobile-classic.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

export function isMobileClassicPreloadPruned(href = '') {
  return /\/assets\/(?:training|recorder|developer-ui|validation|map-presets)-[^/"']+\.js(?:\?.*)?$/.test(String(href));
}

export function pruneMobileClassicHtml(html = '') {
  return String(html)
    .replace(
      /^[ \t]*<link\b(?=[^>]*\brel=["']modulepreload["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>\r?\n?/gm,
      (match, href) => (isMobileClassicPreloadPruned(href) ? '' : match),
    )
    .replace(
      /\r?\n[ \t]*<button\b[^>]*\bid=["']btn-open-developer["'][\s\S]*?<\/button>[ \t]*/g,
      '',
    )
    .replace(
      /\r?\n[ \t]*<!-- ======= SUBMENU: DEVELOPER ======= -->\s*<div\b[^>]*\bid=["']submenu-developer["'][\s\S]*?(?=\r?\n[ \t]*<!-- ======= SUBMENU: DEBUG \/ INFO ======= -->)/,
      '\n',
    );
}

async function pruneBuiltHtml() {
  const htmlPath = path.join(webDir, 'index.html');
  const html = await fs.readFile(htmlPath, 'utf8');
  const prunedHtml = pruneMobileClassicHtml(html);
  if (prunedHtml !== html) {
    await fs.writeFile(htmlPath, prunedHtml, 'utf8');
  }
}

async function main() {
  const { build } = await import('vite');
  await build({ mode: 'app' });
  await pruneBuiltHtml();
  await writeManifest();
  process.stdout.write(`mobile-classic-app: wrote ${path.relative(repoRoot, webDir)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentScriptPath) {
  main().catch((error) => {
    process.stderr.write(`mobile-classic-app: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
