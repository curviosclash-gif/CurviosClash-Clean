import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPROVAL_DIRECTIVE = 'CLAUDE-AGENT-FREIGABE: 3141';
export const APPROVAL_TTL_MS = 2 * 60 * 1000;

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);
const STATE_DIRECTORY_NAME = 'curviosclash-claude-agent-approval';
const DENIAL_MESSAGE = `Claude-Agent gesperrt. Die aktuelle Nutzeranweisung muss in der ersten Zeile exakt "${APPROVAL_DIRECTIVE}" enthalten. Jede Freigabe gilt fuer genau einen Aufruf und hoechstens zwei Minuten.`;

function requireScope(payload) {
    const sessionId = String(payload?.session_id || '').trim();
    const cwd = String(payload?.cwd || '').trim();
    if (!sessionId || !cwd) throw new Error('Claude hook payload has no session scope');
    return { sessionId, cwd: path.resolve(cwd) };
}

export function approvalScope(payload) {
    const { sessionId, cwd } = requireScope(payload);
    const normalizedCwd = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
    return createHash('sha256').update(`${normalizedCwd}\0${sessionId}`).digest('hex');
}

export function isApprovalPrompt(prompt) {
    const firstLine = String(prompt || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    return firstLine === APPROVAL_DIRECTIVE;
}

export function createApprovalGrant(payload, now = Date.now()) {
    return {
        version: 1,
        scope: approvalScope(payload),
        issuedAt: now,
    };
}

export function isValidApprovalGrant(grant, payload, now = Date.now()) {
    const age = now - Number(grant?.issuedAt);
    return grant?.version === 1
        && grant?.scope === approvalScope(payload)
        && Number.isFinite(age)
        && age >= 0
        && age <= APPROVAL_TTL_MS;
}

export class FileApprovalStore {
    constructor(root = path.join(tmpdir(), STATE_DIRECTORY_NAME)) {
        this.root = root;
    }

    grantPath(payload) {
        return path.join(this.root, `${approvalScope(payload)}.json`);
    }

    async revoke(payload) {
        await rm(this.grantPath(payload), { force: true });
    }

    async issue(payload, grant) {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const target = this.grantPath(payload);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(grant), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            await rm(target, { force: true });
            await rename(temporary, target);
        } finally {
            await rm(temporary, { force: true });
        }
    }

    async consume(payload) {
        const target = this.grantPath(payload);
        const claimed = `${target}.${randomUUID()}.claim`;
        try {
            await rename(target, claimed);
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw error;
        }

        try {
            return JSON.parse(await readFile(claimed, 'utf8'));
        } finally {
            await rm(claimed, { force: true });
        }
    }
}

export async function processHook(mode, payload, {
    store = new FileApprovalStore(),
    now = Date.now(),
} = {}) {
    if (mode === 'arm') {
        if (payload?.hook_event_name !== 'UserPromptSubmit') throw new Error('Unexpected approval hook event');
        await store.revoke(payload);
        if (isApprovalPrompt(payload?.prompt)) {
            await store.issue(payload, createApprovalGrant(payload, now));
        }
        return { exitCode: 0, message: '' };
    }

    if (mode === 'check') {
        if (payload?.hook_event_name !== 'PreToolUse' || !AGENT_TOOL_NAMES.has(payload?.tool_name)) {
            return { exitCode: 2, message: DENIAL_MESSAGE };
        }
        const grant = await store.consume(payload);
        return isValidApprovalGrant(grant, payload, now)
            ? { exitCode: 0, message: '' }
            : { exitCode: 2, message: DENIAL_MESSAGE };
    }

    throw new Error('Unknown Claude agent lock mode');
}

async function readStdin() {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    return raw;
}

async function main() {
    const mode = process.argv[2];
    try {
        const payload = JSON.parse(await readStdin());
        const result = await processHook(mode, payload);
        if (result.message) process.stderr.write(`${result.message}\n`);
        process.exitCode = result.exitCode;
    } catch {
        process.stderr.write('Claude-Agent gesperrt: Die Freigabe konnte nicht sicher geprueft werden.\n');
        process.exitCode = 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
