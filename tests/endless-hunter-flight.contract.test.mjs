import test from 'node:test';
import assert from 'node:assert/strict';
import { runEndlessHunterFlight } from './helpers/endless-hunter-flight.mjs';

test('controlled seeded course navigation reduces wall losses while separating normal streamed retirements', () => {
    const rows=[];
    for(let seed=1;seed<=12;seed++) for(const ahead of [false,true]) {
        for(const guided of [false,true]) rows.push(runEndlessHunterFlight({seed,ahead,guided,seconds:20}));
    }
    const old=rows.filter(row=>!row.guided), current=rows.filter(row=>row.guided);
    const losses=group=>group.filter(row=>row.wallDeath).length;
    const contacts=group=>group.reduce((sum,row)=>sum+row.wallContacts,0);
    assert.ok(losses(old)>0,'the comparison contains actual lethal wall damage');
    assert.ok(losses(current)<losses(old), `${losses(current)} current versus ${losses(old)} previous wall deaths`);
    assert.ok(contacts(current)<contacts(old));
    assert.ok(current.some(row=>row.routeTicks>0));
    assert.ok(current.some(row=>row.retired&&row.hp>0),'normal streaming retirement is not a wall death');
    for(const row of rows) assert.equal(row.wallDeath,row.hp<=0);
    assert.deepEqual(runEndlessHunterFlight({seed:1,ahead:true,guided:true,seconds:20}),
        current.find(row=>row.seed===1&&row.ahead),'fixed policy and collision randomness are reproducible');
});
