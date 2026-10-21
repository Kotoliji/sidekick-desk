import { app, BrowserWindow, ipcMain, screen, shell, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { Session } from './session';
import { ensureWorkspace, isInside, kickoff, managerPrompt } from './workspace';
import { IPC, type TileEvent } from '../shared/protocol';

const WIDTH = 380;
const HEIGHT = 640;
const MARGIN = 16;

interface WindowState {
  bounds?: Rectangle;
  pinned: boolean;
}

const stateFile = () => join(app.getPath('userData'), 'window.json');

function loadState(): WindowState {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return { pinned: false };
  }
}

function saveState(s: WindowState) {
  try {
    writeFileSync(stateFile(), JSON.stringify(s));
  } catch {
    /* not fatal: the widget just opens at the default spot next time */
  }
}

/** Saved bounds if they are still on a screen, else the right edge of the primary display. */
function initialBounds(saved?: Rectangle): Rectangle {
  if (saved) {
    const area = screen.getDisplayMatching(saved).workArea;
    const visible = saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y < area.y + area.height && saved.y >= area.y - 8;
    if (visible) return saved;
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WIDTH - MARGIN, y: area.y + MARGIN, width: WIDTH, height: Math.min(HEIGHT, area.height - 2 * MARGIN) };
}

let win: BrowserWindow;
let session: Session;
const state = loadState();

function createWidget(dir: string) {
  win = new BrowserWindow({
    ...initialBounds(state.bounds),
    minWidth: 300,
    minHeight: 360,
    frame: false,
    show: false,
    alwaysOnTop: state.pinned,
    title: 'Sidekick',
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic', // Windows 11 blur behind the glass theme; ignored elsewhere
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));

  // SIDEKICK_HIDDEN renders the window without showing it (automated checks).
  if (!process.env.SIDEKICK_HIDDEN) win.once('ready-to-show', () => win.show());

  let saveTimer: NodeJS.Timeout | undefined;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState({ ...state, bounds: win.getBounds() }), 400);
  };
  win.on('move', remember);
  win.on('resize', remember);

  session = new Session((e: TileEvent) => !win.isDestroyed() && win.webContents.send(IPC.event, e), {
    cwd: dir,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: managerPrompt(dir) },
    tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
    canUseTool: writeOnlyInside(dir),
  });

  // Greet once the window can receive the stream.
  win.webContents.once('did-finish-load', () => session.send(kickoff()));
  win.on('closed', () => session.close());
}

/** The manager may read anywhere but writes only to its own folder. */
function writeOnlyInside(dir: string): CanUseTool {
  return async (tool, input) => {
    const path = typeof input.file_path === 'string' ? input.file_path : '';
    if ((tool === 'Edit' || tool === 'Write') && isInside(dir, path)) return { behavior: 'allow', updatedInput: input };
    if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: `Sidekick may only write inside ${dir}.` };
  };
}

app.whenReady().then(() => {
  const dir = ensureWorkspace();

  ipcMain.on(IPC.send, (_e, text: string) => typeof text === 'string' && text.trim() && session.send(text));
  ipcMain.on(IPC.interrupt, () => void session.interrupt());
  ipcMain.handle(IPC.info, () => ({ pinned: state.pinned, dataDir: dir }));
  ipcMain.handle(IPC.togglePin, () => {
    state.pinned = !state.pinned;
    win.setAlwaysOnTop(state.pinned);
    saveState({ ...state, bounds: win.getBounds() });
    return state.pinned;
  });
  ipcMain.on(IPC.openFolder, () => void shell.openPath(dir));
  ipcMain.on(IPC.minimize, () => win.minimize());
  ipcMain.on(IPC.close, () => win.close());

  createWidget(dir);
});

app.on('window-all-closed', () => app.quit());
