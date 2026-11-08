const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ALLOWED = new Set([
  'tabs.list', 'tabs.open', 'tabs.select', 'tabs.close', 'tabs.rename', 'tabs.setIcon', 'tabs.reorder',
  'board.get', 'repo.refresh', 'repo.doctor', 'repo.acceptManifest',
  'os.pickFolder', 'os.reveal', 'os.openExternal', 'os.openCursor', 'os.displayPath',
  'lane.create', 'lane.remove', 'lane.commit', 'lane.push', 'lane.pull',
  'lane.rebase', 'lane.merge', 'lane.conflicts',
  'lane.conflictStage', 'lane.conflictContinue', 'lane.conflictAbort',
  'lane.stash', 'lane.stashPop',
  'lane.up', 'lane.down', 'lane.test', 'lane.status',
  'commit.changes',
  'prefs.get', 'prefs.set',
]);

contextBridge.exposeInMainWorld('overlook', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  setZoom: (f) => webFrame.setZoomFactor(Math.min(1.25, Math.max(0.8, Number(f) || 1))),
});
