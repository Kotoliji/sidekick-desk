import { useEffect, useState } from 'react';
import { useTile } from './deck';
import { Tile } from './Tile';

type Theme = 'aurora' | 'hud';
const THEME_KEY = 'tiledeck.theme';

function loadTheme(): Theme {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'hud' || fromUrl === 'aurora') return fromUrl;
  try {
    return localStorage.getItem(THEME_KEY) === 'hud' ? 'hud' : 'aurora';
  } catch {
    return 'aurora';
  }
}

/** One window = one chat tile. All windows share the theme through localStorage. */
export function App() {
  const { tile, send, interrupt } = useTile();
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = `tiledeck · ${tile.title}`;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: theme just won't persist */
    }
  }, [theme, tile.title]);

  // Another window switched the theme.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === THEME_KEY && setTheme(e.newValue === 'hud' ? 'hud' : 'aurora');
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const actions = (
    <div className="win-actions">
      <button className="theme-toggle" onClick={() => setTheme(theme === 'aurora' ? 'hud' : 'aurora')} title="Switch theme">
        <span className={theme === 'aurora' ? 'on' : ''}>Aurora</span>
        <span className={theme === 'hud' ? 'on' : ''}>HUD</span>
      </button>
      <button className="win-btn" onClick={() => window.tiledeck.newTile()} title="New chat window">
        +
      </button>
      <button className="win-btn" onClick={() => window.tiledeck.minimize()} title="Minimize">
        –
      </button>
      <button className="win-btn win-close" onClick={() => window.tiledeck.close()} title="Close">
        ×
      </button>
    </div>
  );

  return <Tile tile={tile} onSend={send} onInterrupt={interrupt} actions={actions} />;
}
