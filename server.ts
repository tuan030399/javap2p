import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAX_ACTIVE_SOCKETS = 64;
const CONNECT_TIMEOUT_MS = 15_000;

let activeSockets = 0;

function isBlockedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;

  if (net.isIPv4(v4)) {
    const parts = v4.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    return false;
  }

  return true;
}

interface OpenControlMessage {
  type: 'open';
  host: string;
  port: number;
}

interface CloseControlMessage {
  type: 'close';
}

type ClientControlMessage = OpenControlMessage | CloseControlMessage;

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function resolveSafeTarget(host: string): Promise<{ address: string; family: number }> {
  const cleanHost = host.trim();
  if (!cleanHost || cleanHost.length > 255) {
    throw new Error('Tên máy chủ không hợp lệ.');
  }
  const lower = cleanHost.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error('Không cho phép kết nối tới địa chỉ nội bộ.');
  }

  if (net.isIP(cleanHost)) {
    if (isBlockedIp(cleanHost)) {
      throw new Error('Địa chỉ IP nội bộ bị chặn vì lý do bảo mật.');
    }
    return { address: cleanHost, family: net.isIPv6(cleanHost) ? 6 : 4 };
  }

  const lookup = await dns.lookup(cleanHost, { all: true });
  if (!lookup || lookup.length === 0) {
    throw new Error(`Không thể phân giải tên miền: ${cleanHost}`);
  }
  const safe = lookup.find((entry) => !isBlockedIp(entry.address));
  if (!safe) {
    throw new Error('Tên miền trỏ về địa chỉ nội bộ bị chặn.');
  }
  return { address: safe.address, family: safe.family };
}

function attachSocketBridge(ws: WebSocket) {
  let tcpSocket: net.Socket | null = null;
  let closed = false;
  let pendingWrites: Buffer[] = [];
  let isOpened = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    pendingWrites = [];
    if (tcpSocket) {
      activeSockets = Math.max(0, activeSockets - 1);
      tcpSocket.removeAllListeners();
      tcpSocket.destroy();
      tcpSocket = null;
    }
  };

  ws.on('message', async (raw, isBinary) => {
    if (closed) return;

    if (isBinary) {
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);

      if (!tcpSocket || !isOpened) {
        pendingWrites.push(buf);
        return;
      }
      if (!tcpSocket.destroyed) {
        tcpSocket.write(buf);
      }
      return;
    }

    let msg: ClientControlMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientControlMessage;
    } catch {
      return;
    }

    if (msg.type === 'close') {
      if (tcpSocket && !tcpSocket.destroyed) {
        tcpSocket.end();
      }
      cleanup();
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Closed by client');
      }
      return;
    }

    if (msg.type === 'open') {
      if (tcpSocket) return;

      const port = Number(msg.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendJson(ws, { type: 'error', error: `Cổng TCP không hợp lệ: ${msg.port}` });
        ws.close(1008, 'Invalid port');
        return;
      }

      if (activeSockets >= MAX_ACTIVE_SOCKETS) {
        sendJson(ws, { type: 'error', error: 'Quá nhiều kết nối mạng đồng thời.' });
        ws.close(1013, 'Too many connections');
        return;
      }

      try {
        const target = await resolveSafeTarget(String(msg.host || ''));
        if (closed || ws.readyState !== WebSocket.OPEN) return;

        activeSockets += 1;
        const sock = net.createConnection({
          host: target.address,
          port,
          family: target.family,
        });
        tcpSocket = sock;
        sock.setNoDelay(true);
        sock.setKeepAlive(true, 30_000);
        sock.setTimeout(CONNECT_TIMEOUT_MS);

        sock.once('connect', () => {
          if (closed) {
            sock.destroy();
            return;
          }
          sock.setTimeout(0);
          isOpened = true;
          sendJson(ws, { type: 'open', host: msg.host, port });
          if (pendingWrites.length > 0) {
            for (const chunk of pendingWrites) {
              if (!sock.destroyed) sock.write(chunk);
            }
            pendingWrites = [];
          }
        });

        sock.on('timeout', () => {
          if (!isOpened) {
            sendJson(ws, {
              type: 'error',
              error: `Hết thời gian kết nối tới ${msg.host}:${port}`,
            });
            cleanup();
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1001, 'Connect timeout');
            }
          }
        });

        sock.on('data', (chunk: Buffer) => {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          ws.send(chunk, { binary: true });
        });

        sock.on('end', () => {
          sendJson(ws, { type: 'close' });
          cleanup();
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Remote closed');
          }
        });

        sock.on('error', (err) => {
          sendJson(ws, { type: 'error', error: err.message || 'Lỗi kết nối TCP' });
          cleanup();
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'TCP error');
          }
        });

        sock.on('close', () => {
          if (!closed) {
            sendJson(ws, { type: 'close' });
            cleanup();
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1000, 'TCP closed');
            }
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Không thể mở kết nối TCP';
        sendJson(ws, { type: 'error', error: message });
        cleanup();
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1008, 'Blocked or unreachable');
        }
      }
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, tcpBridge: true, activeSockets });
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', attachSocketBridge);

  const relayRooms = new Map<string, { hostWs: WebSocket | null; controllers: Set<WebSocket> }>();

  const relayWss = new WebSocketServer({ noServer: true });
  relayWss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams((req.url || '').split('?')[1]);
    const role = urlParams.get('role');
    const room = (urlParams.get('room') || 'DEFAULT').toUpperCase().trim();

    if (!relayRooms.has(room)) {
      relayRooms.set(room, { hostWs: null, controllers: new Set() });
    }
    const roomObj = relayRooms.get(room)!;

    if (role === 'host') {
      if (roomObj.hostWs && roomObj.hostWs.readyState === WebSocket.OPEN) {
        roomObj.hostWs.close(1000, 'Replaced by new host');
      }
      roomObj.hostWs = ws;
      for (const c of roomObj.controllers) {
        sendJson(c, { type: 'host-status', connected: true });
      }

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          for (const c of roomObj.controllers) {
            if (c.readyState === WebSocket.OPEN) c.send(data, { binary: true });
          }
        } else {
          const str = data.toString();
          for (const c of roomObj.controllers) {
            if (c.readyState === WebSocket.OPEN) c.send(str);
          }
        }
      });

      ws.on('close', () => {
        if (roomObj.hostWs === ws) roomObj.hostWs = null;
        for (const c of roomObj.controllers) {
          sendJson(c, { type: 'host-status', connected: false });
        }
      });
    } else if (role === 'controller') {
      roomObj.controllers.add(ws);
      const isHostOpen = !!(roomObj.hostWs && roomObj.hostWs.readyState === WebSocket.OPEN);
      sendJson(ws, { type: 'host-status', connected: isHostOpen });
      if (isHostOpen && roomObj.hostWs) {
        sendJson(roomObj.hostWs, { type: 'controller-joined' });
      }

      ws.on('message', (data, isBinary) => {
        if (roomObj.hostWs && roomObj.hostWs.readyState === WebSocket.OPEN) {
          if (isBinary) {
            roomObj.hostWs.send(data, { binary: true });
          } else {
            roomObj.hostWs.send(data.toString());
          }
        }
      });

      ws.on('close', () => {
        roomObj.controllers.delete(ws);
      });
    } else {
      ws.close(1008, 'Invalid role');
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/api/j2me-socket') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (pathname === '/api/j2me-relay') {
      relayWss.handleUpgrade(req, socket, head, (ws) => {
        relayWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JavaDeck server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start JavaDeck server:', err);
  process.exit(1);
});
