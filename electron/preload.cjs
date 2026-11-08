const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = new Set([
  'tabs.list', 'tabs.open', 'tabs.select', 'tabs.close', 'tabs.rename', 'tabs.setIcon',
  'board.get', 'repo.refresh',
  'os.pickFolder', 'os.reveal', 'os.openCursor', 'os.displayPath',
  'lane.create', 'lane.remove', 'lane.commit', 'lane.push', 'lane.pull',
  'lane.rebase', 'lane.merge', 'lane.conflicts',
  'lane.conflictStage', 'lane.conflictContinue', 'lane.conflictAbort',
]);

contextBridge.exposeInMainWorld('overlook', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
});
