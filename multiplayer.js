(() => {
'use strict';
const PREFIX = 'moa-sudoku-v1-';
const PROTOCOL = 'moa-sudoku-race-v1';
const isGrid = a => Array.isArray(a) && a.length === 81 && a.every(n => Number.isInteger(n) && n >= 0 && n <= 9);
function validGame(game) {
  if (!game || typeof game.id !== 'string' || !isGrid(game.puzzle) || !isGrid(game.solution)) return false;
  if (!game.puzzle.some(n => n === 0)) return false;
  return game.solution.every((n,i) => n > 0 && (!game.puzzle[i] || game.puzzle[i] === n)
    && !game.solution.some((v,j) => i !== j && n === v && Sudoku.peers(i,j)));
}
function validValues(values, game) {
  return isGrid(values) && values.every((n,i) => !game.puzzle[i] || n === game.puzzle[i]);
}
function correctCount(values, game) {
  return values.reduce((sum,n,i) => sum + Number(!game.puzzle[i] && n === game.solution[i]),0);
}
function randomCode() {
  const data = new Uint32Array(1); crypto.getRandomValues(data);
  return String(100000 + data[0] % 900000);
}
class SudokuRace {
  constructor(onEvent, PeerClass = globalThis.Peer) {
    this.emit = onEvent;
    this.PeerClass = PeerClass;
    this.phase = 'idle'; this.role = null; this.peer = null; this.conn = null;
    this.game = null; this.winner = null; this.room = ''; this.timer = null; this.heartbeat = null;
    this.pending = new Set(); this.retries = 0;
  }
  notify(type, data = {}) { this.emit({type, ...data}); }
  arm(message, delay = 20000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(message), delay);
  }
  create() { this.role = 'host'; this.phase = 'creating'; this.room = randomCode(); this.openPeer(); }
  join(room) {
    if (!/^\d{6}$/.test(room)) { this.notify('error',{message:'방 번호 여섯 자리를 입력해주세요.'}); return; }
    this.role = 'guest'; this.room = room; this.phase = 'joining'; this.openPeer();
  }
  openPeer() {
    if (!this.PeerClass || typeof RTCPeerConnection === 'undefined' && this.PeerClass === globalThis.Peer) {
      this.fail('이 브라우저는 실시간 연결을 지원하지 않아요. 최신 Safari, Chrome 또는 Firefox를 사용해주세요.'); return;
    }
    this.arm('연결 서버에 접속하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.');
    try {
      const peer = this.peer = new this.PeerClass(this.role === 'host' ? PREFIX + this.room : undefined, {secure:true, debug:0});
      peer.on('open', () => {
        if (peer !== this.peer) return;
        clearTimeout(this.timer);
        if (this.role === 'host') { this.phase = 'waiting'; this.notify('room',{room:this.room}); }
        else {
          this.arm('방에 연결하지 못했어요. 방 번호와 방장의 접속 상태를 확인해주세요.');
          this.attach(peer.connect(PREFIX + this.room, {reliable:true, serialization:'json', metadata:{protocol:PROTOCOL}}));
        }
      });
      peer.on('connection', conn => {
        if (peer !== this.peer) { conn.close(); return; }
        if (this.role !== 'host' || this.phase !== 'waiting' || this.conn || conn.metadata?.protocol !== PROTOCOL) {
          this.pending.add(conn);
          const timeout = setTimeout(() => { this.pending.delete(conn); conn.close(); }, 5000);
          conn.on('open', () => {
            if (peer !== this.peer) { conn.close(); return; }
            conn.send({type:'reject',message:'이미 두 명이 참가했거나 게임이 시작된 방이에요.'});
          });
          conn.on('close',()=> {clearTimeout(timeout);this.pending.delete(conn);});
          conn.on('error',()=> {clearTimeout(timeout);this.pending.delete(conn);conn.close();});
          return;
        }
        this.attach(conn);
      });
      peer.on('error', error => {
        if (peer !== this.peer || this.phase === 'finished') return;
        if (error.type === 'unavailable-id' && this.role === 'host' && this.retries++ < 5) {
          this.peer = null; peer.destroy(); this.room = randomCode(); this.openPeer(); return;
        }
        const messages = {'peer-unavailable':'해당 방을 찾을 수 없어요. 방 번호를 확인해주세요.', 'unavailable-id':'방 번호를 만들지 못했어요. 다시 시도해주세요.', 'network':'연결 서버에 접속할 수 없어요. 인터넷 연결을 확인해주세요.'};
        this.fail(messages[error.type] || '실시간 연결에 실패했어요. 다른 네트워크에서 다시 시도해주세요.');
      });
      peer.on('disconnected', () => {
        if (peer !== this.peer || this.phase === 'finished') return;
        // An established data channel survives a signaling server disconnect.
        if (this.phase === 'playing' && this.conn?.open) return;
        this.fail('방 연결이 끊어졌어요. 새 방을 만들어 다시 시도해주세요.');
      });
    } catch { this.fail('실시간 연결을 시작하지 못했어요. 브라우저와 인터넷 연결을 확인해주세요.'); }
  }
  attach(conn) {
    this.conn = conn;
    this.arm('상대와 연결하지 못했어요. 방 번호를 확인하거나 다른 네트워크로 시도해주세요.');
    conn.on('open', () => {
      if (conn !== this.conn) return;
      this.lastSeen = Date.now();
      this.heartbeat = setInterval(() => {
        if (this.phase === 'finished') return;
        if (Date.now() - this.lastSeen > 60000) { this.fail('상대의 응답이 없어 대전이 종료되었어요.'); return; }
        this.send({type:'ping'});
      },5000);
      if (this.role === 'host') {
        this.phase = 'preparing';
        const {puzzle,solution} = Sudoku.createPuzzle('easy');
        this.game = {id: this.room + '-' + randomCode(),puzzle,solution};
        this.send({type:'prepare',game:this.game});
      }
    });
    conn.on('data', message => {
      if (conn !== this.conn || !message || typeof message.type !== 'string') return;
      this.lastSeen = Date.now();
      try { this.receive(message); } catch { this.fail('게임 데이터를 처리하지 못했어요. 새 방에서 다시 시도해주세요.'); }
    });
    conn.on('close', () => { if (conn === this.conn && this.phase !== 'finished') this.fail('상대가 방을 나갔거나 연결이 끊어졌어요. 이번 대전은 무효입니다.'); });
    conn.on('error', () => { if (conn === this.conn && this.phase !== 'finished') this.fail('상대와의 연결이 끊어졌어요. 이번 대전은 무효입니다.'); });
  }
  send(message) {
    if (!this.conn?.open) return false;
    try { this.conn.send(message); return true; }
    catch { this.fail('게임 데이터를 전송하지 못했어요. 연결을 확인해주세요.'); return false; }
  }
  receive(message) {
    if (message.type === 'ping') { this.send({type:'pong'}); return; }
    if (message.type === 'pong') return;
    if (message.type === 'reject' && this.role === 'guest' && this.phase === 'joining') { this.fail(message.message); return; }
    if (message.type === 'prepare' && this.role === 'guest' && this.phase === 'joining') {
      if (!validGame(message.game)) { this.fail('올바르지 않은 퍼즐을 받았어요. 새 방에서 다시 시도해주세요.'); return; }
      this.game = message.game; this.phase = 'preparing';
      this.send({type:'ready',id:this.game.id}); return;
    }
    if (!this.game || message.id !== this.game.id) return;
    if (message.type === 'ready' && this.role === 'host' && this.phase === 'preparing') {
      this.phase = 'playing'; clearTimeout(this.timer);
      this.send({type:'start',id:this.game.id}); this.notify('start',{game:this.game}); return;
    }
    if (message.type === 'start' && this.role === 'guest' && this.phase === 'preparing') {
      this.phase = 'playing'; clearTimeout(this.timer); this.notify('start',{game:this.game}); return;
    }
    if (message.type === 'result' && this.role === 'guest' && this.phase === 'playing' && ['host','guest'].includes(message.winner)) {
      this.finish(message.winner); return;
    }
    if (this.phase !== 'playing') return;
    if (message.type === 'progress' && this.role === 'guest' && Number.isInteger(message.count) && message.count >= 0 && message.count <= 81) {
      this.notify('progress',{count:message.count}); return;
    }
    if (message.type === 'update' && this.role === 'host' && validValues(message.values,this.game)) {
      this.notify('progress',{count:correctCount(message.values,this.game)});
      if (message.values.every((n,i) => n === this.game.solution[i])) this.decide('guest');
    }
  }
  update(values) {
    if (this.phase !== 'playing' || !validValues(values,this.game)) return;
    if (this.role === 'host') {
      if (!this.send({type:'progress',id:this.game.id,count:correctCount(values,this.game)})) return;
      if (values.every((n,i) => n === this.game.solution[i])) this.decide('host');
    } else this.send({type:'update',id:this.game.id,values:[...values]});
  }
  decide(winner) {
    if (this.phase !== 'playing') return;
    // Only the host arbitrates; the first verified completion it processes wins.
    if (this.send({type:'result',id:this.game.id,winner})) this.finish(winner);
  }
  finish(winner) {
    this.phase = 'finished'; this.winner = winner;
    clearTimeout(this.timer); clearInterval(this.heartbeat);
    this.notify('result',{won:this.role === winner});
  }
  fail(message) {
    if (['closed','error','finished'].includes(this.phase)) return;
    this.phase = 'error'; this.cleanup(); this.notify('error',{message});
  }
  cleanup() {
    clearTimeout(this.timer); clearInterval(this.heartbeat);
    const peer = this.peer; this.peer = null; this.conn = null;
    for (const conn of this.pending) conn.close();
    this.pending.clear();
    if (peer) peer.destroy();
  }
  close() { this.phase = 'closed'; this.cleanup(); }
}
globalThis.SudokuRace = SudokuRace;
})();
