// Minimal Model Context Protocol server over stdio: one JSON-RPC message per line.
// Covers what an agent needs to call tools (initialize, ping, tools/list, tools/call)
// without pulling in an SDK. Pure, so a contract test can drive it without Electron.

export const MCP_PROTOCOL_VERSION = '2025-06-18';

const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_PARSE_ERROR = -32700;

/** A tool result with text and optional image parts. */
export function toolResult(value, { images = [], isError = false } = {}) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 1);
    const content = [{ type: 'text', text }];
    for (const image of images) content.push({ type: 'image', data: image.data, mimeType: image.mimeType || 'image/png' });
    return isError ? { content, isError: true } : { content };
}

/**
 * Builds a handler for parsed JSON-RPC messages. `tools` is a list of
 * { name, description, inputSchema, run(args) }; run may return a plain value or a
 * finished toolResult (recognised by its content array). Returns the response object,
 * or null for notifications.
 */
export function createMcpDispatcher({ name, version, instructions = '', tools }) {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const listing = tools.map(({ name: toolName, description, inputSchema }) => ({
        name: toolName,
        description,
        inputSchema: inputSchema || { type: 'object', properties: {} },
    }));

    return async function dispatch(message) {
        if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
            return { jsonrpc: '2.0', id: null, error: { code: JSONRPC_PARSE_ERROR, message: 'not a JSON-RPC 2.0 message' } };
        }
        const { id, method, params } = message;
        const isNotification = id === undefined;
        const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
        const fail = (code, text) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message: text } });

        if (method === 'initialize') {
            return reply({
                protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name, version },
                ...(instructions ? { instructions } : {}),
            });
        }
        if (method === 'ping') return reply({});
        if (method === 'tools/list') return reply({ tools: listing });
        if (method === 'tools/call') {
            const tool = byName.get(params?.name);
            if (!tool) return fail(JSONRPC_INVALID_PARAMS, `unknown tool: ${params?.name}`);
            try {
                const value = await tool.run(params?.arguments || {});
                return reply(Array.isArray(value?.content) ? value : toolResult(value));
            } catch (error) {
                return reply(toolResult(String(error?.stack || error), { isError: true }));
            }
        }
        if (typeof method === 'string' && method.startsWith('notifications/')) return null;
        return fail(JSONRPC_METHOD_NOT_FOUND, `method not found: ${method}`);
    };
}

/**
 * Reads newline-delimited JSON from `input`, answers on `output`. Calls run one after
 * another, because they all drive the same game window.
 */
export function serveMcpOverStdio(dispatch, { input = process.stdin, output = process.stdout, onClose = null } = {}) {
    let buffer = '';
    let queue = Promise.resolve();
    const send = (response) => { if (response) output.write(`${JSON.stringify(response)}\n`); };
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
            if (!line) continue;
            let message = null;
            try {
                message = JSON.parse(line);
            } catch {
                send({ jsonrpc: '2.0', id: null, error: { code: JSONRPC_PARSE_ERROR, message: 'invalid JSON' } });
                continue;
            }
            // Pings and the handshake must not wait behind a long tool call.
            if (message?.method !== 'tools/call') {
                dispatch(message).then(send);
                continue;
            }
            queue = queue.then(() => dispatch(message)).then(send, (error) => {
                send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(error?.message || error) } });
            });
        }
    });
    input.on('end', () => { queue.finally(() => onClose?.()); });
}
