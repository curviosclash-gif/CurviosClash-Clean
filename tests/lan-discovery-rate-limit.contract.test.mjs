import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    DISCOVERY_RATE_LIMIT_EXPIRY_MS,
    DISCOVERY_RATE_LIMIT_MAX_SOURCES,
    DISCOVERY_RATE_LIMIT_MS,
    admitDiscoveryPacket,
} from '../electron/lan-discovery-ops.cjs';

const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

function admit(rateMap, sourceKey, message, now, parseRateMap) {
    return admitDiscoveryPacket({
        rateMap,
        parseRateMap,
        sourceKey,
        message: Buffer.from(typeof message === 'string' ? message : JSON.stringify(message)),
        magic: 'CURVIOS_HOST',
        now,
    });
}

test('invalid discovery senders do not exhaust the source limit before a real host arrives', () => {
    const rateMap = new Map();
    const parseRateMap = new Map();
    for (let index = 0; index < DISCOVERY_RATE_LIMIT_MAX_SOURCES + 6; index += 1) {
        const message = index % 2 === 0 ? '{malformed' : JSON.stringify({ magic: 'NOT_CURVIOS' });
        assert.equal(admit(rateMap, `invalid-${index}:9092`, message, 1000, parseRateMap), null);
    }

    const host = { magic: 'CURVIOS_HOST', lobbyCode: 'REAL-HOST' };
    assert.deepEqual(admit(rateMap, 'host:9092', host, 1000, parseRateMap), host);
    assert.equal(rateMap.size, 1);
});

test('discovery source rate limit remains 500ms and expired entries free the bounded map', () => {
    const rateMap = new Map();
    for (let index = 0; index < DISCOVERY_RATE_LIMIT_MAX_SOURCES; index += 1) {
        assert.ok(admit(rateMap, `host-${index}:9092`, { magic: 'CURVIOS_HOST' }, 1000));
    }

    assert.equal(admit(rateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 1000), null);
    assert.equal(admit(rateMap, 'host-0:9092', { magic: 'CURVIOS_HOST' }, 1000 + DISCOVERY_RATE_LIMIT_MS - 1), null);
    assert.ok(admit(rateMap, 'host-0:9092', { magic: 'CURVIOS_HOST' }, 1000 + DISCOVERY_RATE_LIMIT_MS));

    assert.equal(admit(rateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 1000 + DISCOVERY_RATE_LIMIT_EXPIRY_MS - 1), null);
    assert.ok(admit(rateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 1000 + DISCOVERY_RATE_LIMIT_EXPIRY_MS));
    assert.equal(rateMap.size, 2, 'expired source windows are pruned before applying the capacity limit');
});

test('Electron discovery admits parsed magic packets through the bounded expiring rate map', () => {
    assert.match(electronMain, /admitDiscoveryPacket\(\s*\{\s*rateMap:\s*discoveryRateMap,\s*parseRateMap:\s*discoveryParseRateMap/);
    assert.match(electronMain, /message:\s*msgBuf/);
    assert.match(electronMain, /discoveryParseRateMap\.clear\(\)/);
});

test('repeated malformed datagrams from one source are rejected before parsing', () => {
    const parseRateMap = new Map();
    const validRateMap = new Map();
    let parseCount = 0;
    const receive = (sourceKey, now, message = '{malformed') => admitDiscoveryPacket({
        rateMap: validRateMap,
        parseRateMap,
        sourceKey,
        message: Buffer.from(message),
        magic: 'CURVIOS_HOST',
        now,
        parseMessage(serialized) {
            parseCount += 1;
            return JSON.parse(serialized);
        },
    });

    const invalidMessage = JSON.stringify({ magic: 'NOT_CURVIOS' });
    for (let index = 0; index < DISCOVERY_RATE_LIMIT_MAX_SOURCES + 6; index += 1) {
        assert.equal(receive(`invalid-${index}:9092`, 1000, invalidMessage), null);
    }
    assert.equal(validRateMap.size, 0, 'invalid packets never occupy slots in the valid discovery map');
    assert.equal(parseRateMap.size, DISCOVERY_RATE_LIMIT_MAX_SOURCES);

    const hostMessage = JSON.stringify({ magic: 'CURVIOS_HOST', lobbyCode: 'REAL-HOST' });
    const host = receive('host:9092', 1000, hostMessage);
    assert.equal(host?.lobbyCode, 'REAL-HOST');
    assert.equal(validRateMap.size, 1);

    const parsedBeforeRepeat = parseCount;
    assert.equal(receive('invalid-75:9092', 1001, '{malformed'), null);
    assert.equal(parseCount, parsedBeforeRepeat + 1, 'a new source gets one parsing attempt');
    assert.equal(receive('invalid-75:9092', 1002, '{malformed'), null);
    assert.equal(parseCount, parsedBeforeRepeat + 1, 'repeat datagrams are rejected before JSON.parse');

    assert.equal(receive('invalid-75:9092', 1501, '{malformed'), null);
    assert.equal(parseCount, parsedBeforeRepeat + 2, 'the source may be retried after 500ms');
    assert.equal(validRateMap.size, 1, 'the valid host remains discoverable');
});

test('parse-admission and validated-discovery caps remain separate', () => {
    const parseRateMap = new Map();
    const validRateMap = new Map();
    for (let index = 0; index < DISCOVERY_RATE_LIMIT_MAX_SOURCES; index += 1) {
        assert.ok(admit(validRateMap, `host-${index}:9092`, { magic: 'CURVIOS_HOST' }, 1000, parseRateMap));
    }
    assert.equal(admit(validRateMap, 'host-0:9092', { magic: 'CURVIOS_HOST' }, 1499, parseRateMap), null);
    assert.ok(admit(validRateMap, 'host-0:9092', { magic: 'CURVIOS_HOST' }, 1500, parseRateMap));

    assert.equal(admit(validRateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 1500, parseRateMap), null);
    assert.equal(admit(validRateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 10999, parseRateMap), null);
    assert.ok(admit(validRateMap, 'new-host:9092', { magic: 'CURVIOS_HOST' }, 11500, parseRateMap));
    assert.ok(validRateMap.size <= DISCOVERY_RATE_LIMIT_MAX_SOURCES);
    assert.ok(parseRateMap.size <= DISCOVERY_RATE_LIMIT_MAX_SOURCES);
});
