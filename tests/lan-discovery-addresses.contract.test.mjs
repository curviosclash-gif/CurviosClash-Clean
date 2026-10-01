import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    MAX_DISCOVERY_HOST_ADDRESSES,
    resolveDiscoveryCandidateIps,
    sendDiscoveryAnnouncement,
} from '../electron/lan-discovery-ops.cjs';

const electronPackage = JSON.parse(readFileSync(new URL('../electron/package.json', import.meta.url), 'utf8'));
const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

test('a discovery announcement sends one backward-compatible packet with every host address', () => {
    const packets = [];
    const socket = {
        send(...args) { packets.push(args); },
    };

    sendDiscoveryAnnouncement(socket, {
        magic: 'CURVIOS_HOST',
        lobbyCode: 'LAN-123',
        port: 19090,
    }, ['192.168.1.44', '10.0.0.8', '192.168.1.44'], 9092, '255.255.255.255');

    assert.equal(packets.length, 1);
    const [buffer, offset, length, port, address] = packets[0];
    assert.equal(offset, 0);
    assert.equal(length, buffer.length);
    assert.equal(port, 9092);
    assert.equal(address, '255.255.255.255');
    const payload = JSON.parse(buffer.toString());
    assert.equal(payload.ip, '192.168.1.44', 'legacy receivers keep seeing the primary address');
    assert.deepEqual(payload.ips, ['192.168.1.44', '10.0.0.8']);
    assert.equal(payload.magic, 'CURVIOS_HOST');
    assert.equal(payload.port, 19090);
});

test('discovery candidates prefer the UDP source and include addresses from old and new senders', () => {
    assert.deepEqual(
        resolveDiscoveryCandidateIps({
            ip: '10.0.0.8',
            ips: ['192.168.1.44', '10.0.0.8', '172.16.0.3'],
        }, '192.168.1.44'),
        ['192.168.1.44', '10.0.0.8', '172.16.0.3'],
    );
    assert.deepEqual(
        resolveDiscoveryCandidateIps({ ip: '10.0.0.8' }, '192.168.1.44'),
        ['192.168.1.44', '10.0.0.8'],
    );
});

test('discovery address lists reject hostnames and protocols, dedupe IPv4s, and stay bounded', () => {
    const manyAddresses = Array.from(
        { length: MAX_DISCOVERY_HOST_ADDRESSES + 4 },
        (_unused, index) => `10.0.0.${index + 1}`,
    );
    const candidates = resolveDiscoveryCandidateIps({
        ip: '10.0.0.1',
        ips: ['http://attacker.example', 'attacker.example', '::1', ...manyAddresses],
    }, '192.168.1.44');

    assert.equal(candidates.length, MAX_DISCOVERY_HOST_ADDRESSES);
    assert.equal(candidates[0], '192.168.1.44');
    assert.equal(new Set(candidates).size, candidates.length);
    assert.equal(candidates.includes('attacker.example'), false);
    assert.equal(candidates.includes('http://attacker.example'), false);
    assert.equal(candidates.includes('10.0.0.16'), false, 'addresses beyond the bounded list are ignored');
    assert.deepEqual(resolveDiscoveryCandidateIps({ ips: ['localhost', 'https://host'] }, 'not-an-ip'), []);

    const packets = [];
    sendDiscoveryAnnouncement({ send: (...args) => packets.push(args) }, { magic: 'CURVIOS_HOST' }, [
        '192.168.1.44', '192.168.1.44', 'host.example', '10.0.0.8', ...manyAddresses,
    ], 9092, '255.255.255.255');
    const payload = JSON.parse(packets[0][0].toString());
    assert.deepEqual(payload.ips, [
        '192.168.1.44',
        '10.0.0.8',
        ...manyAddresses.filter((address) => address !== '10.0.0.8').slice(0, MAX_DISCOVERY_HOST_ADDRESSES - 2),
    ]);
    assert.equal(payload.ips.length, MAX_DISCOVERY_HOST_ADDRESSES);
    assert.equal(payload.ip, payload.ips[0]);
});

test('the Electron main process uses and packages the discovery helpers', () => {
    assert.match(electronMain, /sendDiscoveryAnnouncement\(\s*broadcastSocket,/);
    assert.match(electronMain, /resolveDiscoveryCandidateIps\(\s*data,\s*rinfo\?\.address\s*\)/);
    assert.ok(electronPackage.build.files.includes('lan-discovery-ops.cjs'));
});
