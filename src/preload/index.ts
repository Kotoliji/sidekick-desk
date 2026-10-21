import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type SidekickApi } from '../shared/protocol';

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.off(channel, listener);
}

const api: SidekickApi = {
  send: (text) => ipcRenderer.send(IPC.send, text),
  interrupt: () => ipcRenderer.send(IPC.interrupt),
  onEvent: (cb) => subscribe(IPC.event, cb),
  openFolder: () => ipcRenderer.send(IPC.openFolder),
  hidePanel: () => ipcRenderer.send(IPC.hidePanel),
  onNote: (cb) => subscribe(IPC.note, cb),
  onStatus: (cb) => subscribe(IPC.status, cb),
  moveBy: (dx, dy) => ipcRenderer.send(IPC.moveBy, dx, dy),
  setInteractive: (on) => ipcRenderer.send(IPC.interactive, on),
  togglePanel: () => ipcRenderer.send(IPC.togglePanel),
  showPanel: () => ipcRenderer.send(IPC.showPanel),
  openNote: (id) => ipcRenderer.send(IPC.openNote, id),
  petMenu: () => ipcRenderer.send(IPC.petMenu),
};

contextBridge.exposeInMainWorld('sidekick', api);
