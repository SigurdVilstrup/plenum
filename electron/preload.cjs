const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ALLOWED = new Set([
  'tabs.list', 'tabs.open', 'tabs.select', 'tabs.close', 'tabs.rename', 'tabs.setIcon',
  'tabs.listImages', 'tabs.setImage', 'tabs.reorder', 'tabs.restore',
  'undo.snapshot', 'undo.restorePaths', 'undo.restoreLane', 'undo.uncommit', 'undo.restoreBranch',
  'edit.native', 'clipboard.write',
  'board.get', 'stats.get', 'repo.refresh', 'repo.doctor', 'repo.acceptManifest', 'repo.setTeamBranch', 'repo.setBaselines',
  'os.pickFolder', 'os.reveal', 'os.openExternal', 'os.openEditor', 'os.openTerminal', 'os.displayPath',
  'lane.create', 'lane.remove', 'lane.commit', 'lane.revert', 'lane.push', 'lane.pull',
  'lane.rebase', 'lane.merge', 'lane.conflicts',
  'branch.checkout', 'branch.update', 'branch.push', 'branch.rename', 'branch.delete',
  'lane.conflictStage', 'lane.conflictContinue', 'lane.conflictAbort',
  'lane.stash', 'lane.stashPop', 'lane.stashShow',
  'lane.up', 'lane.down', 'lane.test', 'lane.status',
  'commit.changes', 'file.workingDiff', 'file.workingShow',
  'file.diff', 'file.history', 'file.blame', 'file.show',
  'accounts.list', 'accounts.setHttps', 'accounts.removeHttps',
  'prefs.get', 'prefs.set', 'git.identity.get', 'git.identity.set',
  'feedback.capture', 'feedback.save', 'feedback.send', 'feedback.checkin',
  'app.version', 'app.update.state', 'app.update.check', 'app.update.download',
  'app.update.install', 'app.update.act',
  'os.editors', 'os.diffMergeTools',
  'agents.get', 'agents.setSettings', 'agents.preview', 'agents.add', 'agents.remove', 'agents.linkOnPath',
]);

contextBridge.exposeInMainWorld('plenum', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  onEdit: (cb) => ipcRenderer.on('edit', (_e, cmd, text) => cb(cmd, text)),
  onUpdate: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('update', handler);
    return () => ipcRenderer.removeListener('update', handler);
  },
  onRepoChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('repo.changed', handler);
    return () => ipcRenderer.removeListener('repo.changed', handler);
  },
  setZoom: (f) => webFrame.setZoomFactor(Math.min(1.25, Math.max(0.8, Number(f) || 1))),
});
