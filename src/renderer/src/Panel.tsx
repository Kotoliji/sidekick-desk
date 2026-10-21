import { useEffect, useState } from 'react';
import { useChat } from './chat';
import { ChatPanel } from './ChatPanel';

type Theme = 'aurora' | 'hud';
const THEME_KEY = 'sidekick.theme';

function loadTheme(): Theme {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'hud' || fromUrl === 'aurora') return fromUrl;
  try {
    return localStorage.getItem(THEME_KEY) === 'hud' ? 'hud' : 'aurora';
  } catch {
    return 'aurora';
  }
}

const today = () => new Date().toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

/** The chat window the octopus unfolds into. */
export function Panel() {
  const { tile, send, interrupt } = useChat();
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: theme just won't persist */
    }
  }, [theme]);

  const actions = (
    <div className="win-actions">
      <button className="win-btn" onClick={() => window.sidekick.openFolder()} title="Open profile and tasks folder">
        ▤
      </button>
      <button className="win-btn" onClick={() => setTheme(theme === 'aurora' ? 'hud' : 'aurora')} title={`Theme: ${theme}`}>
        ◐
      </button>
      <button className="win-btn win-close" onClick={() => window.sidekick.hidePanel()} title="Hide (the octopus stays)">
        ×
      </button>
    </div>
  );

  return <ChatPanel tile={tile} subtitle={today()} onSend={send} onInterrupt={interrupt} actions={actions} />;
}
