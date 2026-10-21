/** Contract between the main process and the Sidekick window (IPC). */

export type TileStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/** Main → window. */
export type TileEvent =
  | { t: 'status'; status: TileStatus }
  | { t: 'delta'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; sessionId: string; ms: number; costUsd?: number }
  | { t: 'error'; message: string };

export interface WidgetInfo {
  pinned: boolean;
  dataDir: string;
}

/** What the preload script exposes to the window as `window.sidekick`. */
export interface SidekickApi {
  send(text: string): void;
  interrupt(): void;
  onEvent(cb: (e: TileEvent) => void): () => void;
  info(): Promise<WidgetInfo>;
  togglePin(): Promise<boolean>;
  openFolder(): void;
  minimize(): void;
  close(): void;
}

export const IPC = {
  send: 'chat:send',
  interrupt: 'chat:interrupt',
  event: 'chat:event',
  info: 'widget:info',
  togglePin: 'widget:toggle-pin',
  openFolder: 'widget:open-folder',
  minimize: 'win:minimize',
  close: 'win:close',
} as const;
