import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type SidekickApi, type TileEvent } from '../shared/protocol';

const api: SidekickApi = {
  send: (text) => ipcRenderer.send(IPC.send, text),
  interrupt: () => ipcRenderer.send(IPC.interrupt),
  onEvent(cb) {
    const listener = (_: IpcRendererEvent, e: TileEvent) => cb(e);
    ipcRenderer.on(IPC.event, listener);
    return () => ipcRenderer.off(IPC.event, listener);
  },
  info: () => ipcRenderer.invoke(IPC.info),
  togglePin: () => ipcRenderer.invoke(IPC.togglePin),
  openFolder: () => ipcRenderer.send(IPC.openFolder),
  minimize: () => ipcRenderer.send(IPC.minimize),
  close: () => ipcRenderer.send(IPC.close),
};

contextBridge.exposeInMainWorld('sidekick', api);
