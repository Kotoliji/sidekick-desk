/** Contract between the main process and Sidekick's two windows (IPC). */

export type TileStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/** Main → chat panel. */
export type TileEvent =
  | { t: 'status'; status: TileStatus }
  | { t: 'delta'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; sessionId: string; ms: number; costUsd?: number }
  | { t: 'error'; message: string };

/** Main → pet: a speech bubble. */
export interface PetNote {
  id: number;
  title: string;
  text: string;
}

/** What the preload script exposes to both windows as `window.sidekick`. */
export interface SidekickApi {
  // chat panel
  send(text: string): void;
  interrupt(): void;
  onEvent(cb: (e: TileEvent) => void): () => void;
  openFolder(): void;
  hidePanel(): void;
  // pet
  onNote(cb: (n: PetNote) => void): () => void;
  onStatus(cb: (s: TileStatus) => void): () => void;
  moveBy(dx: number, dy: number): void;
  setInteractive(on: boolean): void;
  togglePanel(): void;
  petMenu(): void;
}

export const IPC = {
  send: 'chat:send',
  interrupt: 'chat:interrupt',
  event: 'chat:event',
  openFolder: 'panel:open-folder',
  hidePanel: 'panel:hide',
  note: 'pet:note',
  status: 'pet:status',
  moveBy: 'pet:move-by',
  interactive: 'pet:interactive',
  togglePanel: 'pet:toggle-panel',
  petMenu: 'pet:menu',
} as const;
