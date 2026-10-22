/** Contract between the main process and Sidekick's two windows (IPC). */

export type TileStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/** Main → chat panel. */
export type TileEvent =
  | { t: 'status'; status: TileStatus }
  | { t: 'delta'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; sessionId: string; ms: number; costUsd?: number; contextTokens?: number }
  | { t: 'error'; message: string }
  /** A request Sidekick sent on the user's behalf (e.g. a handoff), shown as a user message. */
  | { t: 'user'; text: string }
  /** A quiet system line in the chat (e.g. the context was refreshed). */
  | { t: 'notice'; text: string }
  /** A copy of a bubble about the user's Claude Code chats, kept in the chat as a card. */
  | { t: 'activity'; note: PetNote }
  /** The user answered an `ask` note (in the bubble or on its card). */
  | { t: 'answered'; id: number; choice: AskChoice };

/** Answers to "still using this chat, or done with it?". */
export type AskChoice = 'keep' | 'done';

/** Main → pet: a speech bubble. All kinds but `sidekick` come from Claude Code chats. */
export interface PetNote {
  id: number;
  /** `ask` carries a question with Still using / Done buttons. */
  kind: 'sidekick' | 'done' | 'waiting' | 'long' | 'conflict' | 'ask';
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
  /** Open the chat panel (never hides it). */
  showPanel(): void;
  /** The user clicked a bubble: open what it is about. */
  openNote(id: number): void;
  answerNote(id: number, choice: AskChoice): void;
  /** Main → pet: drop a bubble that was answered elsewhere. */
  onDismiss(cb: (id: number) => void): () => void;
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
  showPanel: 'pet:show-panel',
  openNote: 'pet:open-note',
  answerNote: 'note:answer',
  dismissNote: 'pet:dismiss-note',
  petMenu: 'pet:menu',
} as const;
