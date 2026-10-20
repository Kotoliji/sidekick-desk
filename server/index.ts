import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Session } from './session.ts';
import type { ClientMsg, TileEvent } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1';
const CWD = process.env.TILEDECK_CWD ?? process.cwd();
// Agents can run code on this machine, so only the local UI may connect.
const ALLOWED_ORIGINS = new Set([`http://localhost:5199`, `http://127.0.0.1:5199`, `http://${HOST}:${PORT}`]);

const sessions = new Map<string, Session>();
const http = createServer((_req, res) => res.writeHead(404).end());
const wss = new WebSocketServer({ noServer: true });

function broadcast(tileId: string, e: TileEvent) {
  const data = JSON.stringify({ tileId, ...e });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}

function sessionFor(tileId: string) {
  let s = sessions.get(tileId);
  if (!s) {
    s = new Session((e) => broadcast(tileId, e), { cwd: CWD });
    sessions.set(tileId, s);
  }
  return s;
}

http.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || !ALLOWED_ORIGINS.has(req.headers.origin ?? '')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'send' && msg.text.trim()) sessionFor(msg.tileId).send(msg.text);
    else if (msg.type === 'interrupt') void sessions.get(msg.tileId)?.interrupt();
    else if (msg.type === 'close') {
      sessions.get(msg.tileId)?.close();
      sessions.delete(msg.tileId);
    }
  });
});

http.listen(PORT, HOST, () => console.log(`tiledeck server on http://${HOST}:${PORT} (cwd: ${CWD})`));
