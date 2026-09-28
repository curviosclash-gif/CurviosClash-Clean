#!/usr/bin/env node
// ============================================
// telemetry-report.mjs - `npm run telemetry:report`
// ============================================
//
// Liest die Rundenhistorie des Desktop-Spiels und schreibt einen Bericht nach
// tmp/telemetry-report/. Das Original bleibt unberuehrt: gelesen wird eine
// Kopie, die danach wieder geloescht wird.
//
//   npm run telemetry:report                 Desktop-Spiel (Port 38765)
//   npm run telemetry:report -- --port=38791 ein Speicher aus einem Testlauf
//
// Das Spiel darf dabei laufen: der Leser beantwortet die Adresse intern und
// oeffnet den Port nicht selbst.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTelemetryReport, resolveTelemetryStoreDir } from './telemetry-report-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 38765;
const READER_TIMEOUT_MS = 60_000;

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

function listStorePorts(appData) {
    const base = path.dirname(resolveTelemetryStoreDir({ appData, port: 0 }));
    if (!existsSync(base)) return [];
    return readdirSync(base)
        .map((name) => /^http_127\.0\.0\.1_(\d+)\.indexeddb\.leveldb$/.exec(name)?.[1])
        .filter(Boolean)
        .map(Number)
        .sort((left, right) => left - right);
}

function copyStore(sourceDir, profileDir) {
    const targetDir = path.join(profileDir, 'IndexedDB', path.basename(sourceDir));
    mkdirSync(targetDir, { recursive: true });
    // LOCK gehoert dem laufenden Spiel; ohne ihn oeffnet Chromium die Kopie frei.
    for (const name of readdirSync(sourceDir)) {
        if (name !== 'LOCK') copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
    }
}

function runReader({ profileDir, port, rowsFile }) {
    const electronBinary = createRequire(path.join(ROOT, 'electron', 'package.json'))('electron');
    return new Promise((resolve, reject) => {
        const child = spawn(electronBinary, [path.join(ROOT, 'scripts', 'telemetry-report-reader.cjs')], {
            env: {
                ...process.env,
                TELEMETRY_REPORT_PROFILE: profileDir,
                TELEMETRY_REPORT_PORT: String(port),
                TELEMETRY_REPORT_OUT: rowsFile,
            },
            stdio: ['ignore', 'ignore', 'inherit'],
        });
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`Electron hat nach ${READER_TIMEOUT_MS / 1000} s nicht geantwortet.`));
        }, READER_TIMEOUT_MS);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`Electron endete mit Code ${code}.`));
        });
    });
}

async function main() {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA ist nicht gesetzt - der Bericht liest den Windows-Nutzerordner.');
    const port = Number(readOption('port', DEFAULT_PORT));
    const outDir = path.resolve(ROOT, readOption('out', path.join('tmp', 'telemetry-report')));
    const sourceDir = resolveTelemetryStoreDir({ appData, port });
    if (!existsSync(sourceDir)) {
        const known = listStorePorts(appData);
        throw new Error(`Kein Speicher fuer Port ${port}. Vorhanden: ${known.join(', ') || 'keiner'}.`);
    }

    const profileDir = path.join(outDir, 'profile');
    const rowsFile = path.join(outDir, 'rounds.json');
    rmSync(profileDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
        copyStore(sourceDir, profileDir);
        await runReader({ profileDir, port, rowsFile });
    } finally {
        // Die Kopie enthaelt Spieldaten; sie bleibt nicht liegen.
        rmSync(profileDir, { recursive: true, force: true });
    }

    const report = buildTelemetryReport(JSON.parse(readFileSync(rowsFile, 'utf8')), { source: `Port ${port}` });
    writeFileSync(path.join(outDir, 'report.md'), report.markdown);
    writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report.data, null, 2));
    process.stdout.write(`${report.markdown}\nGespeichert in ${path.relative(ROOT, outDir)}\n`);
}

main().catch((error) => {
    process.stderr.write(`[telemetry-report] ${error.message}\n`);
    process.exitCode = 1;
});
