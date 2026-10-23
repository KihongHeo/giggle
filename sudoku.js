(() => {
'use strict';
const peers = (a, b) => Math.floor(a / 9) === Math.floor(b / 9) || a % 9 === b % 9 || (Math.floor(a / 27) === Math.floor(b / 27) && Math.floor(a % 9 / 3) === Math.floor(b % 9 / 3));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function countSolutions(input, limit = 2) {
  const board = [...input];
  function solve() {
    let selected = -1, options = [];
    for (let i = 0; i < 81; i++) {
      if (board[i]) continue;
      const possible = [1,2,3,4,5,6,7,8,9].filter(n => !board.some((v, j) => v === n && peers(i, j)));
      if (!possible.length) return 0;
      if (selected === -1 || possible.length < options.length) { selected = i; options = possible; }
      if (possible.length === 1) break;
    }
    if (selected === -1) return 1;
    let count = 0;
    for (const n of options) { board[selected] = n; count += solve(); if (count >= limit) break; }
    board[selected] = 0;
    return count;
  }
  return solve();
}
function createPuzzle(level = 'easy') {
  const groups = () => shuffle([0,1,2]).flatMap(g => shuffle([0,1,2]).map(n => g * 3 + n));
  const rows = groups(), cols = groups(), digits = shuffle([1,2,3,4,5,6,7,8,9]);
  const solution = rows.flatMap(r => cols.map(c => digits[(r * 3 + Math.floor(r / 3) + c) % 9]));
  const puzzle = [...solution], target = {easy:40, medium:48, hard:54}[level] ?? 40;
  let removed = 0;
  for (const i of shuffle(Array.from({length:81}, (_, n) => n))) {
    const n = puzzle[i]; puzzle[i] = 0;
    if (countSolutions(puzzle) !== 1) puzzle[i] = n; else removed++;
    if (removed >= target) break;
  }
  return {puzzle, solution};
}

globalThis.Sudoku = Object.freeze({peers, countSolutions, createPuzzle});
})();
