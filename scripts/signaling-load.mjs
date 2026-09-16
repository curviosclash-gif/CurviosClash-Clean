import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../src/shared/contracts/SignalingSessionContract.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PLAYERS_PER_LOBBY = 10;
const REQUEST_TIMEOUT_MS = 8_000;

function parseArguments(argv) {
    const read = (name, fallback = '') => {
        const index = argv.indexOf(name);
        return index >= 0 ? String(argv[index + 1] || '') : fallback;
    };
    const matrix = read('--matrix', '10,20,50').split(',')
        .map((value) => Math.max(1, Math.floor(Number(value))))
        .filter(Number.isFinite);
    return { matrix, output: read('--output', ''), serverModule: read('--server-module', '') };
}

function waitForMessage(socket, predicate, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(reject, new Error('ack_timeout')), timeoutMs);
        const onMessage = (raw) => {
            let message;
            try { message = JSON.parse(String(raw)); } catch { return; }
            if (message?.type === SIGNALING_EVENT_TYPES.ERROR) {
                finish(reject, Object.assign(new Error(message.message || 'signaling_error'), { code: message.code }));
                return;
            }
            if (predicate(message)) finish(resolve, message);
        };
        const onClose = () => finish(reject, new Error('socket_closed_before_ack'));
        const finish = (callback, value) => {
            clearTimeout(timer);
            socket.off('message', onMessage);
            socket.off('close', onClose);
            callback(value);
        };
        socket.on('message', onMessage);
        socket.on('close', onClose);
    });
}

async function openSocket(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return socket;
}

async function request(socket, type, payload, expectedType) {
    const acknowledgment = waitForMessage(socket, (message) => message?.type === expectedType);
    socket.send(JSON.stringify(createSignalingEnvelope(type, payload)));
    return acknowledgment;
}

async function listLobbies(url) {
    const socket = await openSocket(url);
    try {
        const response = await request(
            socket,
            SIGNALING_COMMAND_TYPES.LIST_LOBBIES,
            null,
            SIGNALING_EVENT_TYPES.LOBBY_LIST
        );
        return response.lobbies || [];
    } finally {
        socket.close();
    }
}

async function startServer(lobbyCount, serverModule = '') {
    const child = fork(SCRIPT_PATH, ['--server-child'], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
            ...process.env,
            SIGNALING_LOAD_LOBBIES: String(lobbyCount),
            SIGNALING_LOAD_SERVER_MODULE: serverModule,
        },
    });
    const [ready] = await once(child, 'message');
    if (ready?.type !== 'ready') throw new Error('load_server_failed_to_start');
    return { child, url: `ws://127.0.0.1:${ready.port}`, startMetrics: ready.metrics };
}

let nextMetricsRequestId = 1;

function requestChildMetrics(child) {
    const requestId = nextMetricsRequestId++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('load_server_metrics_timeout')), REQUEST_TIMEOUT_MS);
        const onMessage = (message) => {
            if (message?.type !== 'metrics' || message.requestId !== requestId) return;
            clearTimeout(timer);
            child.off('message', onMessage);
            resolve(message.metrics);
        };
        child.on('message', onMessage);
        child.send({ type: 'metrics', requestId });
    });
}

async function stopServer(child) {
    const resultPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('load_server_stop_timeout')), REQUEST_TIMEOUT_MS);
        const onMessage = (message) => {
            if (message?.type !== 'stopped') return;
            clearTimeout(timer);
            child.off('message', onMessage);
            resolve(message.metrics);
        };
        child.on('message', onMessage);
    });
    child.send({ type: 'stop' });
    return resultPromise;
}

async function runScenario(lobbyCount, serverModule = '') {
    const { child, url, startMetrics } = await startServer(lobbyCount, serverModule);
    const clients = [];
    const counters = { acknowledgments: 0, timeouts: 0, errors: 0, restores: 0, directoryChecks: 0 };
    const startedAt = performance.now();
    let activePhase = null;
    try {
        for (let lobbyIndex = 0; lobbyIndex < lobbyCount; lobbyIndex += 1) {
            const hostSocket = await openSocket(url);
            const created = await request(hostSocket, SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
                maxPlayers: PLAYERS_PER_LOBBY,
                actorId: `host-${lobbyIndex}`,
                name: `Host ${lobbyIndex}`,
                metadata: { hostName: `Host ${lobbyIndex}`, mapKey: 'standard', gameMode: 'CLASSIC' },
            }, SIGNALING_EVENT_TYPES.LOBBY_CREATED);
            counters.acknowledgments += 1;
            const lobbyClients = [{
                primary: hostSocket,
                peerId: created.playerId,
                token: created.sessionToken,
                isHost: true,
            }];
            clients.push(lobbyClients);

            if (lobbyIndex === 0 || lobbyIndex === Math.floor(lobbyCount / 2) || lobbyIndex === lobbyCount - 1) {
                const directory = await listLobbies(url);
                counters.directoryChecks += 1;
                if (!directory.some((entry) => entry.lobbyCode === created.lobbyCode)) {
                    throw new Error('joinable_lobby_missing_during_fill');
                }
            }

            for (let playerIndex = 1; playerIndex < PLAYERS_PER_LOBBY; playerIndex += 1) {
                let primary = await openSocket(url);
                const joined = await request(primary, SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
                    lobbyCode: created.lobbyCode,
                    actorId: `player-${lobbyIndex}-${playerIndex}`,
                    name: `Player ${playerIndex}`,
                }, SIGNALING_EVENT_TYPES.LOBBY_JOINED);
                counters.acknowledgments += 1;
                const player = { primary, peerId: joined.playerId, token: joined.sessionToken, isHost: false };
                lobbyClients.push(player);

                if (playerIndex === 1 && lobbyIndex % 5 === 0) {
                    primary.close();
                    await once(primary, 'close');
                    primary = await openSocket(url);
                    const resumed = await request(primary, SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, {
                        lobbyCode: created.lobbyCode,
                        playerId: player.peerId,
                        sessionToken: player.token,
                    }, SIGNALING_EVENT_TYPES.CONNECTION_RESUMED);
                    player.primary = primary;
                    player.token = resumed.sessionToken;
                    counters.acknowledgments += 1;
                    counters.restores += 1;
                }
            }

            for (const player of lobbyClients) {
                const transport = await openSocket(url);
                await request(transport, SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
                    lobbyCode: created.lobbyCode,
                    playerId: player.peerId,
                    sessionToken: player.token,
                }, SIGNALING_EVENT_TYPES.TRANSPORT_ATTACHED);
                player.transport = transport;
                counters.acknowledgments += 1;
            }

            for (let burst = 0; burst < 3; burst += 1) {
                await request(hostSocket, SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, {
                    metadata: {
                        hostName: `Host ${lobbyIndex}`,
                        mapKey: burst % 2 ? 'maze' : 'standard',
                        gameMode: 'CLASSIC',
                        winsNeeded: 5 + burst,
                    },
                }, SIGNALING_EVENT_TYPES.LOBBY_METADATA_UPDATED);
                counters.acknowledgments += 1;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
        const steadyMetrics = await requestChildMetrics(child);
        const directoryLatencyMs = [];
        for (let burst = 0; burst < 20; burst += 1) {
            const directoryStartedAt = performance.now();
            const directory = await listLobbies(url);
            directoryLatencyMs.push(performance.now() - directoryStartedAt);
            counters.directoryChecks += 1;
            if (directory.length !== 0) throw new Error('full_lobbies_leaked_into_directory');
        }
        const orderedLatency = [...directoryLatencyMs].sort((left, right) => left - right);
        const latencyAt = (quantile) => orderedLatency[Math.min(
            orderedLatency.length - 1,
            Math.floor(orderedLatency.length * quantile)
        )];
        activePhase = {
            steadyMetrics,
            directoryLatencyMs: {
                count: directoryLatencyMs.length,
                p50: latencyAt(0.5),
                p95: latencyAt(0.95),
                max: orderedLatency.at(-1),
            },
        };
    } catch (error) {
        if (error?.message === 'ack_timeout') counters.timeouts += 1;
        else counters.errors += 1;
        throw Object.assign(error, { counters });
    } finally {
        for (const lobbyClients of clients) {
            for (const client of lobbyClients) {
                client.transport?.close();
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const lobbyClients of clients) {
            for (const client of lobbyClients) {
                if (client.primary?.readyState === WebSocket.OPEN) {
                    client.primary.send(JSON.stringify(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.LEAVE)));
                }
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const lobbyClients of clients) {
            for (const client of lobbyClients) {
                client.primary?.close();
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    let postCleanupMetrics = await requestChildMetrics(child);
    const cleanupDeadline = Date.now() + 2_000;
    while ((postCleanupMetrics.activeConnections !== 0 || postCleanupMetrics.activeLobbies !== 0)
        && Date.now() < cleanupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        postCleanupMetrics = await requestChildMetrics(child);
    }
    if (postCleanupMetrics.activeConnections !== 0 || postCleanupMetrics.activeLobbies !== 0) {
        throw new Error('signaling_cleanup_incomplete');
    }
    const metrics = await stopServer(child);
    return {
        lobbyCount,
        playersPerLobby: PLAYERS_PER_LOBBY,
        simulatedSockets: lobbyCount * PLAYERS_PER_LOBBY * 2,
        durationMs: performance.now() - startedAt,
        counters,
        startMetrics,
        activePhase,
        postCleanupMetrics,
        metrics,
    };
}

async function runServerChild() {
    const serverModule = String(process.env.SIGNALING_LOAD_SERVER_MODULE || '').trim();
    const { createSignalingServer } = await import(serverModule
        ? pathToFileURL(serverModule).href
        : '../server/signaling-server.js');
    const lobbyCount = Math.max(1, Math.floor(Number(process.env.SIGNALING_LOAD_LOBBIES) || 1));
    const maxConnections = lobbyCount * PLAYERS_PER_LOBBY * 2 + 32;
    const server = createSignalingServer(0, {
        maxConnectionsPerIp: maxConnections,
        maxLobbiesPerIp: lobbyCount + 1,
        maxLobbies: lobbyCount + 1,
        maxMessagesPerSocket: 1_000,
        maxMessagesPerIp: lobbyCount * PLAYERS_PER_LOBBY * 40,
        unassignedSocketTimeoutMs: 60_000,
    });
    if (!server.address()) await once(server, 'listening');
    process.send?.({ type: 'ready', port: server.address().port, metrics: server.getMetrics() });
    process.on('message', (message) => {
        if (message?.type === 'metrics') {
            process.send?.({ type: 'metrics', requestId: message.requestId, metrics: server.getMetrics() });
            return;
        }
        if (message?.type !== 'stop') return;
        const metrics = server.getMetrics();
        for (const socket of server.clients) socket.terminate();
        server.close(() => {
            process.send?.({ type: 'stopped', metrics });
            process.disconnect?.();
        });
    });
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (!options.output) throw new Error('--output must name an external JSON file');
    const results = [];
    for (const lobbyCount of options.matrix) results.push(await runScenario(lobbyCount, options.serverModule));
    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            matrix: options.matrix,
            playersPerLobby: PLAYERS_PER_LOBBY,
            socketsPerPlayer: 2,
            endpoint: 'loopback',
            productionLimitsChanged: false,
            syntheticServerOverrides: true,
        },
        results,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    await writeFile(options.output, json, 'utf8');
    process.stdout.write(json);
}

if (process.argv.includes('--server-child')) {
    await runServerChild();
} else {
    await main();
}
