import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TileState } from './chat';

const STATUS_LABEL = { idle: 'ready', thinking: 'thinking', streaming: 'writing', error: 'error' } as const;

/** Fenced blocks are usually prompts for other chats, so each gets a copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="code-block">
      <pre ref={ref}>{children}</pre>
      <button className="copy-btn" onClick={copy}>
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

const mdComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

interface Props {
  tile: TileState;
  subtitle?: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  /** Window controls rendered at the right end of the header (the header doubles as the title bar). */
  actions?: ReactNode;
}

export function ChatPanel({ tile, subtitle, onSend, onInterrupt, actions }: Props) {
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
        <span className={`dot dot-${tile.status}`} title={STATUS_LABEL[tile.status]} aria-hidden />
        <div className="tile-heading">
          <h1 className="tile-title">{tile.title}</h1>
          {subtitle && <span className="tile-sub">{subtitle}</span>}
        </div>
        {actions}
      </header>

      <div className="tile-log" ref={log}>
        {tile.messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.parts.map((p, j) =>
              p.kind === 'tool' ? (
                <span key={j} className="tool-chip">
                  {p.name}
                </span>
              ) : m.role === 'user' ? (
                <p key={j} className="msg-text">
                  {p.text}
                </p>
              ) : (
                <div key={j} className="md">
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {p.text}
                  </Markdown>
                </div>
              ),
            )}
          </div>
        ))}
        {tile.status === 'thinking' && (
          <div className="typing" aria-label="Sidekick is thinking">
            <i />
            <i />
            <i />
          </div>
        )}
        {tile.error && <p className="tile-error">{tile.error}</p>}
      </div>

      <footer className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={busy ? 'Sidekick is answering…' : 'Tasks, ideas, a prompt to shape…'}
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
