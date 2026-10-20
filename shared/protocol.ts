/** Wire protocol between the browser and the local server (one WebSocket, multiplexed by tileId). */

export type TileStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/** Server → client, sent as `{ tileId, ...TileEvent }`. */
export type TileEvent =
  | { t: 'status'; status: TileStatus }
  | { t: 'delta'; text: string }
  | { t: 'tool'; name: string }
  | { t: 'done'; sessionId: string; ms: number; costUsd?: number }
  | { t: 'error'; message: string };

/** Client → server. */
export type ClientMsg =
  | { type: 'send'; tileId: string; text: string }
  | { type: 'interrupt'; tileId: string }
  | { type: 'close'; tileId: string };
