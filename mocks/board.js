/* Board mock: scenarios, lane switching, selected lane header, guarded remove sheet.
   ?scenario=bad shows the day the product exists for. */

(() => {
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const authorIcon = { human: 'user', assisted: 'sparkle', agent: 'robot', mixed: 'git-merge' };
const authorLabel = { human: 'Human', assisted: 'Assisted', agent: 'Agent', mixed: 'Mixed' };

// Shared tail of history for both scenarios. Newer at top.
const tail = [
  { id: 'b2e4c1', lane: 0, msg: 'Invoice PDF footer totals (#412)', who: 'Sigurd', kind: 'human', time: '5h', parents: ['0b1d9f'] },
  { id: '0b1d9f', lane: 0, msg: 'Update README badges', who: 'Jonas', kind: 'human', time: '1d', parents: ['c0ffee'] },
  { id: 'c0ffee', lane: 0, msg: 'Fix login redirect loop', who: 'Mette', kind: 'human', time: '2d', parents: ['2a9e77'] },
  { id: '2a9e77', lane: 0, msg: 'Release 4.12', who: 'Mette', kind: 'human', time: '2d', parents: ['d7e3b8'], refs: [{ n: 'v4.12', tag: true }] },
  { id: 'd7e3b8', lane: 0, msg: 'Merge fix/session-expiry (#409)', who: 'Jonas', kind: 'human', time: '3d', merge: true, parents: ['9e1d44', 'ab77c0'] },
  { id: 'ab77c0', lane: 2, msg: 'Expire sessions on logout', who: 'Jonas', kind: 'human', time: '3d', parents: ['9e1d44'] },
  { id: '9e1d44', lane: 0, msg: 'Pricing table copy', who: 'Jonas', kind: 'human', time: '3d', parents: ['8f4a21'] },
];

const scenarios = {
  normal: {
    main: { state: 'clean', note: 'in sync with origin/main' },
    lanes: [
      { lane: 1, name: 'feat/search-filters', folder: '.worktrees/search-filters', behind: 7, dirty: 3, base: 'main', age: '3d', readiness: 'working', kind: 'assisted', tool: 'Cursor', mix: '2 human, 1 assisted',
        running: true, offset: 100, urls: [{ n: 'web', port: 5101 }, { n: 'api', port: 5155 }], data: 'shared', drift: 2 },
      { lane: 2, name: 'feat/export-csv', folder: '.worktrees/export-csv', behind: 0, ahead: 4, dirty: 0, base: 'main', age: 'today', readiness: 'unmerged', kind: 'agent', tool: 'Claude', mix: '4 of 4 by Claude',
        running: true, offset: 200, urls: [{ n: 'web', port: 5201 }, { n: 'api', port: 5255 }], data: 'shared', drift: 0, tests: 'passed 12m ago' },
      { lane: 3, name: 'fix/flaky-upload', folder: '.worktrees/flaky-upload', behind: 1, ahead: 1, dirty: 0, base: 'main', age: 'today', readiness: 'unmerged', kind: 'human', mix: '1 human', offset: 300, data: 'shared', drift: 0 },
      { lane: 4, name: 'feat/invoice-pdf', folder: '.worktrees/invoice-pdf-2', folderDiffers: true, behind: 0, dirty: 0, base: 'main', age: '5d', readiness: 'safe', kind: 'human', mix: '1 human', mergedAs: 'b2e4c1' },
    ],
    commits: [
      { id: 'wip', lane: 1, wip: true, msg: '3 files changed in .worktrees/search-filters', parents: ['a91c2e'] },
      { id: 'a91c2e', lane: 1, msg: 'Wire facet chips to query state', who: 'Sigurd', kind: 'assisted', tool: 'Cursor', time: '12m', parents: ['4c81f0'], refs: [{ n: 'feat/search-filters', wt: true }] },
      { id: 'c4f018', lane: 2, msg: 'Stream rows instead of buffering the file', who: 'Claude', kind: 'agent', tool: 'Claude', time: '41m', parents: ['3b7e10'], refs: [{ n: 'feat/export-csv', wt: true }] },
      { id: '71aa0e', lane: 3, msg: 'Retry upload with backoff', who: 'Sigurd', kind: 'human', time: '1h', parents: ['b2e4c1'], refs: [{ n: 'fix/flaky-upload', wt: true }] },
      { id: '3b7e10', lane: 2, msg: 'CSV column mapping', who: 'Claude', kind: 'agent', time: '1h', parents: ['58c3d1'] },
      { id: '58c3d1', lane: 2, msg: 'Export endpoint and auth check', who: 'Claude', kind: 'agent', time: '2h', parents: ['0ee4b2'] },
      { id: '0ee4b2', lane: 2, msg: 'Scaffold export module', who: 'Claude', kind: 'agent', time: '2h', parents: ['f10c7a'] },
      { id: 'f10c7a', lane: 0, msg: 'Bump deps', who: 'Mette', kind: 'human', time: '3h', parents: ['b2e4c1'], refs: [{ n: 'main', primary: true, wt: true }, { n: 'origin/main', remote: true }] },
      tail[0],
      { id: '4c81f0', lane: 1, msg: 'Facet query parser', who: 'Sigurd', kind: 'human', time: '1d', parents: ['61b9c3'] },
      tail[1],
      { id: '7d31a0', lane: 4, msg: 'PDF footer totals', who: 'Sigurd', kind: 'human', time: '2d', parents: ['2a9e77'], refs: [{ n: 'feat/invoice-pdf', wt: true }] },
      ...tail.slice(2),
      { id: '61b9c3', lane: 1, msg: 'Add search filter sidebar', who: 'Sigurd', kind: 'human', time: '3d', parents: ['8f4a21'] },
      { id: '8f4a21', lane: 0, msg: 'CI: cache pnpm store', who: 'Jonas', kind: 'human', time: '4d', parents: ['1a2b3c'] },
      { id: '1a2b3c', lane: 0, msg: 'Normalize invoice dates', who: 'Mette', kind: 'human', time: '4d', parents: ['5e6f70'] },
      { id: '5e6f70', lane: 0, msg: 'Drop legacy exporter', who: 'Mette', kind: 'human', time: '5d', parents: [] },
    ],
  },

  // The bad day: an agent committed on primary main and left it dirty, main is ahead of origin,
  // and a 23-behind agent lane is about to be opened as a PR.
  bad: {
    main: { state: 'dirty', note: '2 files uncommitted, 1 ahead of origin/main', tipKind: 'agent' },
    lanes: [
      { lane: 1, name: 'feat/pricing-v2', folder: '.claude/worktrees/pricing-v2', folderDiffers: true, behind: 23, ahead: 6, dirty: 0, base: 'main', age: '9d', readiness: 'unmerged', kind: 'agent', tool: 'Claude', mix: '6 of 6 by Claude',
        running: true, offset: 100, urls: [{ n: 'web', port: 5101 }, { n: 'api', port: 5155 }], data: 'shared', drift: 3 },
      { lane: 2, name: 'feat/export-csv', folder: '.worktrees/export-csv', behind: 1, ahead: 4, dirty: 0, base: 'main', age: 'today', readiness: 'unmerged', kind: 'agent', tool: 'Claude', mix: '4 of 4 by Claude', offset: 200, data: 'shared', drift: 0 },
      { lane: 3, name: 'fix/flaky-upload', folder: '.worktrees/flaky-upload', behind: 2, ahead: 2, dirty: 1, base: 'main', age: 'today', readiness: 'working', kind: 'mixed', mix: '1 human, 1 agent', offset: 300, data: 'shared', drift: 0 },
    ],
    commits: [
      { id: 'wip0', lane: 0, wip: true, danger: true, msg: '2 files changed on primary main', parents: ['9a8b7c'] },
      { id: '9a8b7c', lane: 0, msg: 'Hotfix pricing rounding', who: 'Claude', kind: 'agent', tool: 'Claude', time: '6m', parents: ['f10c7a'], refs: [{ n: 'main', primary: true, wt: true }] },
      { id: 'd4e5f6', lane: 1, msg: 'Pricing matrix v2 tables', who: 'Claude', kind: 'agent', tool: 'Claude', time: '20m', parents: ['a7b8c9'], refs: [{ n: 'feat/pricing-v2', wt: true }] },
      { id: 'wip3', lane: 3, wip: true, msg: '1 file changed in .worktrees/flaky-upload', parents: ['71aa0e'] },
      { id: '71aa0e', lane: 3, msg: 'Retry upload with backoff', who: 'Claude', kind: 'agent', time: '1h', parents: ['e0e1e2'], refs: [{ n: 'fix/flaky-upload', wt: true }] },
      { id: 'c4f018', lane: 2, msg: 'Stream rows instead of buffering the file', who: 'Claude', kind: 'agent', tool: 'Claude', time: '41m', parents: ['3b7e10'], refs: [{ n: 'feat/export-csv', wt: true }] },
      { id: 'a7b8c9', lane: 1, msg: 'Plan picker with annual toggle', who: 'Claude', kind: 'agent', time: '1h', parents: ['b0b1b2'] },
      { id: '3b7e10', lane: 2, msg: 'CSV column mapping', who: 'Claude', kind: 'agent', time: '1h', parents: ['0ee4b2'] },
      { id: 'e0e1e2', lane: 3, msg: 'Reproduce flaky upload in test', who: 'Sigurd', kind: 'human', time: '2h', parents: ['f10c7a'] },
      { id: '0ee4b2', lane: 2, msg: 'Scaffold export module', who: 'Claude', kind: 'agent', time: '2h', parents: ['b2e4c1'] },
      { id: 'f10c7a', lane: 0, msg: 'Bump deps', who: 'Mette', kind: 'human', time: '3h', parents: ['b2e4c1'], refs: [{ n: 'origin/main', remote: true }] },
      { id: 'b0b1b2', lane: 1, msg: 'Pricing v2 data model', who: 'Claude', kind: 'agent', time: '4h', parents: ['c1c2c3'] },
      tail[0],
      tail[1],
      { id: 'c1c2c3', lane: 1, msg: 'Scaffold pricing v2', who: 'Claude', kind: 'agent', time: '2d', parents: ['old-base'] },
      ...tail.slice(2),
      { id: '8f4a21', lane: 0, msg: 'CI: cache pnpm store', who: 'Jonas', kind: 'human', time: '4d', parents: ['1a2b3c'] },
      { id: '1a2b3c', lane: 0, msg: 'Normalize invoice dates', who: 'Mette', kind: 'human', time: '4d', parents: ['older'] },
    ],
  },
};

function renderPanel(sc, selected) {
  const main = sc.main;
  const mainRow = `
    <div class="section">
      <div class="section-head" title="The checkout on the team branch. Overlook watches it and never works in it.">Protected</div>
      <button class="lane-row ${selected === 0 ? 'selected' : ''}" type="button" data-lane="0">
        <span class="mark protected ${main.state === 'dirty' ? 'alert' : ''}">${icon(main.state === 'dirty' ? 'warning-circle' : 'shield-check')}</span>
        <span class="name">main</span>
        <span class="meta ${main.state === 'dirty' ? 'bad' : 'ok'}">${main.state === 'dirty' ? '2 dirty' : 'clean'}</span>
      </button>
    </div>`;

  const rows = sc.lanes
    .map((l) => {
      const run = l.running ? ' running' : '';
      const runTitle = l.running ? ' Running on :' + l.urls[0].port + '.' : '';
      const mark =
        l.readiness === 'working'
          ? `<span class="mark working${run}" title="Working: uncommitted changes.${runTitle}"><i></i></span>`
          : l.readiness === 'safe'
            ? `<span class="mark safe${run}" title="Safe to remove: merged, tree clean.${runTitle}">${icon('check-circle')}</span>`
            : `<span class="mark unmerged${run}" title="Not merged.${runTitle}"><i></i></span>`;
      const meta =
        l.readiness === 'safe'
          ? `<span class="meta ok">merged</span>`
          : l.behind > 0
            ? `<span class="meta ${l.behind >= 5 ? 'bad' : 'warn'}" title="${l.behind} commits behind origin/main">${icon('cloud-arrow-down', 'sm')}${l.behind}</span>`
            : `<span class="meta"></span>`;
      const folder = l.folderDiffers ? `<span class="folder">${l.folder}</span>` : '';
      return `<button class="lane-row ${l.lane === selected ? 'selected' : ''}" type="button" data-lane="${l.lane}" aria-pressed="${l.lane === selected}">
        ${mark}<span class="name">${l.name}</span>${meta}${folder}
      </button>`;
    })
    .join('');

  const running = sc.lanes.filter((l) => l.running);
  const runningRows = running
    .map(
      (l) => `<button class="lane-row run-row ${l.lane === selected ? 'selected' : ''}" type="button" data-lane="${l.lane}">
        <span class="mark live-ring"><i></i></span>
        <span class="name">${l.name}</span>
        <span class="meta mono">:${l.urls[0].port}</span>
        <span class="stop iconbtn" role="button" title="Stop lane" aria-label="Stop ${l.name}">${icon('stop')}</span>
      </button>`,
    )
    .join('');
  const runningSection = running.length
    ? `<div class="section">
      <div class="section-head"><span title="Lanes with their own copy of the stack running. Ports are offset per lane; data is shared unless the manifest says otherwise.">Running <span class="count">${running.length}</span></span></div>
      ${runningRows}
    </div>`
    : '';

  return `${mainRow}
    <div class="section">
      <div class="section-head">
        <span title="A lane is a git worktree on its own branch plus the way to run it: commands, a port offset, env and data mode from .overlook/lane.yaml.">Lanes <span class="count">${sc.lanes.length}</span></span>
        <a class="iconbtn" href="create-lane.html" aria-label="New lane from main">${icon('plus')}</a>
      </div>
      ${rows}
    </div>
    ${runningSection}
    <div class="section">
      <button class="lane-row" type="button" aria-expanded="false">
        <span class="mark">${icon('caret-right')}</span>
        <span class="name" style="color: var(--ink-subtle)">Branches without a lane</span>
        <span class="meta">3</span>
      </button>
    </div>
    <div class="panel-foot">
      <a class="lane-row" href="settings.html">${icon('gear-six')}<span class="name">Settings</span><kbd>⌘,</kbd></a>
    </div>`;
}

function renderHeader(sc, selected) {
  if (selected === 0) {
    const m = sc.main;
    const dirty = m.state === 'dirty';
    return `
      <div class="head-row">
      <div class="title">
        ${icon(dirty ? 'warning-circle' : 'shield-check')}
        <div><h1>main</h1><div class="path">${dirty ? 'primary checkout' : '~/Dev/mobaro-web, primary checkout'}</div></div>
      </div>
      <div class="facts">
        ${dirty
          ? `<span class="fact bad">${icon('circle-dashed', 'sm')}<strong>2 files</strong> uncommitted</span>
             <span class="fact bad">${icon('git-commit', 'sm')}<strong>1 commit</strong> unpushed</span>
             <span class="pill agent">${icon('robot')}Agent tip, Claude</span>`
          : `<span class="fact">${icon('shield-check', 'sm')}<strong>in sync</strong> with origin/main</span>
             <span class="fact">${icon('circle-dashed', 'sm')}<strong>clean</strong> tree</span>`}
      </div>
      <div class="actions">
        ${dirty
          ? `<span class="hint-text">Move this to a lane before anyone pulls.</span>`
          : `<button class="iconbtn framed" type="button" title="Reveal in Finder" aria-label="Reveal in Finder">${icon('folder-simple')}</button>`}
        <button class="btn primary" type="button">${icon('arrow-square-out', 'sm')}Open in Cursor</button>
      </div>
      </div>
      <div class="env-row">
        <span class="env-note">${icon('shield-check', 'sm')}Never started by Overlook. Run the stack from a lane.</span>
        <span class="env-sep"></span>
        <span class="badge data" title="The databases every lane shares: RavenDB :1338, SQL Edge :1433, Postgres :5432. Defined in .overlook/lane.yaml.">${icon('database', 'sm')}shared data</span>
        <span class="env-note">RavenDB <span class="mono">:1338</span> · SQL Edge <span class="mono">:1433</span> · Postgres <span class="mono">:5432</span></span>
        <a class="env-link" href="settings.html?page=repositories">${icon('gear-six', 'sm')}Lane setup in Settings</a>
      </div>`;
  }

  const l = sc.lanes.find((x) => x.lane === selected);
  const behind =
    l.readiness === 'safe'
      ? `<span class="fact ok">${icon('check-circle', 'sm')}<strong>merged</strong> into main as ${l.mergedAs}</span>`
      : l.behind > 0
        ? `<span class="fact ${l.behind >= 5 ? 'bad' : 'warn'}">${icon('cloud-arrow-down', 'sm')}<strong>${l.behind} behind</strong> origin/main${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`
        : `<span class="fact">${icon('cloud-arrow-down', 'sm')}<strong>up to date</strong>${l.ahead ? `, ${l.ahead} ahead` : ''}</span>`;
  const dirty = l.dirty
    ? `<span class="fact warn">${icon('circle-dashed', 'sm')}<strong>${l.dirty} file${l.dirty > 1 ? 's' : ''}</strong> uncommitted</span>`
    : '';
  const pill = `<span class="pill ${l.kind}" title="${l.mix}">${icon(authorIcon[l.kind])}${authorLabel[l.kind]}${l.tool ? `, ${l.tool}` : ''}</span>`;
  const remove = l.readiness === 'safe' ? `<button class="btn ghost-danger" type="button" data-remove>${icon('x', 'sm')}Remove lane</button>` : '';
  return `
    <div class="head-row">
      <div class="title">
        ${icon('tree-structure')}
        <div><h1>${l.name}</h1><div class="path">${l.folder}</div></div>
      </div>
      <div class="facts">
        ${behind}${dirty}
        <span class="fact">${icon('git-fork', 'sm')}from <strong>${l.base}</strong> ${l.age}</span>
        ${pill}
      </div>
      <div class="actions">
        ${remove}
        <button class="iconbtn framed" type="button" title="Reveal in Finder" aria-label="Reveal in Finder">${icon('folder-simple')}</button>
        <button class="btn primary" type="button">${icon('arrow-square-out', 'sm')}Open in Cursor</button>
      </div>
    </div>
    ${renderEnvRow(sc, l)}`;
}

// The environment strip: run, test, URLs, and what this lane shares. Shared data is a fact,
// not a dialog; the only gate is migration drift, and that is a sheet on Run.
function renderEnvRow(sc, l) {
  if (l.readiness === 'safe') {
    return `<div class="env-row">
      <span class="env-note">${icon('stop', 'sm')}Not running. Merged lanes are not started.</span>
    </div>`;
  }
  const sharedWith = sc.lanes.filter((x) => x.running && x.lane !== l.lane).map((x) => x.name);
  const dataTitle = `RavenDB, SQL Edge and Postgres are the same instances for every lane${sharedWith.length ? `, right now also used by ${sharedWith.join(', ')}` : ''}. Switch a service to snapshot in .overlook/lane.yaml to give this lane its own copy.`;
  const runBtn = l.running
    ? `<button class="btn" type="button" data-stop>${icon('stop', 'sm')}Stop</button>`
    : `<button class="btn" type="button" data-up>${icon('play', 'sm')}Run</button>`;
  const urls = l.running
    ? l.urls.map((u) => `<a class="chip url" href="#" title="http://localhost:${u.port}">${icon('globe-simple', 'sm')}${u.n} <span class="mono">:${u.port}</span></a>`).join('')
    : `<span class="env-note">ports <span class="mono">+${l.offset}</span> when started</span>`;
  const drift = l.drift
    ? `<span class="fact drift" title="Migrations in this lane that the shared database has not run. Run will ask before applying them.">${icon('warning-circle', 'sm')}<strong>${l.drift} migration${l.drift > 1 ? 's' : ''}</strong> not in shared DB</span>`
    : '';
  const tests = l.tests ? `<span class="env-note">${icon('check-circle', 'sm')}tests ${l.tests}</span>` : '';
  return `<div class="env-row">
    ${runBtn}
    <button class="btn" type="button">${icon('flask', 'sm')}Test</button>
    <span class="env-sep"></span>
    ${urls}
    <span class="env-sep"></span>
    <span class="badge data" title="${dataTitle}">${icon('database', 'sm')}shared data</span>
    ${drift}
    ${tests}
  </div>`;
}

// Mac sheet on Run when the lane has migrations the shared database has not seen.
function renderUpSheet(sc, l) {
  const others = sc.lanes.filter((x) => x.running && x.lane !== l.lane).map((x) => x.name);
  return `
    <form class="modal" role="dialog" aria-labelledby="up-title" onsubmit="return false">
      <div class="eyebrow warn">${icon('warning-circle', 'sm')}Shared database</div>
      <h1 id="up-title">Run ${l.name}</h1>
      <p>This lane has ${l.drift} migration${l.drift > 1 ? 's' : ''} the shared Postgres has not run. Every lane uses that database${others.length ? `, including ${others.join(' and ')}` : ''}.</p>
      <div class="list">
        <label class="list-row compact choice">
          <input type="radio" name="up" checked />
          <div class="name">Run the migrations<small>Changes the shared database for every lane. Other lanes keep running on the new schema.</small></div>
        </label>
        <label class="list-row compact choice">
          <input type="radio" name="up" />
          <div class="name">Start without them<small>The app starts; the code in this lane may not match the schema.</small></div>
        </label>
        <label class="list-row compact choice">
          <input type="radio" name="up" />
          <div class="name">Give this lane its own Postgres<small>Sets <span class="mono">postgres: snapshot</span> in <span class="mono">.overlook/lane.yaml</span>. Seeded from the latest snapshot, about 40 s.</small></div>
        </label>
      </div>
      <div class="check">
        ${icon('database')}
        <div>Ports for this lane: web <span class="mono">:${l.offset + 5001}</span>, api <span class="mono">:${l.offset + 5055}</span>. RavenDB and SQL Edge stay shared.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn primary" type="submit">${icon('play', 'sm')}Run lane</button>
      </div>
    </form>`;
}

function renderRemoveSheet(l) {
  return `
    <form class="modal" role="dialog" aria-labelledby="remove-title" onsubmit="return false">
      <div class="eyebrow">${icon('check-circle', 'sm')}Safe to remove</div>
      <h1 id="remove-title">Remove lane ${l.name}</h1>
      <p>The branch is merged into main and the tree is clean. This removes the folder only.</p>
      <div class="list">
        <div class="list-row compact">
          ${icon('folder-simple')}
          <div class="name">Folder<small class="mono">${l.folder}</small></div>
          <div class="detail">Deleted from disk</div>
        </div>
        <div class="list-row compact">
          ${icon('git-branch')}
          <div class="name">Branch<small class="mono">${l.name}</small></div>
          <div class="detail">Kept. Squash-merged as <span class="mono">${l.mergedAs}</span></div>
        </div>
      </div>
      <div class="check">
        ${icon('shield-check')}
        <div>One lane at a time. Overlook never removes a lane with uncommitted work or unmerged commits, and never in bulk.</div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn danger" type="submit">${icon('x', 'sm')}Remove folder</button>
      </div>
    </form>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const sc = scenarios[params.get('scenario')] || scenarios.normal;
  let selected = Number(params.get('lane') ?? sc.lanes[0].lane);

  const panel = document.querySelector('.panel');
  const header = document.querySelector('.lane-head');
  const graph = document.querySelector('.graph');
  const sheet = document.querySelector('.sheet-layer');

  const paint = () => {
    panel.innerHTML = renderPanel(sc, selected);
    header.innerHTML = renderHeader(sc, selected);
    OverlookGraph.renderGraph(graph, { commits: sc.commits, selectedLane: selected, runningLanes: new Set(sc.lanes.filter((l) => l.running).map((l) => l.lane)) });
    panel.querySelectorAll('[data-lane]').forEach((b) =>
      b.addEventListener('click', () => {
        selected = Number(b.dataset.lane);
        paint();
      }),
    );
    const openSheet = (html) => {
      sheet.innerHTML = html;
      sheet.classList.add('open');
      sheet.querySelector('[data-close]').addEventListener('click', () => sheet.classList.remove('open'));
    };
    header.querySelector('[data-remove]')?.addEventListener('click', () => openSheet(renderRemoveSheet(sc.lanes.find((x) => x.lane === selected))));
    header.querySelector('[data-up]')?.addEventListener('click', () => {
      const l = sc.lanes.find((x) => x.lane === selected);
      if (l.drift) openSheet(renderUpSheet(sc, l));
      else {
        l.running = true;
        l.urls = [{ n: 'web', port: l.offset + 5001 }, { n: 'api', port: l.offset + 5055 }];
        paint();
      }
    });
    header.querySelector('[data-stop]')?.addEventListener('click', () => {
      sc.lanes.find((x) => x.lane === selected).running = false;
      paint();
    });
    const live = document.querySelector('[data-live-count]');
    if (live) {
      const n = sc.lanes.filter((l) => l.running).length;
      live.textContent = n ? ` · ${n} running` : '';
    }
  };

  sheet?.addEventListener('click', (e) => e.target === sheet && sheet.classList.remove('open'));
  paint();
  if (params.has('remove')) header.querySelector('[data-remove]')?.click();
  if (params.has('up')) {
    const l = sc.lanes.find((x) => x.lane === selected);
    if (l?.drift) {
      l.running = false;
      paint();
      sheet.innerHTML = renderUpSheet(sc, l);
      sheet.classList.add('open');
      sheet.querySelector('[data-close]').addEventListener('click', () => sheet.classList.remove('open'));
    }
  }
});

window.OverlookScenarios = scenarios;
})();
