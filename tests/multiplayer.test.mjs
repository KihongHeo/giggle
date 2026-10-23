import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {webcrypto} from 'node:crypto';

// An asynchronous in-memory substitute for PeerJS data channels. The production
// room protocol runs unchanged, including host arbitration and connection errors.
function setup() {
  const peers = new Map(); let serial = 0;
  class Connection extends EventEmitter {
    constructor(peer,metadata) { super(); this.peer = peer; this.metadata = metadata; this.open = false; this.closed = false; }
    send(message) { assert.ok(this.open); const data = structuredClone(message); queueMicrotask(()=> { if (this.other.open) this.other.emit('data',data); }); }
    close() {
      if (this.closed) return;
      this.closed = true; this.open = false; queueMicrotask(()=>this.emit('close'));
      if (this.other && !this.other.closed) this.other.close();
    }
  }
  class Peer extends EventEmitter {
    constructor(id) {
      super(); this.id = id || `guest-${++serial}`; this.connections = []; this.destroyed = false;
      queueMicrotask(()=> {
        if (this.destroyed) return;
        if (peers.has(this.id)) this.emit('error',{type:'unavailable-id'});
        else { peers.set(this.id,this); this.emit('open',this.id); }
      });
    }
    connect(id,options) {
      const local = new Connection(id,options.metadata); this.connections.push(local);
      queueMicrotask(()=> {
        const remote = peers.get(id);
        if (!remote) { this.emit('error',{type:'peer-unavailable'}); return; }
        const other = new Connection(this.id,options.metadata); local.other = other; other.other = local;
        remote.connections.push(other); remote.emit('connection',other);
        queueMicrotask(()=> { if (!local.closed) { local.open = true; other.open = true; local.emit('open'); other.emit('open'); } });
      });
      return local;
    }
    destroy() { this.destroyed = true; if (peers.get(this.id) === this) peers.delete(this.id); for (const conn of this.connections) conn.close(); }
  }
  const context = vm.createContext({crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,Date});
  for (const file of ['sudoku.js','multiplayer.js']) vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
  const sessions = [];
  const make = ()=> { const events = []; const race = new context.SudokuRace(e=>events.push(structuredClone(e)),Peer); sessions.push(race); return {race,events}; };
  const cleanup = ()=> sessions.forEach(r=>r.close());
  return {make,cleanup};
}
const flush = ()=>new Promise(resolve=>setImmediate(resolve));
async function pair(env) {
  const host = env.make(); host.race.create(); await flush();
  assert.match(host.race.room,/^\d{6}$/);
  assert.equal(host.race.phase,'waiting');
  const guest = env.make(); guest.race.join(host.race.room); await flush();
  assert.equal(host.race.phase,'playing'); assert.equal(guest.race.phase,'playing');
  return {host,guest};
}
for (const winner of ['host','guest']) test(`${winner} finishes first: exactly one winner and one loser`,async t=> {
  const env = setup(); t.after(env.cleanup);
  const {host,guest} = await pair(env);
  assert.deepEqual(host.events.find(e=>e.type === 'start').game,guest.events.find(e=>e.type === 'start').game);
  const winning = winner === 'host' ? host : guest;
  winning.race.update([...winning.race.game.solution]); await flush();
  // Late and duplicated completions cannot reverse the decision.
  host.race.update([...host.race.game.solution]); guest.race.update([...guest.race.game.solution]); await flush();
  assert.deepEqual(host.events.filter(e=>e.type === 'result'),[{type:'result',won:winner === 'host'}]);
  assert.deepEqual(guest.events.filter(e=>e.type === 'result'),[{type:'result',won:winner === 'guest'}]);
});
test('simultaneous claims resolve to a single shared decision',async t=> {
  const env = setup(); t.after(env.cleanup); const {host,guest} = await pair(env);
  guest.race.update([...guest.race.game.solution]); host.race.update([...host.race.game.solution]); await flush();
  assert.equal(host.race.winner,guest.race.winner);
  assert.equal(host.events.filter(e=>e.type==='result').length,1);
  assert.equal(guest.events.filter(e=>e.type==='result').length,1);
});
test('progress syncs both ways; incorrect and malformed completions cannot win',async t=> {
  const env = setup(); t.after(env.cleanup); const {host,guest} = await pair(env);
  const values = [...guest.race.game.puzzle]; const blank = values.indexOf(0);
  values[blank] = guest.race.game.solution[blank]; guest.race.update(values); host.race.update(values); await flush();
  assert.equal(host.events.find(e=>e.type==='progress').count,1);
  assert.equal(guest.events.find(e=>e.type==='progress').count,1);
  const wrong = [...guest.race.game.solution]; wrong[blank] = wrong[blank] % 9 + 1;
  guest.race.update(wrong);
  guest.race.conn.send({type:'update',id:guest.race.game.id,values:Array(81).fill(1)});
  guest.race.conn.send({type:'result',id:guest.race.game.id,winner:'guest'});
  guest.race.conn.send({type:'update',id:'stale-game',values:[...guest.race.game.solution]}); await flush();
  assert.equal(host.race.phase,'playing'); assert.equal(guest.race.phase,'playing');
});
test('a third player is rejected without disrupting the match',async t=> {
  const env = setup(); t.after(env.cleanup); const {host,guest} = await pair(env);
  const third = env.make(); third.race.join(host.race.room); await flush();
  assert.equal(third.race.phase,'error'); assert.match(third.events.at(-1).message,/두 명/);
  assert.equal(host.race.phase,'playing'); assert.equal(guest.race.phase,'playing');
});
test('missing rooms, invalid codes and disconnects have explicit errors',async t=> {
  const env = setup(); t.after(env.cleanup);
  const bad = env.make(); bad.race.join('12'); assert.match(bad.events.at(-1).message,/여섯/);
  const missing = env.make(); missing.race.join('000000'); await flush();
  assert.equal(missing.race.phase,'error'); assert.match(missing.events.at(-1).message,/찾을 수/);
  const {host,guest} = await pair(env); guest.race.close(); await flush();
  assert.equal(host.race.phase,'error'); assert.match(host.events.at(-1).message,/연결이 끊어/);
  assert.equal(host.events.some(e=>e.type==='result'),false);
});
test('cancelled rooms are removed and cannot be joined',async t=> {
  const env = setup(); t.after(env.cleanup);
  const host = env.make(); host.race.create(); await flush(); const room = host.race.room;
  host.race.close(); const guest = env.make(); guest.race.join(room); await flush();
  assert.equal(guest.race.phase,'error');
});
