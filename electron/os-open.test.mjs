import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTerminalId,
  editorsForPlatform,
  listEditors,
  terminalOptions,
} from './os-open.mjs';

test('darwin editors include Cursor.app paths', () => {
  const e = editorsForPlatform('darwin');
  assert.ok(e.cursor.apps.some((p) => p.endsWith('Cursor.app')));
});

test('win32 editors include Cursor.exe paths', () => {
  const e = editorsForPlatform('win32');
  assert.ok(e.cursor.apps.some((p) => p.endsWith('Cursor.exe')));
});

test('listEditors always includes custom', () => {
  const list = listEditors('darwin');
  assert.ok(list.some((x) => x.id === 'custom'));
});

test('terminal options differ by platform', () => {
  assert.deepEqual(terminalOptions('darwin')[0], ['terminal', 'Terminal']);
  assert.deepEqual(terminalOptions('win32')[0], ['windows-terminal', 'Windows Terminal']);
  assert.equal(defaultTerminalId('win32'), 'windows-terminal');
  assert.equal(defaultTerminalId('darwin'), 'terminal');
});
