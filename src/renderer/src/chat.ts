import { useEffect, useReducer } from 'react';
import type { AskChoice, PetNote, SidekickApi, TileEvent, TileStatus } from '../../shared/protocol';

declare global {
  interface Window {
    sidekick: SidekickApi;
  }
}

export type Part = { kind: 'text'; text: string } | { kind: 'tool'; name: string };
export type Message = { role: 'user' | 'assistant' | 'notice'; parts: Part[] } | { role: 'activity'; note: PetNote; answer?: AskChoice };

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
    case 'user':
      return reducer(tile, { type: 'user', text: e.text });
    case 'notice':
      return { ...tile, messages: [...tile.messages, { role: 'notice', parts: [{ kind: 'text', text: e.text }] }] };
    case 'activity':
      return { ...tile, messages: [...tile.messages, { role: 'activity', note: e.note }] };
    case 'answered':
      return { ...tile, messages: tile.messages.map((m) => (m.role === 'activity' && m.note.id === e.id ? { ...m, answer: e.choice } : m)) };
  }
}

/** The conversation with the manager, fed by the main process over IPC. */
export function useChat() {
  const [tile, dispatch] = useReducer(reducer, { title: 'Sidekick', status: 'idle', messages: [] });

  useEffect(() => window.sidekick.onEvent((e) => dispatch({ type: 'event', e })), []);

  return {
    tile,
    send(text: string) {
      dispatch({ type: 'user', text });
      window.sidekick.send(text);
    },
    interrupt: () => window.sidekick.interrupt(),
  };
}
