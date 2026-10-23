import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzle, countSolutions, peers} from '../sudoku.mjs';
for (const level of ['easy','medium','hard']) {
  test(`${level}: valid solution, matching clues, exactly one solution`, () => {
    for (let repeat = 0; repeat < 4; repeat++) {
      const {puzzle, solution} = createPuzzle(level);
      assert.equal(solution.length,81);
      for (let i = 0; i < 81; i++) {
        assert.ok(solution[i] >= 1 && solution[i] <= 9);
        assert.ok(!puzzle[i] || puzzle[i] === solution[i]);
        assert.equal(solution.some((n,j) => i !== j && peers(i,j) && n === solution[i]),false);
      }
      assert.equal(countSolutions(puzzle),1);
      const blanks = puzzle.filter(n => n === 0).length;
      assert.ok(blanks >= 35);
      assert.ok(blanks <= {easy:40,medium:48,hard:54}[level]);
    }
  });
}
test('solver detects ambiguous boards',()=>assert.equal(countSolutions(Array(81).fill(0)),2));
