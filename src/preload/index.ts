import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type TileEvent, type TiledeckApi } from '../shared/protocol';

const api: TiledeckApi = {
  send: (text) => ipcRenderer.send(IPC.send, text),
  interrupt: () => ipcRenderer.send(IPC.interrupt),
  onEvent(cb) {
    const listener = (_: IpcRendererEvent, e: TileEvent) => cb(e);
    ipcRenderer.on(IPC.event, listener);
    return () => ipcRenderer.off(IPC.event, listener);
  },
  newTile: () => ipcRenderer.send(IPC.newTile),
  minimize: () => ipcRenderer.send(IPC.minimize),
  close: () => ipcRenderer.send(IPC.close),
};

contextBridge.exposeInMainWorld('tiledeck', api);
