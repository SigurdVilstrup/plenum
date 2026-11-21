import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scourPortHits,
  loadAllowlist,
  addAllowlistEntry,
  filterHits,
  snippetHash,
  wiringChecks,
} from './port-scour.mjs';

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-scour-'));
  fs.writeFileSync(path.join(root, 'app.js'), "const url = 'http://localhost:3000';\n");
  fs.writeFileSync(path.join(root, 'ok.js'), "fetch('https://example.com')\n");
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'index.js'), "localhost:9999\n");
  return root;
}

test('scour finds host:port and skips node_modules', async () => {
  const root = tmpRepo();
  try {
    const hits = await scourPortHits(root);
    assert.ok(hits.some((h) => h.path === 'app.js' && /localhost:3000/.test(h.snippet)));
    assert.ok(!hits.some((h) => h.path.includes('node_modules')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('allowlist silences a hit', async () => {
  const root = tmpRepo();
  try {
    const hits = await scourPortHits(root);
    const hit = hits.find((h) => h.path === 'app.js');
    assert.ok(hit);
    await addAllowlistEntry(root, { path: hit.path, line: hit.line, snippetHash: hit.hash, note: 'intentional' });
    const list = await loadAllowlist(root);
    assert.equal(list.length, 1);
    assert.equal(filterHits(hits, list).length, hits.length - 1);
    assert.equal(snippetHash(hit.path, hit.snippet), hit.hash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wiringChecks flags unused expose names', () => {
  const w = wiringChecks({
    run: 'npm run dev',
    ports: { expose: { web: 5173, api: 3001 } },
    env: { set: {} },
  });
  assert.ok(w.unused.includes('web'));
  assert.ok(w.unused.includes('api'));
  assert.equal(w.proposedWires.VITE_API_URL, 'http://127.0.0.1:{port.api}');
});
