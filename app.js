(() => {
'use strict';
const {createPuzzle, peers} = globalThis.Sudoku;
const $ = id => document.getElementById(id);
const KEY = 'moa-sudoku-v1';
const labels = {easy:'EASY · 쉬움', medium:'MEDIUM · 보통', hard:'HARD · 어려움'};
let state = null, selected = -1, noteMode = false, paused = false, inGame = false;
let lastTick = Date.now();
let race = null, singleState, raceStartedAt = 0, networkGeneration = 0;
let peerLibraryPromise;
const preview = [5,0,0,0,7,0,0,0,0,6,0,0,1,9,5,0,0,0,0,9,8,0,0,0,0,6,0,8,0,0,0,6,0,0,0,3,4,0,0,8,0,3,0,0,1,7,0,0,0,2,0,0,0,6,0,6,0,0,0,0,2,8,0,0,0,0,4,1,9,0,0,5,0,0,0,0,8,0,0,7,9];
preview.forEach((n, i) => { const cell = document.createElement('span'); cell.className = 'preview-cell' + ([13,39,66].includes(i) ? ' accent' : ''); cell.textContent = n || ''; $('preview').append(cell); });
const cells = Array.from({length:81}, (_, i) => {
  const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cell';
  cell.addEventListener('click', () => { if (paused) return; selected = i; render(); });
  $('board').append(cell); return cell;
});
for (let n = 1; n <= 9; n++) {
  const button = document.createElement('button');
  const digit = document.createElement('span'); digit.textContent = n;
  const remaining = document.createElement('small'); remaining.className = 'number-remaining';
  button.append(digit, remaining);
  button.setAttribute('aria-label', `${n} 입력`);
  button.addEventListener('click', () => input(n)); $('number-pad').append(button);
}
function validSave(s) {
  const grid = a => Array.isArray(a) && a.length === 81 && a.every(n => Number.isInteger(n) && n >= 0 && n <= 9);
  return s && grid(s.puzzle) && grid(s.solution) && s.solution.every(n => n > 0) && grid(s.values)
    && s.puzzle.every((n,i) => !n || (n === s.solution[i] && n === s.values[i]))
    && s.solution.every((n,i) => !s.solution.some((v,j) => j !== i && v === n && peers(i,j)))
    && Array.isArray(s.notes) && s.notes.length === 81 && s.notes.every(a => Array.isArray(a) && a.every(n => Number.isInteger(n) && n >= 1 && n <= 9))
    && Object.hasOwn(labels,s.level) && Number.isFinite(s.elapsed) && s.elapsed >= 0 && Number.isInteger(s.hints) && s.hints >= 0 && s.hints <= 3;
}
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (validSave(saved)) { state = saved; state.history = []; state.won = state.values.every((n,i) => n === state.solution[i]); } } catch { /* Storage may be unavailable. Play still works. */ }
function save() { if (!state || race) return; try { localStorage.setItem(KEY, JSON.stringify({...state,history:[]})); } catch { /* Optional persistence. */ } }
function updateHome() { $('single-description').textContent = state && !state.won ? '이어서 풀기 · 내 퍼즐이 기다리고 있어요' : '오롯이 나에게 집중하는 시간'; }
updateHome();
function active() { return state && inGame && !paused && !state.won && (!race || race.phase === 'playing') && !document.querySelector('dialog[open]'); }
function snapshot() { state.history.push({values:[...state.values], notes:state.notes.map(n => [...n])}); if (state.history.length > 100) state.history.shift(); }
function formatTime(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function say(message) { $('status').textContent = message; }
function render() {
  if (!state) return;
  cells.forEach((cell,i) => {
    const value = state.values[i];
    cell.className = 'cell';
    if (state.puzzle[i]) cell.classList.add('given');
    if (selected >= 0 && peers(i,selected)) cell.classList.add('related');
    if (selected >= 0 && value && value === state.values[selected]) cell.classList.add('same');
    if (selected === i) cell.classList.add('selected');
    if (value && value !== state.solution[i]) cell.classList.add('invalid');
    cell.replaceChildren();
    if (value) cell.textContent = value;
    else if (state.notes[i].length) {
      const notes = document.createElement('span'); notes.className = 'cell-notes';
      for (let n = 1; n <= 9; n++) { const note = document.createElement('span'); note.textContent = state.notes[i].includes(n) ? n : ''; notes.append(note); }
      cell.append(notes);
    }
    cell.setAttribute('aria-label', `${Math.floor(i/9)+1}행 ${i%9+1}열, ${value || '빈칸'}${state.puzzle[i] ? ', 주어진 숫자' : ''}${state.notes[i].length && !value ? ', 메모 '+state.notes[i].join(' ') : ''}`);
    cell.setAttribute('aria-pressed', String(selected === i));
    cell.tabIndex = i === (selected >= 0 ? selected : 0) ? 0 : -1;
  });
  const filled = state.values.filter(Boolean).length;
  $('progress').textContent = `${filled} / 81`;
  $('progress-bar').style.width = `${filled / 81 * 100}%`;
  $('difficulty-label').textContent = labels[state.level];
  $('timer').textContent = formatTime(state.elapsed);
  $('hint-count').textContent = state.hints;
  $('hint').disabled = !!race || !state.hints || state.won;
  $('pause').disabled = !!race;
  $('undo').disabled = !state.history.length || state.won;
  $('notes').setAttribute('aria-pressed', String(noteMode));
  $('notes-state').textContent = noteMode ? 'ON' : 'OFF';
  [...$('number-pad').children].forEach((button,i) => {
    const digit = i + 1;
    const filled = state.values.filter((n,index) => n === digit && n === state.solution[index]).length;
    const remaining = 9 - filled;
    button.querySelector('.number-remaining').textContent = `${remaining}칸`;
    button.setAttribute('aria-label', `${digit} 입력, 남은 ${remaining}칸`);
    button.classList.toggle('complete', remaining === 0);
  });
  $('pause-overlay').hidden = !paused;
  $('pause').textContent = paused ? '▷' : 'Ⅱ';
  $('pause').setAttribute('aria-label', paused ? '계속하기' : '일시 정지');
}
function checkWin() {
  if (race) { race.update(state.values); return; }
  if (state.values.every((n,i) => n === state.solution[i])) {
    state.won = true; save(); updateHome();
    say('완성했어요! 모든 숫자가 제자리를 찾았습니다.');
    $('win-description').textContent = `${labels[state.level].split(' · ')[1]} 난이도를 ${formatTime(state.elapsed)} 만에 완성했어요. 수고했어요!`;
    $('win-dialog').showModal();
  }
}
function input(n) {
  if (!active()) return;
  if (selected < 0) { say('먼저 숫자를 입력할 빈칸을 선택해주세요.'); return; }
  if (state.puzzle[selected]) { say('처음부터 주어진 숫자는 바꿀 수 없어요.'); return; }
  snapshot();
  if (noteMode) {
    if (state.values[selected]) { state.history.pop(); say('메모는 빈칸에 적을 수 있어요.'); return; }
    const notes = state.notes[selected];
    state.notes[selected] = notes.includes(n) ? notes.filter(v => v !== n) : [...notes,n].sort();
    say('가능한 숫자를 메모해두세요.');
  } else {
    state.values[selected] = n; state.notes[selected] = [];
    if (n === state.solution[selected]) { state.notes = state.notes.map((notes,i) => peers(i,selected) ? notes.filter(v => v !== n) : notes); say('좋아요. 차근차근 다음 칸으로.'); }
    else say('이 숫자는 정답과 달라요. 가로, 세로와 상자를 다시 살펴보세요.');
  }
  checkWin(); render(); save();
}
function enterGame() { inGame = true; paused = false; lastTick = Date.now(); $('home').hidden = true; $('game').hidden = false; render(); window.scrollTo(0,0); }
function newGame(level) {
  const {puzzle, solution} = createPuzzle(level);
  state = {puzzle,solution,values:[...puzzle],notes:Array.from({length:81},()=>[]),level,elapsed:0,hints:3,history:[],won:false};
  selected = puzzle.indexOf(0); noteMode = false; $('new-dialog').close();
  say('서두르지 않아도 괜찮아요.'); enterGame(); save(); updateHome();
}
function openNew() { $('new-description').textContent = state && !state.won ? '새 게임을 시작하면 현재 퍼즐의 진행 상황이 사라집니다.' : '편한 난이도를 골라 시작하세요.'; $('new-dialog').showModal(); }
$('single').addEventListener('click',()=> state && !state.won ? enterGame() : openNew());
$('new-game').addEventListener('click',openNew);
$('back').addEventListener('click',()=> { if (race) { exitRace(); return; } save(); inGame = false; $('game').hidden = true; $('home').hidden = false; updateHome(); window.scrollTo(0,0); });
$('rules-open').addEventListener('click',()=> $('rules-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click',()=> b.closest('dialog').close()));
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click',()=> newGame(b.dataset.level)));
$('play-again').addEventListener('click',()=> { $('win-dialog').close(); openNew(); });
$('notes').addEventListener('click',()=> { if (!active()) return; noteMode = !noteMode; say(noteMode ? '메모 모드: 후보 숫자를 적어보세요.' : '숫자 입력 모드입니다.'); render(); });
$('erase').addEventListener('click',()=> {
  if (!active() || selected < 0 || state.puzzle[selected]) return;
  if (!state.values[selected] && !state.notes[selected].length) return;
  snapshot(); state.values[selected] = 0; state.notes[selected] = []; say('선택한 칸을 지웠어요.'); if (race) race.update(state.values); render(); save();
});
$('undo').addEventListener('click',()=> { if (!active() || !state.history.length) return; const last = state.history.pop(); state.values = last.values; state.notes = last.notes; say('한 단계 되돌렸어요.'); if (race) race.update(state.values); render(); save(); });
$('hint').addEventListener('click',()=> {
  if (!active() || race || state.hints <= 0) return;
  let index = selected;
  if (index < 0 || state.values[index] === state.solution[index]) index = state.values.findIndex((n,i) => n !== state.solution[i]);
  if (index < 0) return;
  snapshot(); selected = index; state.values[index] = state.solution[index]; state.notes[index] = [];
  state.notes = state.notes.map((notes,i) => peers(i,index) ? notes.filter(n => n !== state.solution[index]) : notes);
  state.hints--; say('선택한 칸에 정답을 채웠어요. 힌트는 게임마다 세 번 사용할 수 있어요.');
  checkWin(); render(); save();
});
function togglePause() { if (!state || state.won || race) return; paused = !paused; lastTick = Date.now(); render(); }
$('pause').addEventListener('click',togglePause); $('resume').addEventListener('click',togglePause);
document.addEventListener('keydown',event => {
  if (!active() || event.altKey) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $('undo').click(); return; }
  if (event.ctrlKey || event.metaKey) return;
  const moves = {ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]};
  if (moves[event.key]) {
    event.preventDefault(); const [dr,dc] = moves[event.key];
    if (selected < 0) selected = 0;
    else { const r = Math.max(0,Math.min(8,Math.floor(selected/9)+dr)); const c = Math.max(0,Math.min(8,selected%9+dc)); selected = r*9+c; }
    render(); cells[selected].focus({preventScroll:true}); return;
  }
  if (/^[1-9]$/.test(event.key)) { event.preventDefault(); input(Number(event.key)); }
  if (['Backspace','Delete','0'].includes(event.key)) { event.preventDefault(); $('erase').click(); }
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); $('notes').click(); }
});
setInterval(()=> {
  const now = Date.now();
  if (race && race.phase === 'playing' && inGame) { state.elapsed = now - raceStartedAt; $('timer').textContent = formatTime(state.elapsed); }
  else if (!race && active() && !document.hidden) { state.elapsed += now - lastTick; $('timer').textContent = formatTime(state.elapsed); save(); }
  lastTick = now;
},1000);
document.addEventListener('visibilitychange',()=> { if (!race && document.hidden && inGame && state && !state.won) { paused = true; render(); save(); } lastTick = Date.now(); });
window.addEventListener('pagehide',()=> { save(); if (race) race.close(); });

function loadPeerLibrary() {
  if (globalThis.Peer) return Promise.resolve();
  if (!peerLibraryPromise) {
    peerLibraryPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(()=> { script.remove(); reject(new Error('연결 라이브러리를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.')); },12000);
      script.src = './vendor/peerjs.min.js';
      script.onload = ()=> { clearTimeout(timer); resolve(); };
      script.onerror = ()=> { clearTimeout(timer); script.remove(); reject(new Error('연결 라이브러리를 불러오지 못했어요. 페이지 파일을 확인해주세요.')); };
      document.head.append(script);
    }).catch(error => { peerLibraryPromise = null; throw error; });
  }
  return peerLibraryPromise;
}
function resetMultiMenu() {
  networkGeneration++;
  if (race) { race.close(); race = null; }
  $('multi-menu').hidden = false; $('join-form').hidden = true; $('room-wait').hidden = true;
  $('multi-return').hidden = true; $('multi-status').textContent = ''; $('room-code').textContent = '';
}
function closeMulti() { resetMultiMenu(); $('multi-dialog').close(); }
$('multi').addEventListener('click',()=> { resetMultiMenu(); $('multi-dialog').showModal(); });
$('multi-close').addEventListener('click',closeMulti);
$('multi-dialog').addEventListener('cancel',event => { event.preventDefault(); closeMulti(); });
$('multi-return').addEventListener('click',resetMultiMenu);
$('show-join').addEventListener('click',()=> {
  $('multi-menu').hidden = true; $('join-form').hidden = false; $('multi-return').hidden = false;
  $('room-input').value = ''; $('room-input').focus();
});
async function connectRace(role, room = '') {
  const attempt = ++networkGeneration;
  $('multi-menu').hidden = true; $('join-form').hidden = true; $('room-wait').hidden = true;
  $('multi-return').hidden = false;
  $('multi-status').textContent = role === 'host' ? '새 방을 만들고 있어요…' : '방에 연결하고 있어요…';
  try {
    await loadPeerLibrary();
    if (attempt !== networkGeneration || !$('multi-dialog').open) return;
    const session = new SudokuRace(event => {
      if (race !== session) return;
      if (event.type === 'room') {
        $('room-code').textContent = event.room; $('room-wait').hidden = false;
        $('multi-status').textContent = '';
      }
      if (event.type === 'start') startRace(event.game);
      if (event.type === 'progress' && inGame) {
        const total = state.puzzle.filter(n => !n).length;
        $('opponent-progress').textContent = `${event.count} / ${total}`;
      }
      if (event.type === 'result') showRaceResult(event.won ? 'win' : 'loss');
      if (event.type === 'error') {
        if (inGame && singleState !== undefined) showRaceResult('error',event.message);
        else { $('room-wait').hidden = true; $('multi-status').textContent = event.message; }
      }
    });
    race = session;
    if (role === 'host') session.create(); else session.join(room);
  } catch (error) { if (attempt === networkGeneration) $('multi-status').textContent = error.message; }
}
$('create-room').addEventListener('click',()=> connectRace('host'));
$('join-form').addEventListener('submit',event => {
  event.preventDefault();
  const room = $('room-input').value.trim();
  if (!/^\d{6}$/.test(room)) { $('multi-status').textContent = '방 번호 여섯 자리를 입력해주세요.'; return; }
  connectRace('guest',room);
});
function startRace(game) {
  singleState = state;
  state = {puzzle:[...game.puzzle],solution:[...game.solution],values:[...game.puzzle],notes:Array.from({length:81},()=>[]),level:'easy',elapsed:0,hints:0,history:[],won:false};
  selected = state.puzzle.indexOf(0); noteMode = false;
  $('multi-dialog').close();
  $('race-banner').hidden = false; $('race-room').textContent = race.room;
  $('opponent-progress').textContent = `0 / ${state.puzzle.filter(n => !n).length}`;
  $('new-game').hidden = true; $('back').textContent = '← 대전 나가기';
  document.body.classList.add('racing'); raceStartedAt = Date.now();
  say('대전 시작! 같은 퍼즐을 먼저 완성해보세요.'); enterGame();
}
function showRaceResult(outcome, message = '') {
  state.elapsed = Date.now() - raceStartedAt; state.won = true;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  const win = outcome === 'win', error = outcome === 'error';
  $('race-result').dataset.outcome = outcome;
  $('race-result-symbol').textContent = win ? '✦' : error ? '↯' : '◇';
  $('race-result-label').textContent = error ? 'MATCH ENDED' : win ? 'YOU WIN' : 'NEXT TIME';
  $('race-result-title').textContent = error ? '대전이 중단되었어요.' : win ? '승리했어요!' : '아쉽지만, 패배했어요.';
  $('race-result-description').textContent = error ? message : win ? `먼저 모든 칸을 완성했어요. 기록 ${formatTime(state.elapsed)}. 멋진 집중이었어요!` : '상대가 먼저 모든 칸을 완성했어요. 다음 도전에서 다시 만나요.';
  render(); $('race-result').showModal();
}
function exitRace() {
  networkGeneration++;
  if (race) { race.close(); race = null; }
  if (singleState !== undefined) { state = singleState; singleState = undefined; }
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  inGame = false; paused = false;
  $('race-banner').hidden = true; $('new-game').hidden = false; $('back').textContent = '← 시작 화면';
  $('game').hidden = true; $('home').hidden = false; document.body.classList.remove('racing');
  updateHome(); window.scrollTo(0,0);
}
$('race-exit').addEventListener('click',exitRace);
$('race-result').addEventListener('cancel',event => { event.preventDefault(); exitRace(); });
})();
