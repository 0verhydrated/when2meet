import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseEditor, persistResponse } from '../public/response-editor.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('Rapid edits save the latest draft and undo persists each previous selection', async () => {
  const writes = [];
  const editor = createResponseEditor({ slots: [], version: 0, save: async (slots, version) => { writes.push({ slots, version }); return { slots, version: version + 1 }; } });
  editor.change(['a']); editor.change(['a', 'b']); await editor.flush();
  assert.deepEqual(writes, [{ slots: ['a', 'b'], version: 0 }]);
  assert.equal(editor.state.dirty, false);
  editor.undo(); await editor.flush(); editor.undo(); await editor.flush();
  assert.deepEqual(writes.slice(1), [{ slots: ['a'], version: 1 }, { slots: [], version: 2 }]);
  assert.equal(editor.state.canUndo, false); assert.equal(editor.state.dirty, false);
});
test('Undo during an in-flight save queues a corrective write without parallel requests', async () => {
  const gate = deferred(), writes = []; let active = 0, maximum = 0;
  const editor = createResponseEditor({ slots: [], version: 0, save: async (slots, version) => {
    active++; maximum = Math.max(maximum, active); writes.push({ slots, version });
    if (writes.length === 1) await gate.promise;
    active--; return { slots, version: version + 1 };
  } });
  editor.change(['a']); const pending = editor.flush(); await nextTurn();
  editor.change(['a', 'b']); editor.undo(); editor.undo();
  assert.deepEqual(editor.state.slots, []); assert.equal(editor.state.dirty, true);
  gate.resolve(); await pending;
  assert.deepEqual(writes, [{ slots: ['a'], version: 0 }, { slots: [], version: 1 }]);
  assert.equal(maximum, 1); assert.equal(editor.state.dirty, false);
});
test('Undo before saving cancels an unnecessary write; viewing does not create an empty response', async () => {
  let writes = 0;
  const editor = createResponseEditor({ slots: [], version: 0, save: async slots => { writes++; return { slots, version: 1 }; } });
  editor.change(['a']); editor.undo(); await editor.flush(); assert.equal(writes, 0);
  const firstResponse = createResponseEditor({ slots: [], version: 0, exists: false, save: async slots => { writes++; return { slots, version: 1 }; } });
  await firstResponse.flush(); assert.equal(writes, 0);
  firstResponse.change([]); await firstResponse.flush(); assert.equal(writes, 1);
});
test('A connection error retains the draft for retry instead of claiming it was saved', async () => {
  let fail = true;
  const editor = createResponseEditor({ slots: [], version: 0, save: async (slots, version) => { if (fail) throw new Error('offline'); return { slots, version: version + 1 }; } });
  editor.change(['a']); await editor.flush();
  assert.equal(editor.state.phase, 'error'); assert.equal(editor.state.dirty, true); assert.deepEqual(editor.state.slots, ['a']);
  fail = false; await editor.retry(); assert.equal(editor.state.phase, 'saved'); assert.equal(editor.state.dirty, false);
});
test('A version conflict pauses autosave until an explicit server reload', async () => {
  let writes = 0;
  const editor = createResponseEditor({ slots: [], version: 0, save: async () => { writes++; throw Object.assign(new Error('conflict'), { conflict: true }); } });
  editor.change(['a']); await editor.flush();
  assert.equal(editor.state.phase, 'conflict'); editor.change(['b']); await editor.flush(); await editor.retry();
  assert.equal(writes, 1); assert.deepEqual(editor.state.slots, ['b']);
  editor.reset(['server'], 5); assert.equal(editor.state.dirty, false); assert.equal(editor.state.canUndo, false); assert.equal(editor.state.version, 5);
});
test('Server normalization and newly blocked times cannot be restored by undo', async () => {
  const blocked = new Set();
  const editor = createResponseEditor({ slots: ['a'], version: 0, normalize: slots => slots.filter(slot => !blocked.has(slot)), save: async (slots, version) => ({ slots: slots.filter(slot => slot !== 'server-blocked'), version: version + 1 }) });
  editor.change(['a', 'b', 'server-blocked']); await editor.flush(); assert.deepEqual(editor.state.slots, ['a', 'b']);
  blocked.add('b'); editor.revalidate(); await editor.flush(); editor.undo(); await editor.flush();
  assert.equal(editor.state.slots.includes('b'), false); assert.equal(editor.state.slots.includes('server-blocked'), false);
});
test('A lost write reply is recovered by reading the matching saved response', async () => {
  const calls = [];
  const result = await persistResponse(async (path, options) => { calls.push({ path, options }); if (options) throw new Error('lost reply'); return { mine: { slots: ['b', 'a'], version: 4 } }; }, '/meetings/test', ['a', 'b'], 3);
  assert.deepEqual(result, { slots: ['b', 'a'], version: 4 }); assert.equal(calls.length, 2);
});
test('A failed write never overwrites a different response from another window', async () => {
  let puts = 0;
  await assert.rejects(persistResponse(async (path, options) => { if (options) { puts++; throw Object.assign(new Error('stale'), { status: 409 }); } return { mine: { slots: ['someone-else'], version: 9 } }; }, '/meetings/test', ['mine'], 3), error => error.conflict === true);
  assert.equal(puts, 1);
});
