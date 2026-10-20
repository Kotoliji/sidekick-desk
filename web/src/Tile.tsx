import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Tile as TileState } from './deck';

const STATUS_LABEL = { idle: 'idle', thinking: 'thinking', streaming: 'streaming', error: 'error' } as const;

interface Props {
  tile: TileState;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function Tile({ tile, onSend, onInterrupt }: Props) {
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const busy = tile.status === 'thinking' || tile.status === 'streaming';

  // Follow the stream unless the user scrolled up to read.
  useEffect(() => {
    const el = log.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [tile.messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="tile" data-status={tile.status}>
      <header className="tile-head">
        <span className={`dot dot-${tile.status}`} aria-hidden />
        <h2 className="tile-title">{tile.title}</h2>
        <span className="tile-meta">
          {STATUS_LABEL[tile.status]}
          {tile.lastMs != null && !busy && ` · ${(tile.lastMs / 1000).toFixed(1)}s`}
        </span>
      </header>

      <div className="tile-log" ref={log}>
        {tile.messages.length === 0 && <p className="tile-empty">Ask Claude anything. Enter sends, Shift+Enter adds a line.</p>}
        {tile.messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.parts.map((p, j) =>
              p.kind === 'text' ? (
                <p key={j} className="msg-text">
                  {p.text}
                </p>
              ) : (
                <span key={j} className="tool-chip">
                  ⚙ {p.name}
                </span>
              ),
            )}
          </div>
        ))}
        {tile.status === 'thinking' && <div className="typing" aria-label="Claude is thinking"><i /><i /><i /></div>}
        {tile.error && <p className="tile-error">{tile.error}</p>}
      </div>

      <footer className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={busy ? 'Claude is answering…' : 'Message Claude'}
          rows={2}
        />
        {busy ? (
          <button className="btn btn-stop" onClick={onInterrupt} title="Stop">
            ■
          </button>
        ) : (
          <button className="btn btn-send" onClick={submit} disabled={!draft.trim()} title="Send">
            ↑
          </button>
        )}
      </footer>
    </section>
  );
}
