const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ALLOWED = new Set([
  'tabs.list', 'tabs.open', 'tabs.select', 'tabs.close', 'tabs.rename', 'tabs.setIcon',
  'tabs.listImages', 'tabs.setImage', 'tabs.reorder', 'tabs.restore',
  'undo.snapshot', 'undo.restorePaths', 'undo.restoreLane', 'undo.uncommit', 'undo.restoreBranch',
  'edit.native', 'clipboard.read', 'clipboard.write',
  'board.get', 'repo.refresh', 'repo.doctor', 'repo.acceptManifest', 'repo.setTeamBranch', 'repo.setBaselines',
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
  'feedback.save', 'app.version', 'os.editors', 'os.diffMergeTools',
]);

contextBridge.exposeInMainWorld('plenum', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  onEdit: (cb) => ipcRenderer.on('edit', (_e, cmd) => cb(cmd)),
  setZoom: (f) => webFrame.setZoomFactor(Math.min(1.25, Math.max(0.8, Number(f) || 1))),
});
