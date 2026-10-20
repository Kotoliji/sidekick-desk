import { useEffect, useReducer, useRef } from 'react';
import type { ClientMsg, TileEvent, TileStatus } from '../../shared/protocol.ts';

export type Part = { kind: 'text'; text: string } | { kind: 'tool'; name: string };
export type Message = { role: 'user' | 'assistant'; parts: Part[] };

export interface Tile {
  id: string;
  title: string;
  status: TileStatus;
  messages: Message[];
  lastMs?: number;
  error?: string;
}

type Action = { type: 'user'; tileId: string; text: string } | { type: 'event'; tileId: string; e: TileEvent };

function appendToAssistant(messages: Message[], part: Part): Message[] {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return [...messages, { role: 'assistant', parts: [part] }];
  const parts = [...last.parts];
  const tail = parts[parts.length - 1];
  if (part.kind === 'text' && tail?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: tail.text + part.text };
  else parts.push(part);
  return [...messages.slice(0, -1), { ...last, parts }];
}

function tileReducer(tile: Tile, action: Action): Tile {
  if (action.type === 'user') {
    return { ...tile, error: undefined, messages: [...tile.messages, { role: 'user', parts: [{ kind: 'text', text: action.text }] }] };
  }
  const e = action.e;
  switch (e.t) {
    case 'status':
      return { ...tile, status: e.status };
    case 'delta':
      return { ...tile, messages: appendToAssistant(tile.messages, { kind: 'text', text: e.text }) };
    case 'tool':
      return { ...tile, messages: appendToAssistant(tile.messages, { kind: 'tool', name: e.name }) };
    case 'done':
      return { ...tile, lastMs: e.ms };
    case 'error':
      return { ...tile, error: e.message };
  }
}

function reducer(tiles: Tile[], action: Action): Tile[] {
  return tiles.map((t) => (t.id === action.tileId ? tileReducer(t, action) : t));
}

const initialTiles: Tile[] = [{ id: 'tile-1', title: 'Main', status: 'idle', messages: [] }];

/** Deck state plus the WebSocket link to the local server (reconnects with backoff). */
export function useDeck() {
  const [tiles, dispatch] = useReducer(reducer, initialTiles);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let retry = 0;
    let timer: number | undefined;
    let disposed = false;

    const connect = () => {
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => (retry = 0);
      sock.onmessage = (ev) => {
        const { tileId, ...e } = JSON.parse(ev.data) as TileEvent & { tileId: string };
        dispatch({ type: 'event', tileId, e: e as TileEvent });
      };
      sock.onclose = () => {
        if (disposed) return;
        timer = window.setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  const post = (msg: ClientMsg) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  };

  return {
    tiles,
    send(tileId: string, text: string) {
      dispatch({ type: 'user', tileId, text });
      post({ type: 'send', tileId, text });
    },
    interrupt(tileId: string) {
      post({ type: 'interrupt', tileId });
    },
  };
}
