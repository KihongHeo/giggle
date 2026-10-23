// Node.js test entry point; the browser uses the same classic script.
import './sudoku.js';
export const {peers, countSolutions, createPuzzle} = globalThis.Sudoku;
