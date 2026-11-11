import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusal } from './gate.mjs';
import { defaultAgentSettings } from './settings.mjs';

const d = defaultAgentSettings();
const TAIL = ' The user can change this in Plenum → Settings → Agents.';

test('defaults allow run, create, remove and reads; refuse write', () => {
  for (const n of ['lane.up', 'lane.down', 'lane.test', 'lane.create', 'lane.remove', 'lane.status', 'repo.doctor']) {
    assert.equal(refusal(n, {}, d), null, n);
  }
  assert.equal(refusal('repo.doctor', { write: true }, d), 'Refused: writing lane setup is turned off for agents.' + TAIL);
});

test('switches off refuse with a message naming the setting', () => {
  const off = { ...d, run: false, create: false, remove: 'never' };
  assert.equal(refusal('lane.test', {}, off), 'Refused: starting, stopping and testing lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.create', { name: 'x' }, off), 'Refused: creating lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.remove', { lane: 1 }, off), 'Refused: removing lanes is turned off for agents.' + TAIL);
  assert.equal(refusal('lane.status', {}, off), null);
  assert.equal(refusal('repo.doctor', {}, off), null);
});

test('forced start is refused whatever the settings, for any truthy force', () => {
  for (const force of [true, 'true', 1]) {
    assert.match(refusal('lane.up', { lane: 1, force }, d), /can't start a lane with force/);
  }
  assert.equal(refusal('lane.up', { lane: 1, force: false }, d), null);
});
