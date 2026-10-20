import { useEffect, useReducer } from 'react';
import type { TileEvent, TileStatus, TiledeckApi } from '../../shared/protocol';

declare global {
  interface Window {
    tiledeck: TiledeckApi;
  }
}

export type Part = { kind: 'text'; text: string } | { kind: 'tool'; name: string };
export type Message = { role: 'user' | 'assistant'; parts: Part[] };

export interface TileState {
  title: string;
  status: TileStatus;
  messages: Message[];
  lastMs?: number;
  error?: string;
}

type Action = { type: 'user'; text: string } | { type: 'event'; e: TileEvent };

function appendToAssistant(messages: Message[], part: Part): Message[] {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return [...messages, { role: 'assistant', parts: [part] }];
  const parts = [...last.parts];
  const tail = parts[parts.length - 1];
  if (part.kind === 'text' && tail?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: tail.text + part.text };
  else parts.push(part);
  return [...messages.slice(0, -1), { ...last, parts }];
}

function reducer(tile: TileState, action: Action): TileState {
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

/** State of the chat in this window, fed by the main process over IPC. */
export function useTile() {
  const n = new URLSearchParams(location.search).get('n') ?? '1';
  const [tile, dispatch] = useReducer(reducer, { title: `Chat ${n}`, status: 'idle', messages: [] });

  useEffect(() => window.tiledeck.onEvent((e) => dispatch({ type: 'event', e })), []);

  return {
    tile,
    send(text: string) {
      dispatch({ type: 'user', text });
      window.tiledeck.send(text);
    },
    interrupt: () => window.tiledeck.interrupt(),
  };
}
