import { useEffect, useState } from 'react';
import { useDeck } from './deck';
import { Tile } from './Tile';

type Theme = 'aurora' | 'hud';

function loadTheme(): Theme {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'hud' || fromUrl === 'aurora') return fromUrl;
  try {
    return localStorage.getItem('tiledeck.theme') === 'hud' ? 'hud' : 'aurora';
  } catch {
    return 'aurora';
  }
}

export function App() {
  const deck = useDeck();
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('tiledeck.theme', theme);
    } catch {
      /* storage blocked: theme just won't persist */
    }
  }, [theme]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◆</span> tiledeck
        </div>
        <div className="topbar-right">
          <button className="theme-toggle" onClick={() => setTheme(theme === 'aurora' ? 'hud' : 'aurora')} title="Switch theme">
            <span className={theme === 'aurora' ? 'on' : ''}>Aurora</span>
            <span className={theme === 'hud' ? 'on' : ''}>HUD</span>
          </button>
        </div>
      </header>

      <main className="stage">
        {deck.tiles.map((t) => (
          <Tile key={t.id} tile={t} onSend={(text) => deck.send(t.id, text)} onInterrupt={() => deck.interrupt(t.id)} />
        ))}
      </main>
    </div>
  );
}
