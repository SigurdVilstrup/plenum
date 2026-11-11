import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from './load-env.mjs';

test('loadEnvFile sets missing keys and skips comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(
    file,
    '# comment\nPLENUM_FEEDBACK_URL=https://example.test/fn\nPLENUM_SUPABASE_ANON_KEY="abc"\n',
  );
  delete process.env.PLENUM_FEEDBACK_URL;
  delete process.env.PLENUM_SUPABASE_ANON_KEY;
  assert.equal(loadEnvFile(file), true);
  assert.equal(process.env.PLENUM_FEEDBACK_URL, 'https://example.test/fn');
  assert.equal(process.env.PLENUM_SUPABASE_ANON_KEY, 'abc');
});

test('loadEnvFile does not override existing env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'PLENUM_FEEDBACK_URL=from-file\n');
  process.env.PLENUM_FEEDBACK_URL = 'already-set';
  loadEnvFile(file);
  assert.equal(process.env.PLENUM_FEEDBACK_URL, 'already-set');
  delete process.env.PLENUM_FEEDBACK_URL;
});
