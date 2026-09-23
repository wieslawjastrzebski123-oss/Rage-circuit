import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../src/game/net/protocol';
import { Room } from './Room';

/**
 * RAGE CIRCUIT multiplayer server.
 * Authoritative: runs every race simulation itself; browsers only send inputs.
 */
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const rooms = new Map<string, Room>();
let nextId = 1;

const http = createServer((req, res) => {
  // health check for hosting platforms
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end(req.url === '/health' ? 'ok' : `RAGE CIRCUIT server · ${rooms.size} room(s)`);
});

const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanName(n: unknown): string {
  const s = String(n ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 12);
  return s || 'DRIVER';
}

wss.on('connection', (ws: WebSocket) => {
  const id = nextId++;
  let room: Room | null = null;
  const client = {
    id,
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  // simple flood guard: ~2x the normal input rate
  let budget = 240;
  const refill = setInterval(() => (budget = 240), 1000);

  ws.on('message', (raw) => {
    if (--budget < 0) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'ping') {
      client.send({ t: 'pong', c: msg.c });
      return;
    }
    if (msg.t === 'create' || msg.t === 'join') {
      if (room) return;
      if (msg.v !== PROTOCOL_VERSION) {
        client.send({ t: 'error', msg: 'Game version mismatch – reload the page.' });
        return;
      }
      if (msg.t === 'create') {
        const code = newCode();
        const r = new Room(code, () => rooms.delete(code));
        rooms.set(code, r);
        room = r;
        r.add(client, cleanName(msg.name));
      } else {
        const r = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!r) {
          client.send({ t: 'error', msg: 'Room not found.' });
          return;
        }
        const err = r.add(client, cleanName(msg.name));
        if (err) client.send({ t: 'error', msg: err });
        else room = r;
      }
      return;
    }
    room?.handle(id, msg);
  });

  ws.on('close', () => {
    clearInterval(refill);
    room?.remove(id);
    room = null;
  });
});

// one broken race must never take the whole server down
process.on('uncaughtException', (err) => console.error('uncaught', err));

http.listen(PORT, () => {
  console.log(`RAGE CIRCUIT server listening on :${PORT}`);
});
