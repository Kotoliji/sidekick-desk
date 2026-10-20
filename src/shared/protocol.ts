/** Contract between the main process and a chat window (IPC, one window = one tile). */

export type TileStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/** Main → window. */
export type TileEvent =
  | { t: 'status'; status: TileStatus }
  | { t: 'delta'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; sessionId: string; ms: number; costUsd?: number }
  | { t: 'error'; message: string };

/** What the preload script exposes to a chat window as `window.tiledeck`. */
export interface TiledeckApi {
  send(text: string): void;
  interrupt(): void;
  onEvent(cb: (e: TileEvent) => void): () => void;
  newTile(): void;
  minimize(): void;
  close(): void;
}

export const IPC = {
  send: 'tile:send',
  interrupt: 'tile:interrupt',
  event: 'tile:event',
  newTile: 'deck:new-tile',
  minimize: 'win:minimize',
  close: 'win:close',
} as const;
