import express from 'express';
import http from 'http';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';
import { SERVER_PORT } from '@red-attack/shared';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.get('/health', (_req, res) => res.json({ status: 'ok', game: 'Red Attack' }));

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define('game', GameRoom);

// In-memory room code → roomId registry (populated by GameRoom.onCreate via callback)
export const roomCodeRegistry = new Map<string, string>();

// Lookup room by code — returns roomId for joinById
app.get('/join/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const roomId = roomCodeRegistry.get(code);
  if (roomId) {
    return res.json({ roomId });
  }
  res.status(404).json({ error: 'Room not found' });
});

// Check if a room code exists and is joinable
app.get('/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const roomId = roomCodeRegistry.get(code);
  if (!roomId) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({ roomId, exists: true });
});

// Serve the built client (npm run build:client) from the same port as the game
// server, so one process can host the whole game: http://<host>:2567/ . Registered
// after the API routes so /health, /join and /room keep precedence.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  console.log(`[Red Attack] Serving client from ${clientDist}`);
} else {
  console.log('[Red Attack] No built client in packages/client/dist - run "npm run build:client",');
  console.log('               or serve the client separately with "npm run preview:client" (port 5173).');
}

gameServer.listen(SERVER_PORT, '0.0.0.0').catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Red Attack] ERROR: Port ${SERVER_PORT} is already in use.`);
    console.error(`  Kill the other process with:  npx kill-port ${SERVER_PORT}`);
    console.error(`  Or on Windows:  netstat -ano | findstr ${SERVER_PORT}  →  taskkill /PID <pid> /F\n`);
  } else {
    console.error('[Red Attack] Server failed to start:', err.message);
  }
  process.exit(1);
});
console.log(`[Red Attack] Server listening on ws://localhost:${SERVER_PORT}`);
