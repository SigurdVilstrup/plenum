import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor, acceptManifest } from './doctor.mjs';
import { loadManifest } from './manifest.mjs';

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function fixtureRepo({
  scripts = { dev: 'vite --port 5173', start: 'node server.js --port 3000', test: 'node --test' },
  compose = true,
  makefile = true,
  apphost = true,
  envFile = '.env',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-doctor-'));
  sh(['init', '-b', 'main', root]);
  sh(['config', 'user.email', 't@e.com'], root);
  sh(['config', 'user.name', 'T'], root);
  sh(['config', 'commit.gpgsign', 'false'], root);

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts }, null, 2) + '\n',
  );
  if (compose) {
    fs.writeFileSync(
      path.join(root, 'docker-compose.yml'),
      'services:\n  db:\n    image: postgres\n    ports:\n      - "5432:5432"\n',
    );
  }
  if (makefile) fs.writeFileSync(path.join(root, 'Makefile'), 'run:\n\techo hi\n');
  if (apphost) {
    fs.mkdirSync(path.join(root, 'tools', 'aspire'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'aspire', 'apphost.mts'), 'export {};\n');
  }
  fs.writeFileSync(path.join(root, 'README'), 'x\n');
  sh(['add', 'README', 'package.json'], root);
  if (compose) sh(['add', 'docker-compose.yml'], root);
  if (makefile) sh(['add', 'Makefile'], root);
  if (apphost) sh(['add', 'tools'], root);
  sh(['commit', '-m', 'init'], root);

  if (envFile) fs.writeFileSync(path.join(root, envFile), 'SECRET=1\n');
  return root;
}

test('doctor proposes run/test from package.json and lists stack files', async () => {
  const root = fixtureRepo();
  try {
    const { findings, proposedYaml, proposed, canAccept } = await doctor(root);
    assert.equal(canAccept, true);
    assert.ok(findings.some((f) => /package\.json/i.test(f) && /dev/i.test(f)));
    assert.ok(findings.some((f) => /docker-compose/i.test(f)));
    assert.ok(findings.some((f) => /Makefile/i.test(f)));
    assert.ok(findings.some((f) => /apphost\.mts/i.test(f)));
    assert.ok(findings.some((f) => /\.env/i.test(f)));
    assert.equal(proposed.run, 'npm run dev');
    assert.equal(proposed.test, 'npm test');
    assert.deepEqual(proposed.env.copy, ['.env']);
    assert.equal(proposed.ports.offset, 100);
    assert.equal(proposed.ports.expose.web, 5173);
    assert.equal(proposed.ports.expose.api, undefined);
    const m = await loadManifest(
      (() => {
        const p = path.join(root, '.plenum', 'probe.yaml');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, proposedYaml);
        return p;
      })(),
    );
    assert.equal(m.version, 1);
    assert.equal(m.run, 'npm run dev');
    assert.equal(m.ports.expose.web, 5173);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctor ignores ports in unused scripts (start when dev wins)', async () => {
  const root = fixtureRepo({
    scripts: { dev: 'vite', start: 'node server.js --port 3000', test: 'node --test' },
    compose: false,
  });
  try {
    const { findings, proposed } = await doctor(root);
    assert.deepEqual(proposed.ports.expose, {});
    assert.ok(findings.some((f) => /wire ports manually/i.test(f)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctor canAccept false when no run script', async () => {
  const root = fixtureRepo({
    scripts: { lint: 'eslint .' },
    compose: false,
    makefile: false,
    apphost: false,
    envFile: null,
  });
  try {
    const { proposed, canAccept, findings } = await doctor(root);
    assert.equal(proposed.run, undefined);
    assert.equal(canAccept, false);
    assert.ok(findings.some((f) => /Accept disabled/i.test(f)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctor writes nothing; acceptManifest writes only .plenum/lane.yaml', async () => {
  const root = fixtureRepo({ compose: false, makefile: false, apphost: false });
  try {
    const before = fs.readdirSync(root);
    const { proposedYaml } = await doctor(root);
    assert.ok(!fs.existsSync(path.join(root, '.plenum')));
    assert.deepEqual(fs.readdirSync(root).sort(), before.sort());

    const dest = await acceptManifest(root, proposedYaml);
    assert.equal(dest, path.join(root, '.plenum', 'lane.yaml'));
    const m = await loadManifest(dest);
    assert.equal(m.version, 1);
    assert.equal(m.run, 'npm run dev');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('acceptManifest rejects missing run and invalid yaml', async () => {
  const root = fixtureRepo({ compose: false, makefile: false, apphost: false, envFile: null });
  try {
    await assert.rejects(() => acceptManifest(root, null), /yaml/i);
    await assert.rejects(() => acceptManifest(root, ''), /yaml/i);
    await assert.rejects(
      () => acceptManifest(root, 'version: 1\nsetup: npm install\n'),
      /run/i,
    );
    await assert.rejects(
      () => acceptManifest(root, 'version: 2\nrun: echo hi\n'),
      /invalid|unsupported|version/i,
    );
    assert.ok(!fs.existsSync(path.join(root, '.plenum', 'lane.yaml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dumpManifest quotes env.copy paths that need it', async () => {
  const root = fixtureRepo({
    scripts: { start: 'node server.js --port 3000' },
    compose: false,
    makefile: false,
    apphost: false,
    envFile: null,
  });
  try {
    fs.mkdirSync(path.join(root, 'tools', 'with:colon'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'with:colon', '.env'), 'X=1\n');
    const { proposedYaml, proposed } = await doctor(root);
    assert.ok(proposed.env.copy.some((p) => p.includes('with:colon')));
    assert.match(proposedYaml, /- "tools\/with:colon\/\.env"/);
    const m = await loadManifest(
      (() => {
        const p = path.join(root, 'probe.yaml');
        fs.writeFileSync(p, proposedYaml);
        return p;
      })(),
    );
    assert.ok(m.env.copy.includes('tools/with:colon/.env'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
