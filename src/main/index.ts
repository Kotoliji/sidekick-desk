import { app, BrowserWindow, ipcMain, screen, type WebContents } from 'electron';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Session } from './session';
import { IPC, type TileEvent } from '../shared/protocol';

const CWD = process.env.TILEDECK_CWD ?? homedir();
const GAP = 12;
const MAX_TILES = 4;

interface TileWin {
  n: number;
  win: BrowserWindow;
  session?: Session;
}

const tiles: TileWin[] = [];
let counter = 0;

/** Lay the open chat windows out as a grid over the primary display's work area. */
function arrange() {
  const area = screen.getPrimaryDisplay().workArea;
  const cols = tiles.length <= 2 ? tiles.length : 2;
  const rows = Math.ceil(tiles.length / cols);
  const w = Math.floor((area.width - GAP * (cols + 1)) / cols);
  const h = Math.floor((area.height - GAP * (rows + 1)) / rows);
  tiles.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    t.win.setBounds({ x: area.x + GAP + col * (w + GAP), y: area.y + GAP + row * (h + GAP), width: w, height: h }, true);
  });
}

function createTile() {
  if (tiles.length >= MAX_TILES) return;
  const n = ++counter;
  const win = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    show: false,
    title: `tiledeck · Chat ${n}`,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic', // Windows 11 blur behind the glass theme; ignored elsewhere
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const tile: TileWin = { n, win };
  tiles.push(tile);

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?n=${n}`);
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), { query: { n: String(n) } });

  // TILEDECK_HIDDEN renders windows without showing them (automated checks).
  if (!process.env.TILEDECK_HIDDEN) win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    tile.session?.close();
    tiles.splice(tiles.indexOf(tile), 1);
    arrange();
  });
  arrange();
}

function tileFor(sender: WebContents) {
  return tiles.find((t) => !t.win.isDestroyed() && t.win.webContents === sender);
}

function sessionFor(tile: TileWin) {
  tile.session ??= new Session((e: TileEvent) => {
    if (!tile.win.isDestroyed()) tile.win.webContents.send(IPC.event, e);
  }, { cwd: CWD });
  return tile.session;
}

ipcMain.on(IPC.send, (e, text: string) => {
  const tile = tileFor(e.sender);
  if (tile && typeof text === 'string' && text.trim()) sessionFor(tile).send(text);
});
ipcMain.on(IPC.interrupt, (e) => void tileFor(e.sender)?.session?.interrupt());
ipcMain.on(IPC.newTile, () => createTile());
ipcMain.on(IPC.minimize, (e) => tileFor(e.sender)?.win.minimize());
ipcMain.on(IPC.close, (e) => tileFor(e.sender)?.win.close());

app.whenReady().then(() => {
  createTile();
  screen.on('display-metrics-changed', arrange);
});

app.on('window-all-closed', () => app.quit());
