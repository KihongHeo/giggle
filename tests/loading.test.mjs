import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// file:// pages cannot rely on an ES module fetch. Keep both entry scripts
// parseable as classic scripts, with the engine available before the UI loads.
test('page entry scripts load without an ES module loader', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)><\/script>/g)];
  assert.ok(scripts.length > 0);
  const context = vm.createContext({});
  let engineLoaded = false;
  for (const [, before, src, after] of scripts) {
    assert.doesNotMatch(before + after, /type\s*=\s*["']module["']/);
    assert.match(before + after, /\bdefer\b/);
    const source = readFileSync(new URL('../' + src, import.meta.url), 'utf8');
    const script = new vm.Script(source, {filename: src});
    if (src.endsWith('/sudoku.js')) {
      script.runInContext(context);
      assert.equal(typeof context.Sudoku.createPuzzle, 'function');
      engineLoaded = true;
    }
    if (src.endsWith('/app.js')) assert.ok(engineLoaded, 'engine loads before the UI');
  }
  assert.ok(engineLoaded);
});
