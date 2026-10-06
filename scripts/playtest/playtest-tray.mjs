// Starts the notification-area icon (playtest-tray.ps1) next to a playtest session so a
// person can watch: "Testfenster anzeigen/verbergen" moves the test windows on and off
// screen without a restart, "Test beenden" cancels the running job and closes the
// session. Windows only; elsewhere, or if PowerShell fails, the session runs without it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'playtest-tray.ps1');

/**
 * @param {{ onShow: () => void, onHide: () => void, onStop: () => void, log?: (line: string) => void }} handlers
 * @returns {Promise<{ setTooltip(text: string): void, setVisible(visible: boolean): void, close(): void } | null>}
 */
export async function startTray({ onShow, onHide, onStop, log = () => {} }) {
    if (process.platform !== 'win32' || process.env.CURVIOS_PLAYTEST_TRAY === '0') return null;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let buffer = '';
    let closed = false;
    const ready = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 15_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                // PowerShell may prefix its first line with a byte order mark.
                const line = buffer.slice(0, index).replace(/^﻿/, '').trim();
                buffer = buffer.slice(index + 1);
                if (line === 'ready') { clearTimeout(timer); resolve(true); }
                else if (line === 'show') onShow();
                else if (line === 'hide') onHide();
                else if (line === 'stop') onStop();
            }
        });
        child.on('exit', () => { closed = true; clearTimeout(timer); resolve(false); });
        child.on('error', (error) => { log(`[playtest-tray] ${error.message}`); closed = true; resolve(false); });
    });
    child.stderr.on('data', (chunk) => log(`[playtest-tray] ${String(chunk).trim()}`));
    if (!(await ready)) {
        if (!closed) child.kill();
        return null;
    }
    const send = (line) => { if (!closed && child.stdin.writable) child.stdin.write(`${line}\n`); };
    return {
        setTooltip: (text) => send(`tooltip ${String(text).replace(/[\r\n]+/g, ' ')}`),
        setVisible: (visible) => send(`visible ${visible ? 'true' : 'false'}`),
        close: () => {
            if (closed) return;
            send('exit');
            child.stdin.end();
            setTimeout(() => { if (!closed) child.kill(); }, 3000).unref();
        },
    };
}
